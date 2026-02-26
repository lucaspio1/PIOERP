-- =============================================================================
-- MIGRATION 006: Módulo de Internalização
--
-- Adiciona o fluxo de validação administrativa após reparo:
--   ag_triagem → (reparo finalizado) → ag_internalizacao → (admin aprova) → reposicao
--
-- Inclui hierarquia WMS: endereco_fisico → pallet → caixa → equipamento_fisico
-- =============================================================================

-- 1. Novo valor de enum (não pode rodar dentro de transaction block)
ALTER TYPE status_equip ADD VALUE IF NOT EXISTS 'ag_internalizacao';

-- 2. Tabela pallet
CREATE TABLE IF NOT EXISTS pallet (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    endereco_id INTEGER         NOT NULL REFERENCES endereco_fisico (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pallet_endereco_id ON pallet (endereco_id);

COMMENT ON TABLE pallet IS 'Pallets físicos dentro de um endereço WMS (porta-pallet).';

-- 3. Tabela caixa
CREATE TABLE IF NOT EXISTS caixa (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(80)     NOT NULL UNIQUE,
    pallet_id   UUID            NOT NULL REFERENCES pallet (id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caixa_pallet_id ON caixa (pallet_id);

COMMENT ON TABLE caixa IS 'Caixas físicas dentro de um pallet. Unidade mínima de armazenagem WMS.';

-- 4. Colunas novas em equipamento_fisico
ALTER TABLE equipamento_fisico
    ADD COLUMN IF NOT EXISTS caixa_id        UUID REFERENCES caixa (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS alocacao_filial VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_equip_caixa_id ON equipamento_fisico (caixa_id);

COMMENT ON COLUMN equipamento_fisico.caixa_id        IS 'FK para caixa WMS. Preenchido após aprovação da internalização.';
COMMENT ON COLUMN equipamento_fisico.alocacao_filial IS 'Filial sistêmica onde o equipamento estava alocado (preenchida pelo técnico). Alterada para 324 na aprovação.';
