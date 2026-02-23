-- =============================================================================
-- Migration 001 — Corrige v_estoque_por_catalogo: adiciona coluna "ativo"
--
-- Problema: CREATE OR REPLACE VIEW não permite inserir colunas no meio.
-- Solução: DROP + CREATE.
--
-- Aplicar em banco existente (via WSL):
--   docker compose exec db psql -U pioerp -d pioerp -f /docker-entrypoint-initdb.d/001_fix_view_ativo.sql
-- =============================================================================

DROP VIEW IF EXISTS v_estoque_por_catalogo;

CREATE VIEW v_estoque_por_catalogo AS
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
