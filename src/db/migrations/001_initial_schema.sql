-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar VARCHAR(500),
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de agentes
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'draft')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de prompts dos agentes (guarda tanto formulário quanto prompt final)
CREATE TABLE IF NOT EXISTS agent_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- Dados do modo simplificado
  objective TEXT,
  persona VARCHAR(255),
  audience VARCHAR(255),
  topics TEXT,
  restrictions TEXT,
  knowledge_source TEXT,
  
  -- Prompt final gerado (usado pelo n8n)
  final_prompt TEXT NOT NULL,
  
  -- Modo de criação
  creation_mode VARCHAR(20) DEFAULT 'simple' CHECK (creation_mode IN ('simple', 'advanced')),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(agent_id)
);

-- Tabela de plugins disponíveis
CREATE TABLE IF NOT EXISTS plugins (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  version VARCHAR(20) NOT NULL,
  auth_type VARCHAR(50) DEFAULT 'none',
  supports_sandbox BOOLEAN DEFAULT false,
  manifest JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de plugins instalados em agentes
CREATE TABLE IF NOT EXISTS agent_plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  plugin_id VARCHAR(100) NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  is_sandbox BOOLEAN DEFAULT false,
  installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(agent_id, plugin_id)
);

-- Tabela de configurações dos plugins por agente
CREATE TABLE IF NOT EXISTS plugin_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_plugin_id UUID NOT NULL REFERENCES agent_plugins(id) ON DELETE CASCADE,
  config_key VARCHAR(255) NOT NULL,
  config_value TEXT,
  is_encrypted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(agent_plugin_id, config_key)
);

-- Tabela de dependências de plugins
CREATE TABLE IF NOT EXISTS plugin_dependencies (
  plugin_id VARCHAR(100) NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  depends_on_plugin_id VARCHAR(100) NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  
  PRIMARY KEY (plugin_id, depends_on_plugin_id)
);

-- Tabela de logs de auditoria
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_plugins_agent_id ON agent_plugins(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_plugins_plugin_id ON agent_plugins(plugin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
