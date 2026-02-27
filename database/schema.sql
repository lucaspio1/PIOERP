-- =============================================================================
-- SISTEMA DE GESTÃO DE ESTOQUE DE EQUIPAMENTOS DE T.I. — PIOERP
-- Script DDL — PostgreSQL 14+
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TIPOS ENUM
-- -----------------------------------------------------------------------------
CREATE TYPE status_equip AS ENUM ('reposicao', 'ag_triagem', 'venda', 'em_uso', 'pre_triagem', 'pre_venda', 'ag_internalizacao');

CREATE TYPE tipo_movim AS ENUM (
    'entrada_compra',
    'entrada_retorno_reparo',
    'entrada_recebimento',
    'saida_uso',
    'saida_triagem',
    'saida_venda',
    'movimentacao',
    'transferencia_lote'
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
    codigo          VARCHAR(100),
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
CREATE INDEX idx_catalogo_codigo    ON item_catalogo (codigo);

COMMENT ON TABLE  item_catalogo             IS 'Catálogo de modelos/tipos de equipamentos de T.I.';
COMMENT ON COLUMN item_catalogo.estoque_minimo IS 'Limite crítico: alertas são disparados quando estoque de reposição cai abaixo deste valor.';
COMMENT ON COLUMN item_catalogo.codigo IS 'Código de cadastro do item no catálogo (ex: NB-001, MON-003).';


-- =============================================================================
-- TABELA: endereco_fisico
-- Endereço plano no formato PP01.S{sessao}.N{nivel}.{lado}
-- Ex: PP01.S1.N3.0 = Porta-Pallet 01, Sessão 1, Nível 3, Lado 0
-- =============================================================================
CREATE TABLE endereco_fisico (
    id          SERIAL          PRIMARY KEY,
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    descricao   VARCHAR(255),
    ativo       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_end_codigo ON endereco_fisico (codigo);

COMMENT ON TABLE endereco_fisico IS 'Endereços físicos WMS no formato PP01.S{sessao}.N{nivel}.{lado}.';


-- =============================================================================
-- TABELA: pallet
-- Pallet físico dentro de um endereço WMS (porta-pallet).
-- =============================================================================
CREATE TABLE pallet (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    endereco_id INTEGER         NOT NULL REFERENCES endereco_fisico (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pallet_endereco_id ON pallet (endereco_id);

COMMENT ON TABLE pallet IS 'Pallets físicos dentro de um endereço WMS (porta-pallet).';


-- =============================================================================
-- TABELA: caixa
-- Caixa física dentro de um pallet. Unidade mínima de armazenagem WMS.
-- =============================================================================
CREATE TABLE caixa (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    pallet_id   UUID            NOT NULL REFERENCES pallet (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_caixa_pallet_id ON caixa (pallet_id);

COMMENT ON TABLE caixa IS 'Caixas físicas dentro de um pallet. Unidade mínima de armazenagem WMS.';


-- =============================================================================
-- TABELA: equipamento_fisico
-- A peça real, rastreada por número de série e patrimônio (imobilizado).
-- =============================================================================
CREATE TABLE equipamento_fisico (
    id                  SERIAL          PRIMARY KEY,
    item_catalogo_id    INTEGER         NOT NULL
                        REFERENCES item_catalogo (id) ON DELETE RESTRICT,
    numero_serie        VARCHAR(100)    NOT NULL UNIQUE,
    imobilizado         VARCHAR(100)    NOT NULL UNIQUE,
    status              status_equip    NOT NULL DEFAULT 'reposicao',
    endereco_id         INTEGER
                        REFERENCES endereco_fisico (id) ON DELETE RESTRICT,
    caixa_id            UUID
                        REFERENCES caixa (id) ON DELETE RESTRICT,
    alocacao_filial     VARCHAR(100),
    observacoes         TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_equip_catalogo_id  ON equipamento_fisico (item_catalogo_id);
CREATE INDEX idx_equip_status       ON equipamento_fisico (status);
CREATE INDEX idx_equip_endereco_id  ON equipamento_fisico (endereco_id);
CREATE INDEX idx_equip_caixa_id     ON equipamento_fisico (caixa_id);

COMMENT ON TABLE  equipamento_fisico                  IS 'Instâncias físicas de equipamentos (peças reais com n° de série).';
COMMENT ON COLUMN equipamento_fisico.endereco_id      IS 'FK para endereco_fisico. Usado para RECV e triagem.';
COMMENT ON COLUMN equipamento_fisico.caixa_id         IS 'FK para caixa WMS. Preenchido após aprovação da internalização.';
COMMENT ON COLUMN equipamento_fisico.alocacao_filial  IS 'Filial sistêmica. Preenchida pelo técnico; alterada para 324 na aprovação.';


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
-- TABELA: solicitacao_pallet
-- Canal de comunicação entre Central de Reparo e Almoxarifado.
-- O técnico solicita a descida de um pallet/caixa de determinado modelo;
-- o almoxarife atende, registrando a data de conclusão.
-- =============================================================================
CREATE TABLE solicitacao_pallet (
    id                  SERIAL          PRIMARY KEY,
    item_catalogo_id    INTEGER         NOT NULL
                        REFERENCES item_catalogo(id) ON DELETE CASCADE,
    status              VARCHAR(20)     NOT NULL DEFAULT 'pendente'
                        CONSTRAINT chk_sol_status
                            CHECK (status IN ('pendente', 'em_andamento', 'atendida', 'cancelada')),
    observacao          TEXT,
    atendida_em         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_solicitacao_catalogo ON solicitacao_pallet(item_catalogo_id);
CREATE INDEX idx_solicitacao_status   ON solicitacao_pallet(status);

COMMENT ON TABLE  solicitacao_pallet IS 'Solicitações do técnico de reparo para o almoxarife baixar um pallet/lote de determinado modelo.';
COMMENT ON COLUMN solicitacao_pallet.status IS 'Ciclo: pendente → em_andamento → atendida | cancelada';


-- =============================================================================
-- TABELA: reparo
-- Controla o ciclo de reparo de um equipamento (peça a peça).
-- Um equipamento em ag_triagem deve ter exatamente um reparo ativo.
-- =============================================================================
CREATE TABLE reparo (
    id                          SERIAL          PRIMARY KEY,
    equipamento_id              INTEGER         NOT NULL
                                REFERENCES equipamento_fisico (id) ON DELETE RESTRICT,
    solicitacao_pallet_id       INTEGER
                                REFERENCES solicitacao_pallet(id) ON DELETE SET NULL,
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

CREATE INDEX idx_reparo_equip_id     ON reparo (equipamento_id);
CREATE INDEX idx_reparo_status       ON reparo (status);
CREATE INDEX idx_reparo_solicitacao  ON reparo (solicitacao_pallet_id);

COMMENT ON TABLE  reparo                              IS 'Ordens de reparo para equipamentos na fila de triagem.';
COMMENT ON COLUMN reparo.total_minutos_trabalhados    IS 'Soma acumulada das sessões de trabalho finalizadas. Não inclui sessão corrente em andamento.';
COMMENT ON COLUMN reparo.solicitacao_pallet_id IS 'FK para a solicitação de pallet que originou este reparo. NULL para reparos criados fora do fluxo de solicitação.';


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

CREATE TRIGGER trig_solicitacao_updated_at
    BEFORE UPDATE ON solicitacao_pallet
    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();


-- =============================================================================
-- SEQUENCE: Numeração automática de caixas (CX-001, CX-002...)
-- =============================================================================
CREATE SEQUENCE caixa_numero_seq START 1 INCREMENT 1;


-- =============================================================================
-- VIEW: v_estoque_por_catalogo
-- Snapshot do estoque agrupado por modelo, com flag de alerta crítico.
-- =============================================================================
CREATE OR REPLACE VIEW v_estoque_por_catalogo AS
SELECT
    ic.id,
    ic.codigo,
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
    ic.codigo                                                   AS item_codigo,
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

    -- Endereço físico plano
    end_f.id                                                    AS endereco_id,
    end_f.codigo                                                AS endereco_codigo

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

-- Endereço físico plano
LEFT JOIN endereco_fisico end_f ON end_f.id = ef.endereco_id

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

-- Endereços WMS planos: PP01.S{sessao}.N{nivel}.{lado}
-- 1 PP × 18 Sessões × 7 Níveis × 2 Lados = 252 endereços
INSERT INTO endereco_fisico (codigo, descricao)
SELECT
    'PP01.S' || s || '.N' || n || '.' || l,
    'PP01 / Sessão ' || s || ' / Nível ' || n || ' / Lado ' || l
FROM
    generate_series(1, 18) AS s,
    generate_series(1, 7)  AS n,
    generate_series(0, 1)  AS l
ORDER BY s, n, l;

-- Endereços fixos de Recebimento (prateleiras de triagem e pré-venda)
INSERT INTO endereco_fisico (codigo, descricao) VALUES
    ('RECV-CX-PRETRIAGEM', 'Prateleira de Pré-Triagem'),
    ('RECV-CX-PREVENDA',   'Prateleira de Pré-Venda');
