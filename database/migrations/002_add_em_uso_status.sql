-- =============================================================================
-- MIGRATION 002: Adiciona status 'em_uso' ao tipo status_equip
--
-- Problema: saida_uso mapeava novo_status = 'reposicao', logo o equipamento
-- permanecia no estoque após ser enviado para uso (sem mudança real de status).
-- Solução: novo valor 'em_uso' representa equipamentos em campo / alocados.
-- =============================================================================

ALTER TYPE status_equip ADD VALUE IF NOT EXISTS 'em_uso';
