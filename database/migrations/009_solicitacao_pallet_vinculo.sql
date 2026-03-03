-- =============================================================================
-- MIGRATION 009: Vínculo entre solicitação e pallet escolhido pelo almoxarife
--
-- Quando o almoxarife atende uma solicitação, ele escolhe qual pallet
-- será descido do porta-pallet. O pallet é então movido para a área de
-- triagem (RECV-CX-PRETRIAGEM).
-- =============================================================================

-- 1. Coluna pallet_id na solicitacao_pallet
ALTER TABLE solicitacao_pallet
  ADD COLUMN IF NOT EXISTS pallet_id UUID
    REFERENCES pallet(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_solicitacao_pallet ON solicitacao_pallet(pallet_id);
