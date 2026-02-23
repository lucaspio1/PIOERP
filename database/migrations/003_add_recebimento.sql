ALTER TYPE status_equip ADD VALUE IF NOT EXISTS 'pre_triagem';
ALTER TYPE status_equip ADD VALUE IF NOT EXISTS 'pre_venda';

-- Atualizar a View de dashboard para considerar os novos status se necessário