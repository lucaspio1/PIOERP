-- =============================================================================
-- MIGRATION 007: Catálogo Código + Numeração Automática de Caixas + Fluxo Reparo
--
-- 1. Adiciona coluna 'codigo' na tabela item_catalogo
-- 2. Atualiza views para incluir o campo 'codigo'
-- 3. Cria sequence para numeração automática de caixas (CX-001, CX-002...)
-- 4. Adiciona coluna solicitacao_pallet_id na tabela reparo para rastrear
--    quais itens foram solicitados pelo técnico
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUNA 'codigo' EM item_catalogo
-- Campo de código de cadastro para cada item do catálogo
-- -----------------------------------------------------------------------------
ALTER TABLE item_catalogo
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_catalogo_codigo ON item_catalogo (codigo);

COMMENT ON COLUMN item_catalogo.codigo IS 'Código de cadastro do item no catálogo (ex: NB-001, MON-003).';


-- -----------------------------------------------------------------------------
-- 2. ATUALIZAR VIEW v_estoque_por_catalogo para incluir 'codigo'
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 3. ATUALIZAR VIEW v_prioridades_reparo para incluir 'codigo'
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 4. SEQUENCE para numeração automática de caixas
-- Gera números sequenciais usados no formato CX-001, CX-002, etc.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS caixa_numero_seq START 1 INCREMENT 1;


-- -----------------------------------------------------------------------------
-- 5. COLUNA solicitacao_pallet_id na tabela reparo
-- Permite rastrear quais reparos foram solicitados ativamente pelo técnico
-- (link entre solicitação de pallet e os reparos dos equipamentos desse pallet)
-- -----------------------------------------------------------------------------
ALTER TABLE reparo
  ADD COLUMN IF NOT EXISTS solicitacao_pallet_id INTEGER
    REFERENCES solicitacao_pallet(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reparo_solicitacao ON reparo (solicitacao_pallet_id);

COMMENT ON COLUMN reparo.solicitacao_pallet_id IS 'FK para a solicitação de pallet que originou este reparo. NULL para reparos criados fora do fluxo de solicitação.';
