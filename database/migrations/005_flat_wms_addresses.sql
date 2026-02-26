-- =============================================================================
-- MIGRATION 005: Endereços WMS planos (sem hierarquia)
--
-- Remove a estrutura hierárquica porta_pallet > sessao > pallet > caixa e
-- adota endereços auto-descritivos no formato PP01.S{sessao}.N{nivel}.{lado}.
--
-- ATENÇÃO: Esta migration apaga todos os endereços existentes e renomeia
-- a coluna caixa_id → endereco_id em equipamento_fisico.
-- Equipamentos que apontavam para endereços antigos terão endereco_id = NULL.
-- =============================================================================

-- 1. Remove triggers e funções de validação hierárquica
DROP TRIGGER IF EXISTS trig_validar_endereco          ON endereco_fisico;
DROP TRIGGER IF EXISTS trig_validar_caixa_equipamento ON equipamento_fisico;
DROP FUNCTION IF EXISTS fn_validar_hierarquia_endereco();
DROP FUNCTION IF EXISTS fn_validar_caixa_equipamento();

-- 2. Nulifica referências antigas antes de deletar endereços
UPDATE equipamento_fisico SET caixa_id = NULL;
UPDATE historico_movimentacao SET endereco_origem_id = NULL, endereco_destino_id = NULL;

-- 3. Remove endereços antigos
DELETE FROM endereco_fisico;

-- 4. Remove colunas da hierarquia
ALTER TABLE endereco_fisico
    DROP COLUMN IF EXISTS nivel,
    DROP COLUMN IF EXISTS parent_id;

-- 5. Remove enum nivel_wms (somente se não for mais referenciado)
DROP TYPE IF EXISTS nivel_wms;

-- 6. Renomeia caixa_id → endereco_id em equipamento_fisico
ALTER TABLE equipamento_fisico
    RENAME COLUMN caixa_id TO endereco_id;

-- Atualiza índice
DROP INDEX IF EXISTS idx_equip_caixa_id;
CREATE INDEX IF NOT EXISTS idx_equip_endereco_id ON equipamento_fisico (endereco_id);

-- 7. Insere os 252 endereços planos (PP01 × 18 sessões × 7 níveis × 2 lados)
INSERT INTO endereco_fisico (codigo, descricao)
SELECT
    'PP01.S' || s || '.N' || n || '.' || l,
    'PP01 / Sessão ' || s || ' / Nível ' || n || ' / Lado ' || l
FROM
    generate_series(1, 18) AS s,
    generate_series(1, 7)  AS n,
    generate_series(0, 1)  AS l
ORDER BY s, n, l
ON CONFLICT (codigo) DO NOTHING;

-- 8. Insere endereços fixos de Recebimento
INSERT INTO endereco_fisico (codigo, descricao) VALUES
    ('RECV-CX-PRETRIAGEM', 'Prateleira de Pré-Triagem'),
    ('RECV-CX-PREVENDA',   'Prateleira de Pré-Venda')
ON CONFLICT (codigo) DO NOTHING;

-- 9. Atualiza a view v_prioridades_reparo
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
