-- =============================================================================
-- MIGRATION 010: Remover status 'em_andamento' de solicitacao_pallet
--
-- O fluxo de solicitação foi simplificado: pendente → atendida | cancelada.
-- A etapa intermediária "em_andamento" não é mais necessária.
-- =============================================================================

-- 1. Converter solicitações existentes em 'em_andamento' de volta para 'pendente'
UPDATE solicitacao_pallet
  SET status = 'pendente', updated_at = NOW()
WHERE status = 'em_andamento';

-- 2. Substituir a constraint CHECK para aceitar apenas os 3 status válidos
ALTER TABLE solicitacao_pallet DROP CONSTRAINT IF EXISTS chk_sol_status;
ALTER TABLE solicitacao_pallet
  ADD CONSTRAINT chk_sol_status
    CHECK (status IN ('pendente', 'atendida', 'cancelada'));
