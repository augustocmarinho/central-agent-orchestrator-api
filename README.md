# 🤖 AI Agents Backend

Backend da plataforma de criação e gestão de Agentes de Atendimento com IA.

## 📋 Visão Geral

Este é o backend de uma plataforma onde cada usuário pode criar e gerenciar múltiplos agentes de IA. Os agentes nascem ativos e inicialmente funcionam apenas no chat interno. Canais externos e capacidades extras são habilitadas via sistema de plugins.

### Arquitetura

- **Node.js** é o orquestrador absoluto
- **n8n** é a engine de execução de IA e workflows
- **PostgreSQL** armazena dados estruturais (usuários, agentes, plugins)
- **MongoDB** armazena dados operacionais (conversas, mensagens, logs)
- **Redis** gerencia filas de mensagens e cache
- **Bull** processa mensagens de forma assíncrona
- **WebSocket** fornece chat em tempo real

## 🚀 Começando

### Pré-requisitos

- Node.js 18+ 
- PostgreSQL 14+
- MongoDB 6+
- Redis 7+
- n8n (opcional, para funcionalidade completa)

### Instalação

1. **Clone o repositório**

```bash
cd back
```

2. **Instale as dependências**

```bash
npm install
```

3. **Configure as variáveis de ambiente**

```bash
cp env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ai_agents

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/ai_agents

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=sua-chave-secreta-super-segura
JWT_EXPIRES_IN=7d

# N8N Integration
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=sua-api-key-do-n8n

# System API Keys (para N8N e outros sistemas)
# Gere chaves fortes e adicione separadas por vírgula
SYSTEM_API_KEYS=chave-sistema-n8n-123456,outra-chave-sistema

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Logging Configuration
LOG_LEVEL=info
LOG_TO_FILE=false
```

> **⚠️ IMPORTANTE**: Em produção, certifique-se de:
> - Usar um `JWT_SECRET` forte e único
> - Configurar `SYSTEM_API_KEYS` com chaves seguras (32+ caracteres)
> - Nunca commitar o arquivo `.env`

4. **Execute as migrations**

```bash
npm run migrate
```

5. **Execute o seed (usuário inicial)**

```bash
npx tsx src/db/seed.ts
```

Isso cria um usuário padrão:
- Email: `admin@example.com`
- Senha: `admin123`

6. **Inicie o servidor**

```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm run build
npm start
```

O servidor estará rodando em `http://localhost:3000`

## 📡 API Endpoints

### Autenticação

- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro
- `GET /api/auth/me` - Dados do usuário autenticado

### Agentes

- `POST /api/agents` - Criar agente
- `GET /api/agents` - Listar agentes do usuário
- `GET /api/agents/:id` - Buscar agente específico
- `PUT /api/agents/:id` - Atualizar agente
- `DELETE /api/agents/:id` - Deletar agente

### Plugins

- `GET /api/plugins` - Listar todos os plugins disponíveis
- `GET /api/plugins/:id` - Detalhes de um plugin
- `GET /api/agents/:agentId/plugins` - Plugins instalados no agente
- `POST /api/agents/:agentId/plugins` - Instalar plugin em um agente
- `DELETE /api/agents/:agentId/plugins/:pluginId` - Desinstalar plugin

### Chat

- `POST /api/chat/message` - Enviar mensagem (REST - síncrono, legado)
- `GET /api/chat/conversations/:id` - Buscar conversação
- `GET /api/agents/:agentId/conversations` - Listar conversações do agente

### Mensagens (Assíncrono) 🆕

- `POST /api/messages` - Enviar mensagem (assíncrono via filas)
- `GET /api/messages/:messageId/status` - Status da mensagem
- `GET /api/messages/queue/stats` - Estatísticas da fila
- `GET /api/messages/queue/health` - Health check do sistema de filas

### WebSocket

```
ws://localhost:3000/ws/chat?token=SEU_JWT_TOKEN
```

**Mensagens:**

```json
// Entrar em uma conversa
{
  "type": "join",
  "data": {
    "agentId": "uuid-do-agente",
    "conversationId": "optional-conversation-id"
  }
}

// Enviar mensagem
{
  "type": "message",
  "data": {
    "agentId": "uuid-do-agente",
    "content": "Olá, agente!"
  }
}
```

## 🧩 Sistema de Plugins

### Como Funcionam

Plugins são **extensões de capacidade** dos agentes. Um plugin não cria agentes, apenas adiciona funcionalidades.

### Estrutura de um Plugin

```
src/plugins/nome_plugin/
├── manifest.json   # Metadados e configurações
└── handler.ts      # Lógica de execução
```

### Manifest Example

```json
{
  "id": "plugin.calendar_fake",
  "name": "Calendário Fake",
  "category": "agendamento",
  "description": "Plugin de exemplo para agendar horários",
  "version": "1.0.0",
  "auth_type": "none",
  "supports_sandbox": true,
  "config_schema": [],
  "depends_on": []
}
```

### Plugins Incluídos

1. **Echo** (`plugin.echo`) - Plugin simples que repete mensagens
2. **Calendar Fake** (`plugin.calendar_fake`) - Agendamento em memória

### Criar Novo Plugin

1. Crie a estrutura na pasta `src/plugins/seu_plugin/`
2. Defina o `manifest.json`
3. Implemente o `handler.ts`
4. Registre em `src/plugins/index.ts`

## 🔄 Fluxo de Chat (Assíncrono)

```
Cliente → POST /api/messages → Node.js (202 Accepted) 
                                    ↓
                               Redis (Bull Queue)
                                    ↓
                            Worker/Consumer (background)
                        ↓                    ↓
                   Busca Agente          Busca Histórico
                        ↓                    ↓
                            Chama N8N → OpenAI
                                    ↓
                            Redis PubSub (resposta)
                                    ↓
                              Subscriber
                    ↓               ↓              ↓
              WebSocket         WhatsApp       Telegram
                    ↓               ↓              ↓
               Cliente Web    Cliente WhatsApp  Cliente Telegram
```

**Principais vantagens:**
- ✅ Cliente recebe resposta imediata (< 50ms)
- ✅ Processamento em background (não bloqueia)
- ✅ Retry automático em falhas
- ✅ Suporta múltiplos canais simultaneamente
- ✅ Escalável horizontalmente

**Documentação completa:** [MESSAGING_ARCHITECTURE.md](./docs/MESSAGING_ARCHITECTURE.md)

## 🗄️ Banco de Dados

### PostgreSQL (Estrutural)

- `users` - Usuários do sistema
- `agents` - Agentes criados
- `agent_prompts` - Configurações e prompts dos agentes
- `plugins` - Plugins disponíveis
- `agent_plugins` - Plugins instalados por agente
- `plugin_configs` - Configurações dos plugins
- `plugin_dependencies` - Dependências entre plugins
- `audit_logs` - Logs de auditoria

### MongoDB (Operacional)

- `conversations` - Conversas
- `messages` - Mensagens
- `executions` - Execuções de IA
- `pluginlogs` - Logs de plugins

## 🔐 Autenticação

O sistema suporta dois tipos de autenticação:

### 1. Autenticação de Usuário (JWT)

Usado para usuários humanos interagindo com a plataforma.

**Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

**Usando o token:**
```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer SEU_TOKEN"
```

### 2. Autenticação de Sistema (API Key)

Usado para sistemas externos (como N8N) acessarem APIs sem necessidade de um usuário logado.

**Configuração:**

1. Gere uma chave forte (recomendado: 32+ caracteres)
2. Adicione ao `.env`:
   ```env
   SYSTEM_API_KEYS=n8n-api-key-abc123xyz,outro-sistema-key
   ```

**Usando a API Key:**
```bash
curl http://localhost:3000/api/agents/:id \
  -H "X-System-API-Key: n8n-api-key-abc123xyz"
```

**Endpoints que aceitam System API Key:**
- `GET /api/agents/:id` - Buscar agente
- `GET /api/agents/:agentId/plugins` - Listar plugins do agente
- `GET /api/chat/conversations/:id` - Buscar conversação
- `GET /api/agents/:agentId/conversations` - Listar conversações

> **💡 Dica**: Use autenticação de sistema apenas para N8N e outros serviços backend confiáveis. Nunca exponha API Keys no frontend!

## 🧪 Testando

### Health Check

```bash
curl http://localhost:3000/api/health
```

### Criar Agente (exemplo)

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sofia - Suporte",
    "creationMode": "simple",
    "objective": "Ajudar clientes com dúvidas",
    "persona": "amigável e profissional",
    "audience": "Clientes da empresa"
  }'
```

## 🔧 Scripts Disponíveis

```bash
npm run dev        # Desenvolvimento com hot reload
npm run build      # Build para produção
npm start          # Rodar produção
npm run migrate    # Executar migrations
```

## 📁 Estrutura do Projeto

```
src/
├── app.ts                 # Configuração do Express
├── server.ts             # Inicialização do servidor
├── config/               # Configurações
│   ├── index.ts
│   └── redis.config.ts   # 🆕 Config Redis
├── db/                   # Banco de dados
│   ├── postgres.ts
│   ├── mongodb.ts
│   └── migrations/
├── models/               # Models MongoDB
│   └── mongodb/
├── services/             # Lógica de negócio
│   ├── auth.service.ts
│   ├── agent.service.ts
│   ├── plugin.service.ts
│   ├── chat.service.ts
│   ├── queue.service.ts  # 🆕 Orquestração de filas
│   └── n8n.service.ts
├── controllers/          # Controllers REST
│   └── message.controller.ts  # 🆕 Controller de mensagens assíncronas
├── routes/               # Rotas da API
├── middleware/           # Middlewares
├── websocket/            # WebSocket server
├── queues/               # 🆕 Sistema de filas
│   ├── producers/        # Produtores de jobs
│   ├── consumers/        # Consumidores de jobs
│   ├── pubsub/           # Sistema PubSub
│   └── handlers/         # Handlers de entrega por canal
├── types/                # 🆕 TypeScript types
│   └── queue.types.ts
├── auth/                 # Autenticação
├── plugins/              # Plugins do sistema
│   ├── echo/
│   ├── calendar_fake/
│   └── index.ts
└── utils/                # Utilitários
```

## 📊 Logging

O sistema usa **Winston** para logging estruturado com diferentes níveis:

- `error` - Erros críticos
- `warn` - Avisos importantes
- `info` - Informações gerais (padrão)
- `http` - Requisições HTTP
- `debug` - Informações detalhadas de debug

**Configuração:**

```env
# Nível de log (error, warn, info, http, debug)
LOG_LEVEL=info

# Salvar logs em arquivo (logs/error.log e logs/combined.log)
LOG_TO_FILE=false
```

**Em produção**, recomendamos:
```env
LOG_LEVEL=warn
LOG_TO_FILE=true
```

**Logs incluem:**
- Todas requisições HTTP com tempo de resposta
- Autenticações e tentativas de acesso
- Operações CRUD (criar, atualizar, deletar agentes)
- Erros com stack trace completo
- Conexões e desconexões de banco de dados

## 🚀 Deploy

### Variáveis de Produção

Certifique-se de configurar em produção:

- `NODE_ENV=production`
- `JWT_SECRET` forte e único (32+ caracteres)
- `SYSTEM_API_KEYS` com chaves seguras para N8N
- Credenciais seguras de banco de dados
- CORS configurado corretamente (`ALLOWED_ORIGINS`)
- n8n configurado e seguro
- `LOG_LEVEL=warn` ou `error`
- `LOG_TO_FILE=true`

### Docker (em breve)

```bash
docker-compose up -d
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📝 Licença

MIT

## 🆘 Suporte

Para dúvidas ou problemas, abra uma issue no repositório.

---

**Desenvolvido com ❤️ para a plataforma AI Agents**
