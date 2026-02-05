-- Adicionar soft delete na tabela agents
ALTER TABLE agents 
ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;

-- Criar índice para performance em queries que filtram por deleted_at
CREATE INDEX IF NOT EXISTS idx_agents_deleted_at ON agents(deleted_at);

-- Criar índice composto para queries comuns (user_id + deleted_at)
CREATE INDEX IF NOT EXISTS idx_agents_user_id_deleted_at ON agents(user_id, deleted_at);
