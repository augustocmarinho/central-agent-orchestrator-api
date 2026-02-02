-- Tabela de tokens de sistema para integração com N8N e outros sistemas
CREATE TABLE IF NOT EXISTS system_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL, -- Nome identificador (ex: "N8N Production", "N8N Development")
  token VARCHAR(255) UNIQUE NOT NULL, -- Token único
  description TEXT, -- Descrição do uso
  allowed_ips TEXT[], -- Array de IPs permitidos (ex: ['192.168.1.1', '10.0.0.0/8'])
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP, -- NULL para tokens que não expiram
  last_used_at TIMESTAMP,
  last_used_ip VARCHAR(50),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL, -- Quem criou o token
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de logs de uso de tokens de sistema
CREATE TABLE IF NOT EXISTS system_token_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_token_id UUID NOT NULL REFERENCES system_tokens(id) ON DELETE CASCADE,
  ip_address VARCHAR(50) NOT NULL,
  path VARCHAR(500) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_system_tokens_token ON system_tokens(token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_system_tokens_active ON system_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_system_token_logs_token_id ON system_token_logs(system_token_id);
CREATE INDEX IF NOT EXISTS idx_system_token_logs_created_at ON system_token_logs(created_at);

-- Função para limpar logs antigos (manter últimos 90 dias)
CREATE OR REPLACE FUNCTION cleanup_old_system_token_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM system_token_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
