-- =============================================================================
-- MIGRATION 008: Adiciona objetos faltantes (solicitacao_pallet + codigo)
--
-- Corrige schema.sql que não incluía:
--   - Tabela solicitacao_pallet (originalmente da migration 004)
--   - Coluna codigo em item_catalogo (originalmente da migration 007)
--   - Views atualizadas com campo codigo
--   - Sequence caixa_numero_seq
--   - Coluna solicitacao_pallet_id em reparo
--
-- NOTA: Todas as instruções usam IF NOT EXISTS / IF EXISTS para serem
-- idempotentes — seguro re-executar em bancos que já tenham parte dos objetos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELA solicitacao_pallet
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitacao_pallet (
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

CREATE INDEX IF NOT EXISTS idx_solicitacao_catalogo ON solicitacao_pallet(item_catalogo_id);
CREATE INDEX IF NOT EXISTS idx_solicitacao_status   ON solicitacao_pallet(status);

-- Trigger updated_at
CREATE TRIGGER trig_solicitacao_updated_at
    BEFORE UPDATE ON solicitacao_pallet
    FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- -----------------------------------------------------------------------------
-- 2. COLUNA codigo EM item_catalogo
-- -----------------------------------------------------------------------------
ALTER TABLE item_catalogo
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_catalogo_codigo ON item_catalogo (codigo);

-- -----------------------------------------------------------------------------
-- 3. ATUALIZAR VIEW v_estoque_por_catalogo (adiciona campo codigo)
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
-- 4. ATUALIZAR VIEW v_prioridades_reparo (adiciona campo item_codigo)
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

    end_f.id                                                    AS endereco_id,
    end_f.codigo                                                AS endereco_codigo

FROM equipamento_fisico ef

JOIN item_catalogo ic
    ON ic.id = ef.item_catalogo_id

JOIN reparo r
    ON  r.equipamento_id = ef.id
    AND r.status IN ('aguardando', 'em_progresso', 'pausado')

LEFT JOIN (
    SELECT
        item_catalogo_id,
        COUNT(*) AS qtd_reposicao
    FROM equipamento_fisico
    WHERE status = 'reposicao'
    GROUP BY item_catalogo_id
) est ON est.item_catalogo_id = ic.id

LEFT JOIN endereco_fisico end_f ON end_f.id = ef.endereco_id

WHERE ef.status = 'ag_triagem'

ORDER BY
    CASE WHEN COALESCE(est.qtd_reposicao, 0) < ic.estoque_minimo THEN 0 ELSE 1 END ASC,
    (ic.estoque_minimo - COALESCE(est.qtd_reposicao, 0)) DESC,
    r.created_at ASC;

-- -----------------------------------------------------------------------------
-- 5. SEQUENCE para numeração automática de caixas
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS caixa_numero_seq START 1 INCREMENT 1;

-- -----------------------------------------------------------------------------
-- 6. COLUNA solicitacao_pallet_id na tabela reparo
-- -----------------------------------------------------------------------------
ALTER TABLE reparo
  ADD COLUMN IF NOT EXISTS solicitacao_pallet_id INTEGER
    REFERENCES solicitacao_pallet(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reparo_solicitacao ON reparo (solicitacao_pallet_id);
