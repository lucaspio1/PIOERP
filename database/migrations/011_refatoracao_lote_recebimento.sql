-- 1. Tornar pallet_id opcional (pois a caixa é criada antes do pallet)
ALTER TABLE caixa ALTER COLUMN pallet_id DROP NOT NULL;

-- 2. Adicionar controle de status e lote na caixa
ALTER TABLE caixa 
ADD COLUMN status VARCHAR(20) DEFAULT 'aberta' 
CONSTRAINT chk_caixa_status CHECK (status IN ('aberta', 'fechada', 'alocada')),
ADD COLUMN lote_id VARCHAR(50);

-- 3. (Opcional) Adicionar índice para agilizar buscas por código e status
CREATE INDEX idx_caixa_codigo_status ON caixa (codigo, status);