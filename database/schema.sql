-- =============================================================================
-- SISTEMA DE GESTÃO DE ESTOQUE DE EQUIPAMENTOS DE T.I. — PIOERP
-- Script DDL — PostgreSQL 14+
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TIPOS ENUM
-- -----------------------------------------------------------------------------
CREATE TYPE nivel_wms AS ENUM ('porta_pallet', 'sessao', 'pallet', 'caixa');

CREATE TYPE status_equip AS ENUM ('reposicao', 'ag_triagem', 'venda', 'em_uso', 'pre_triagem', 'pre_venda');

CREATE TYPE tipo_movim AS ENUM (
    'entrada_compra',
    'entrada_retorno_reparo',
    'saida_uso',
    'saida_triagem',
    'saida_venda'
);

CREATE TYPE status_rep AS ENUM ('aguardando', 'em_progresso', 'pausado', 'finalizado');


-- =============================================================================
-- TABELA: item_catalogo
-- Representa o "modelo" do equipamento, não a peça física.
-- O controle de estoque mínimo/máximo é feito aqui.
-- =============================================================================
CREATE TABLE item_catalogo (
    id              SERIAL          PRIMARY KEY,
    nome            VARCHAR(255)    NOT NULL,
    categoria       VARCHAR(100)    NOT NULL,
    estoque_minimo  INTEGER         NOT NULL DEFAULT 0
                    CONSTRAINT chk_cat_estoque_minimo CHECK (estoque_minimo >= 0),
    estoque_maximo  INTEGER         NOT NULL DEFAULT 0
                    CONSTRAINT chk_cat_estoque_maximo CHECK (estoque_maximo >= estoque_minimo),
    ativo           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalogo_categoria ON item_catalogo (categoria);
CREATE INDEX idx_catalogo_ativo     ON item_catalogo (ativo);

COMMENT ON TABLE  item_catalogo             IS 'Catálogo de modelos/tipos de equipamentos de T.I.';
COMMENT ON COLUMN item_catalogo.estoque_minimo IS 'Limite crítico: alertas são disparados quando estoque de reposição cai abaixo deste valor.';


-- =============================================================================
-- TABELA: endereco_fisico
-- Hierarquia WMS com parent_id auto-referenciado.
-- Nível 1: porta_pallet → Nível 2: sessao → Nível 3: pallet → Nível 4: caixa
-- O equipamento_fisico é o "Nível 5" e aponta obrigatoriamente para uma caixa.
-- =============================================================================
CREATE TABLE endereco_fisico (
    id          SERIAL          PRIMARY KEY,
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    descricao   VARCHAR(255),
    nivel       nivel_wms       NOT NULL,
    parent_id   INTEGER         REFERENCES endereco_fisico (id) ON DELETE RESTRICT,
    ativo       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_end_parent ON endereco_fisico (parent_id);
CREATE INDEX idx_end_nivel  ON endereco_fisico (nivel);

COMMENT ON TABLE  endereco_fisico          IS 'Endereçamento físico hierárquico (WMS). Profundidade máxima de 4 níveis.';
COMMENT ON COLUMN endereco_fisico.parent_id IS 'NULL apenas para porta_pallet (nível 1).';

-- Trigger: valida a hierarquia de endereços (filho só pode ter pai do nível imediatamente superior)
CREATE OR REPLACE FUNCTION fn_validar_hierarquia_endereco()
RETURNS TRIGGER
LANGUAGE plpgsql AS
$$
DECLARE
    v_nivel_pai nivel_wms;
BEGIN
    CASE NEW.nivel
        WHEN 'porta_pallet' THEN
            IF NEW.parent_id IS NOT NULL THEN
                RAISE EXCEPTION
                    'Porta-Pallet (nível 1) não pode ter endereço pai. Verifique o campo parent_id.';
            END IF;

        WHEN 'sessao' THEN
            IF NEW.parent_id IS NULL THEN
                RAISE EXCEPTION 'Sessão (nível 2) requer um parent_id do tipo porta_pallet.';
            END IF;
            SELECT nivel INTO v_nivel_pai FROM endereco_fisico WHERE id = NEW.parent_id;
            IF v_nivel_pai <> 'porta_pallet' THEN
                RAISE EXCEPTION
                    'Sessão deve ser filha de um porta_pallet. Pai informado é do tipo: %', v_nivel_pai;
            END IF;

        WHEN 'pallet' THEN
            IF NEW.parent_id IS NULL THEN
                RAISE EXCEPTION 'Pallet (nível 3) requer um parent_id do tipo sessao.';
            END IF;
            SELECT nivel INTO v_nivel_pai FROM endereco_fisico WHERE id = NEW.parent_id;
            IF v_nivel_pai <> 'sessao' THEN
                RAISE EXCEPTION
                    'Pallet deve ser filho de uma sessao. Pai informado é do tipo: %', v_nivel_pai;
            END IF;

        WHEN 'caixa' THEN
            IF NEW.parent_id IS NULL THEN
                RAISE EXCEPTION 'Caixa (nível 4) requer um parent_id do tipo pallet.';
            END IF;
            SELECT nivel INTO v_nivel_pai FROM endereco_fisico WHERE id = NEW.parent_id;
            IF v_nivel_pai <> 'pallet' THEN
                RAISE EXCEPTION
                    'Caixa deve ser filha de um pallet. Pai informado é do tipo: %', v_nivel_pai;
            END IF;
    END CASE;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trig_validar_endereco
    BEFORE INSERT OR UPDATE ON endereco_fisico
    FOR EACH ROW EXECUTE FUNCTION fn_validar_hierarquia_endereco();


-- =============================================================================
-- TABELA: equipamento_fisico
-- A peça real, rastreada por número de série e patrimônio (imobilizado).
-- Deve estar obrigatoriamente vinculada a uma "caixa" (nível 4).
-- =============================================================================
CREATE TABLE equipamento_fisico (
    id                  SERIAL          PRIMARY KEY,
    item_catalogo_id    INTEGER         NOT NULL
                        REFERENCES item_catalogo (id) ON DELETE RESTRICT,
    numero_serie        VARCHAR(100)    NOT NULL UNIQUE,
    imobilizado         VARCHAR(100)    NOT NULL UNIQUE,
    status              status_equip    NOT NULL DEFAULT 'reposicao',
    caixa_id            INTEGER
                        REFERENCES endereco_fisico (id) ON DELETE RESTRICT,
    observacoes         TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_equip_catalogo_id ON equipamento_fisico (item_catalogo_id);
CREATE INDEX idx_equip_status      ON equipamento_fisico (status);
CREATE INDEX idx_equip_caixa_id    ON equipamento_fisico (caixa_id);

COMMENT ON TABLE  equipamento_fisico          IS 'Instâncias físicas de equipamentos (peças reais com n° de série).';
COMMENT ON COLUMN equipamento_fisico.caixa_id IS 'FK obrigatória para endereco_fisico do tipo caixa (nível 4).';

-- Trigger: garante que caixa_id aponta apenas para endereços do tipo 'caixa'
CREATE OR REPLACE FUNCTION fn_validar_caixa_equipamento()
RETURNS TRIGGER
LANGUAGE plpgsql AS
$$
DECLARE
    v_nivel nivel_wms;
BEGIN
    IF NEW.caixa_id IS NOT NULL THEN
        SELECT nivel INTO v_nivel FROM endereco_fisico WHERE id = NEW.caixa_id;
        IF v_nivel <> 'caixa' THEN
            RAISE EXCEPTION
                'O campo caixa_id deve apontar para um endereço do tipo caixa. Tipo encontrado: %', v_nivel;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trig_validar_caixa_equipamento
    BEFORE INSERT OR UPDATE ON equipamento_fisico
    FOR EACH ROW EXECUTE FUNCTION fn_validar_caixa_equipamento();


-- =============================================================================
-- TABELA: historico_movimentacao
-- Rastreabilidade completa de todas as movimentações de status e localização.
-- Registro imutável (nunca atualizado, apenas inserido).
-- =============================================================================
CREATE TABLE historico_movimentacao (
    id                      SERIAL          PRIMARY KEY,
    equipamento_id          INTEGER         NOT NULL
                            REFERENCES equipamento_fisico (id) ON DELETE RESTRICT,
    tipo                    tipo_movim      NOT NULL,
    status_anterior         status_equip,
    status_novo             status_equip    NOT NULL,
    endereco_origem_id      INTEGER         REFERENCES endereco_fisico (id),
    endereco_destino_id     INTEGER         REFERENCES endereco_fisico (id),
    observacao              TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movim_equip_id ON historico_movimentacao (equipamento_id);
CREATE INDEX idx_movim_tipo     ON historico_movimentacao (tipo);
CREATE INDEX idx_movim_created  ON historico_movimentacao (created_at DESC);

COMMENT ON TABLE historico_movimentacao IS 'Auditoria completa de movimentações de equipamentos. Registro append-only.';


-- =============================================================================
-- TABELA: reparo
-- Controla o ciclo de reparo de um equipamento (peça a peça).
-- Um equipamento em ag_triagem deve ter exatamente um reparo ativo.
-- =============================================================================
CREATE TABLE reparo (
    id                          SERIAL          PRIMARY KEY,
    equipamento_id              INTEGER         NOT NULL
                                REFERENCES equipamento_fisico (id) ON DELETE RESTRICT,
    status                      status_rep      NOT NULL DEFAULT 'aguardando',
    descricao_problema          TEXT,
    diagnostico                 TEXT,
    observacoes_finais          TEXT,
    total_minutos_trabalhados   INTEGER         NOT NULL DEFAULT 0
                                CONSTRAINT chk_reparo_minutos CHECK (total_minutos_trabalhados >= 0),
    iniciado_em                 TIMESTAMPTZ,
    finalizado_em               TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reparo_equip_id ON reparo (equipamento_id);
CREATE INDEX idx_reparo_status   ON reparo (status);

COMMENT ON TABLE  reparo                              IS 'Ordens de reparo para equipamentos na fila de triagem.';
COMMENT ON COLUMN reparo.total_minutos_trabalhados    IS 'Soma acumulada das sessões de trabalho finalizadas. Não inclui sessão corrente em andamento.';


-- =============================================================================
-- TABELA: sessao_reparo
-- Granularidade de cada sessão de trabalho (play/pause).
-- Permite calcular histórico exato de tempo por sessão.
-- =============================================================================
CREATE TABLE sessao_reparo (
    id          SERIAL          PRIMARY KEY,
    reparo_id   INTEGER         NOT NULL
                REFERENCES reparo (id) ON DELETE CASCADE,
    inicio      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    fim         TIMESTAMPTZ,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessao_reparo_id ON sessao_reparo (reparo_id);

COMMENT ON TABLE sessao_reparo IS 'Sessões individuais de trabalho de reparo. Calculam o tempo líquido trabalhado por peça.';


-- =============================================================================
-- FUNÇÃO GENÉRICA: atualizar updated_at automaticamente
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS
$$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trig_catalogo_updated_at
    BEFORE UPDATE ON item_catalogo
    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

CREATE TRIGGER trig_equip_updated_at
    BEFORE UPDATE ON equipamento_fisico
    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

CREATE TRIGGER trig_reparo_updated_at
    BEFORE UPDATE ON reparo
    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();


-- =============================================================================
-- VIEW: v_estoque_por_catalogo
-- Snapshot do estoque agrupado por modelo, com flag de alerta crítico.
-- =============================================================================
CREATE OR REPLACE VIEW v_estoque_por_catalogo AS
SELECT
    ic.id,
    ic.nome,
    ic.categoria,
    ic.estoque_minimo,
    ic.estoque_maximo,
    ic.ativo,
    COALESCE(agg.qtd_reposicao,  0) AS qtd_reposicao,
    COALESCE(agg.qtd_ag_triagem, 0) AS qtd_ag_triagem,
    COALESCE(agg.qtd_venda,      0) AS qtd_venda,
    COALESCE(agg.qtd_total,      0) AS qtd_total,
    (ic.estoque_minimo - COALESCE(agg.qtd_reposicao, 0)) AS deficit,
    CASE
        WHEN COALESCE(agg.qtd_reposicao, 0) < ic.estoque_minimo THEN TRUE
        ELSE FALSE
    END AS estoque_critico
FROM item_catalogo ic
LEFT JOIN (
    SELECT
        item_catalogo_id,
        COUNT(*)                                         AS qtd_total,
        COUNT(*) FILTER (WHERE status = 'reposicao')    AS qtd_reposicao,
        COUNT(*) FILTER (WHERE status = 'ag_triagem')   AS qtd_ag_triagem,
        COUNT(*) FILTER (WHERE status = 'venda')        AS qtd_venda
    FROM equipamento_fisico
    GROUP BY item_catalogo_id
) agg ON agg.item_catalogo_id = ic.id
WHERE ic.ativo = TRUE;


-- =============================================================================
-- VIEW: v_prioridades_reparo
-- Query complexa de priorização da Central de Reparo.
--
-- Lógica de ordenação (ORDER BY):
--   1. Equipamentos críticos (estoque de reposição < mínimo) primeiro  → 0/1
--   2. Dentro dos críticos: maior déficit primeiro                     → DESC deficit
--   3. Dentro de mesmo déficit: mais antigo na fila primeiro           → ASC reparo.created_at
-- =============================================================================
CREATE OR REPLACE VIEW v_prioridades_reparo AS
SELECT
    ef.id                                                       AS equipamento_id,
    ef.numero_serie,
    ef.imobilizado,

    ic.id                                                       AS item_catalogo_id,
    ic.nome                                                     AS modelo,
    ic.categoria,
    ic.estoque_minimo,
    ic.estoque_maximo,

    COALESCE(est.qtd_reposicao, 0)                              AS qtd_reposicao,
    (ic.estoque_minimo - COALESCE(est.qtd_reposicao, 0))        AS deficit,
    CASE
        WHEN COALESCE(est.qtd_reposicao, 0) < ic.estoque_minimo THEN TRUE
        ELSE FALSE
    END                                                         AS critico,

    r.id                                                        AS reparo_id,
    r.status                                                    AS status_reparo,
    r.descricao_problema,
    r.total_minutos_trabalhados,
    r.iniciado_em,
    r.created_at                                                AS entrada_triagem_em,

    -- Endereço físico completo (caixa → pallet → sessão → porta-pallet)
    e4.id                                                       AS caixa_id,
    e4.codigo                                                   AS caixa_codigo,
    e3.codigo                                                   AS pallet_codigo,
    e2.codigo                                                   AS sessao_codigo,
    e1.codigo                                                   AS porta_pallet_codigo

FROM equipamento_fisico ef

JOIN item_catalogo ic
    ON ic.id = ef.item_catalogo_id

-- Apenas reparos ativos (não finalizados)
JOIN reparo r
    ON  r.equipamento_id = ef.id
    AND r.status IN ('aguardando', 'em_progresso', 'pausado')

-- Estoque de reposição atual para o mesmo modelo
LEFT JOIN (
    SELECT
        item_catalogo_id,
        COUNT(*) AS qtd_reposicao
    FROM equipamento_fisico
    WHERE status = 'reposicao'
    GROUP BY item_catalogo_id
) est ON est.item_catalogo_id = ic.id

-- Hierarquia de endereço
LEFT JOIN endereco_fisico e4  ON e4.id  = ef.caixa_id
LEFT JOIN endereco_fisico e3  ON e3.id  = e4.parent_id
LEFT JOIN endereco_fisico e2  ON e2.id  = e3.parent_id
LEFT JOIN endereco_fisico e1  ON e1.id  = e2.parent_id

WHERE ef.status = 'ag_triagem'

ORDER BY
    -- Prioridade 1: crítico ou não
    CASE WHEN COALESCE(est.qtd_reposicao, 0) < ic.estoque_minimo THEN 0 ELSE 1 END ASC,
    -- Prioridade 2: maior déficit (para críticos)
    (ic.estoque_minimo - COALESCE(est.qtd_reposicao, 0)) DESC,
    -- Prioridade 3: mais antigo na fila
    r.created_at ASC;


-- =============================================================================
-- DADOS DE EXEMPLO (SEED)
-- =============================================================================

-- Catálogo
INSERT INTO item_catalogo (nome, categoria, estoque_minimo, estoque_maximo) VALUES
    ('Notebook Dell Latitude 5420',   'Notebooks',    5,  20),
    ('Notebook Lenovo ThinkPad E14',  'Notebooks',    3,  15),
    ('Desktop HP ProDesk 400 G7',     'Desktops',     3,  15),
    ('Monitor LG 24" Full HD IPS',    'Monitores',    4,  20),
    ('Switch Cisco SG250-08',         'Networking',   2,   8),
    ('Teclado Logitech MK295 Silent', 'Periféricos',  5,  30),
    ('Mouse Logitech MX Master 3',    'Periféricos',  5,  30),
    ('Headset Jabra Evolve2 55',      'Periféricos',  2,  10),
    ('Webcam Logitech C920 HD Pro',   'Periféricos',  2,  10),
    ('No-Break APC BVX 700',          'Infraestrutura', 1, 5);

-- Nível 1: Porta-Pallets
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id) VALUES
    ('PP-01', 'Porta-Pallet 01 — Corredor A', 'porta_pallet', NULL),
    ('PP-02', 'Porta-Pallet 02 — Corredor A', 'porta_pallet', NULL),
    ('PP-03', 'Porta-Pallet 03 — Corredor B', 'porta_pallet', NULL);

-- Nível 2: Sessões
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id) VALUES
    ('PP-01-A', 'Sessão A — PP-01', 'sessao', 1),
    ('PP-01-B', 'Sessão B — PP-01', 'sessao', 1),
    ('PP-02-A', 'Sessão A — PP-02', 'sessao', 2),
    ('PP-03-A', 'Sessão A — PP-03', 'sessao', 3),
    ('PP-03-B', 'Sessão B — PP-03', 'sessao', 3);

-- Nível 3: Pallets
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id) VALUES
    ('PP-01-A-P01', 'Pallet 01 — PP-01/Sessão A', 'pallet', 4),
    ('PP-01-A-P02', 'Pallet 02 — PP-01/Sessão A', 'pallet', 4),
    ('PP-01-B-P01', 'Pallet 01 — PP-01/Sessão B', 'pallet', 5),
    ('PP-02-A-P01', 'Pallet 01 — PP-02/Sessão A', 'pallet', 6),
    ('PP-03-A-P01', 'Pallet 01 — PP-03/Sessão A', 'pallet', 7),
    ('PP-03-B-P01', 'Pallet 01 — PP-03/Sessão B', 'pallet', 8);

-- Nível 4: Caixas
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id) VALUES
    ('PP-01-A-P01-CX01', 'Caixa 01 — PP01/A/P01', 'caixa', 9),
    ('PP-01-A-P01-CX02', 'Caixa 02 — PP01/A/P01', 'caixa', 9),
    ('PP-01-A-P02-CX01', 'Caixa 01 — PP01/A/P02', 'caixa', 10),
    ('PP-01-B-P01-CX01', 'Caixa 01 — PP01/B/P01', 'caixa', 11),
    ('PP-01-B-P01-CX02', 'Caixa 02 — PP01/B/P01', 'caixa', 11),
    ('PP-02-A-P01-CX01', 'Caixa 01 — PP02/A/P01', 'caixa', 12),
    ('PP-02-A-P01-CX02', 'Caixa 02 — PP02/A/P01', 'caixa', 12),
    ('PP-03-A-P01-CX01', 'Caixa 01 — PP03/A/P01', 'caixa', 13),
    ('PP-03-B-P01-CX01', 'Caixa 01 — PP03/B/P01', 'caixa', 14);
