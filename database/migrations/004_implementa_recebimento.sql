-- =============================================================================
-- MIGRAÇÃO 004: Implementa Fluxo de Recebimento
-- Criado: 2025
-- Descrição:
--   1. Adiciona novos valores ao ENUM tipo_movim
--   2. Cria tabela solicitacao_pallet
--   3. Insere endereços fixos das prateleiras de Pré-Triagem e Pré-Venda
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. NOVOS VALORES DE ENUM PARA tipo_movim
-- Necessário para:
--   - 'entrada_recebimento': registra no histórico quando item chega pelo setor
--   - 'movimentacao':         movimentação interna sem mudança de propriedade
--   - 'transferencia_lote':  montagem de pallet (transferência em lote)
-- NOTA: ALTER TYPE ... ADD VALUE não pode rodar dentro de transaction block.
-- -----------------------------------------------------------------------------
ALTER TYPE tipo_movim ADD VALUE IF NOT EXISTS 'entrada_recebimento';
ALTER TYPE tipo_movim ADD VALUE IF NOT EXISTS 'movimentacao';
ALTER TYPE tipo_movim ADD VALUE IF NOT EXISTS 'transferencia_lote';


-- -----------------------------------------------------------------------------
-- 2. TABELA: solicitacao_pallet
-- Canal de comunicação entre Central de Reparo e Almoxarifado.
-- O técnico solicita a descida de um pallet/caixa de determinado modelo;
-- o almoxarife atende, registrando a data de conclusão.
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

COMMENT ON TABLE  solicitacao_pallet IS 'Solicitações do técnico de reparo para o almoxarife baixar um pallet/lote de determinado modelo.';
COMMENT ON COLUMN solicitacao_pallet.status IS 'Ciclo: pendente → em_andamento → atendida | cancelada';


-- -----------------------------------------------------------------------------
-- 3. ENDEREÇOS FÍSICOS (WMS): Prateleiras de Recebimento
-- Hierarquia: Porta-Pallet → Sessão → Pallet → Caixa
-- As caixas RECV-CX-PRETRIAGEM e RECV-CX-PREVENDA são endereços fixos
-- onde itens recebidos aguardam triagem/consolidação em pallet definitivo.
-- -----------------------------------------------------------------------------

-- Porta-Pallet raiz da área de recebimento
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
VALUES ('RECV-PP-01', 'Área de Recebimento', 'porta_pallet', NULL)
ON CONFLICT (codigo) DO NOTHING;

-- Sessão
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
SELECT 'RECV-SS-01', 'Sessão de Recebimento', 'sessao', ef.id
FROM   endereco_fisico ef
WHERE  ef.codigo = 'RECV-PP-01'
ON CONFLICT (codigo) DO NOTHING;

-- Pallet
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
SELECT 'RECV-PLT-01', 'Pallet de Recebimento', 'pallet', ef.id
FROM   endereco_fisico ef
WHERE  ef.codigo = 'RECV-SS-01'
ON CONFLICT (codigo) DO NOTHING;

-- Caixa: Prateleira de Pré-Triagem
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
SELECT 'RECV-CX-PRETRIAGEM', 'Prateleira de Pré-Triagem', 'caixa', ef.id
FROM   endereco_fisico ef
WHERE  ef.codigo = 'RECV-PLT-01'
ON CONFLICT (codigo) DO NOTHING;

-- Caixa: Prateleira de Pré-Venda
INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
SELECT 'RECV-CX-PREVENDA', 'Prateleira de Pré-Venda', 'caixa', ef.id
FROM   endereco_fisico ef
WHERE  ef.codigo = 'RECV-PLT-01'
ON CONFLICT (codigo) DO NOTHING;
