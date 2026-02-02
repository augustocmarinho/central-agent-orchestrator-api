# 🏗️ Arquitetura do Sistema

## Visão Geral

O sistema é construído seguindo o princípio: **Node.js é o DONO do sistema**.

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │ HTTP/WebSocket
       │ (Nunca acessa n8n diretamente)
       ▼
┌─────────────────────────────────────────┐
│           Node.js Backend               │
│  ┌──────────────────────────────────┐  │
│  │   Autenticação & Autorização     │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │   Regras de Negócio              │  │
│  │   - Gerenciar agentes            │  │
│  │   - Resolver plugins             │  │
│  │   - Montar contexto              │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │   Controle de Execução           │  │
│  └──────────────────────────────────┘  │
└───────┬──────────────┬─────────────────┘
        │              │
        │              │ Chama workflows
        ▼              ▼
┌─────────────┐  ┌──────────┐
│ PostgreSQL  │  │   n8n    │
│  (Config)   │  │ (Engine) │
└─────────────┘  └────┬─────┘
                      │
┌─────────────┐       │ Executa
│  MongoDB    │       │
│  (Logs)     │       ▼
└─────────────┘  ┌──────────┐
                 │   LLMs   │
                 │ Plugins  │
                 └──────────┘
```

## Camadas da Aplicação

### 1. Camada de Apresentação (API)

**Responsabilidades:**
- Receber requisições HTTP e WebSocket
- Validar dados de entrada
- Aplicar autenticação e autorização
- Retornar respostas formatadas

**Componentes:**
- `app.ts` - Configuração do Express
- `routes/` - Definição de rotas
- `controllers/` - Lógica de controle das requisições
- `middleware/` - Middlewares de autenticação, CORS, etc.
- `websocket/` - Servidor WebSocket para chat

### 2. Camada de Negócio (Services)

**Responsabilidades:**
- Implementar regras de negócio
- Orquestrar operações entre diferentes recursos
- Validar lógica de domínio
- Preparar dados para execução

**Componentes:**
- `services/auth.service.ts` - Autenticação e usuários
- `services/agent.service.ts` - Gerenciamento de agentes
- `services/plugin.service.ts` - Sistema de plugins
- `services/chat.service.ts` - Lógica de conversação
- `services/n8n.service.ts` - Integração com n8n

### 3. Camada de Dados

**Responsabilidades:**
- Persistir e recuperar dados
- Garantir integridade dos dados
- Otimizar queries

**Componentes:**

#### PostgreSQL (Dados Estruturais)
- Usuários e autenticação
- Configuração de agentes
- Catálogo de plugins
- Relações e dependências

#### MongoDB (Dados Operacionais)
- Conversas e mensagens (alta escrita)
- Logs de execução
- Histórico de interações
- Métricas em tempo real

## Fluxo de Dados Detalhado

### Chat Flow

```
1. Usuário envia mensagem
   └─> Frontend (WebSocket)

2. Node.js recebe mensagem
   ├─> Autentica usuário (JWT)
   ├─> Identifica agente
   ├─> Busca configuração do agente (PostgreSQL)
   ├─> Busca histórico de conversa (MongoDB)
   └─> Lista plugins ativos do agente (PostgreSQL)

3. Node.js prepara contexto
   ├─> Prompt do agente
   ├─> Últimas N mensagens
   ├─> Tools disponíveis (plugins)
   └─> Metadata (canal, usuário, etc.)

4. Node.js chama n8n
   └─> POST /webhook/agent-chat
       ├─> n8n decide qual LLM usar
       ├─> n8n monta o prompt completo
       ├─> n8n chama a IA
       ├─> n8n executa plugins se necessário
       └─> n8n retorna resposta

5. Node.js processa resposta
   ├─> Salva mensagens (MongoDB)
   ├─> Salva logs de execução (MongoDB)
   ├─> Registra plugins usados
   └─> Envia resposta ao frontend (WebSocket)

6. Frontend exibe resposta
```

### Plugin Resolution

```
1. Agente tem plugins instalados
   └─> Tabela: agent_plugins

2. Plugins podem ter dependências
   └─> Tabela: plugin_dependencies

3. Node.js resolve ordem de execução
   ├─> Valida todas dependências instaladas
   ├─> Monta grafo de dependências
   └─> Ordena topologicamente

4. Node.js envia para n8n
   └─> Lista ordenada de plugins disponíveis

5. n8n decide quando chamar cada plugin
   └─> Baseado na necessidade da conversação
```

## Modelo de Agente

### Dois Modos de Criação

#### Modo Simplificado
- Frontend: Formulário estruturado
- Backend: Gera prompt automaticamente
- Armazena: Dados estruturados + prompt gerado

```typescript
{
  name: "Sofia",
  objective: "Auxiliar clientes",
  persona: "amigável",
  audience: "Clientes B2C",
  topics: "Produtos, preços",
  restrictions: "Não revelar dados internos",
  knowledgeSource: "Catálogo...",
  // ↓ Gerado automaticamente
  finalPrompt: "Você é Sofia, um assistente..."
}
```

#### Modo Avançado
- Frontend: Editor de texto livre
- Backend: Usa prompt diretamente
- Armazena: Prompt + modo de criação

```typescript
{
  name: "Carlos",
  creationMode: "advanced",
  finalPrompt: "Você é Carlos, especialista em...\n\n## Regras..."
}
```

### Transição entre Modos

- Simplificado → Avançado: Gera o prompt e permite edição
- Avançado → Simplificado: NÃO permitido (perda de dados)

## Sistema de Plugins

### Arquitetura de Plugins

```
Plugin
├─ manifest.json       # Metadados
│  ├─ id
│  ├─ name
│  ├─ category
│  ├─ version
│  ├─ auth_type
│  ├─ supports_sandbox
│  └─ depends_on[]
│
└─ handler.ts          # Implementação
   ├─ action1()
   ├─ action2()
   └─ actionN()
```

### Ciclo de Vida

1. **Registro**: Plugin é registrado no sistema (PostgreSQL)
2. **Instalação**: Usuário instala em um agente específico
3. **Configuração**: Credenciais/configs são salvos
4. **Resolução**: Node.js valida dependências
5. **Execução**: n8n chama quando necessário
6. **Logging**: Ações são registradas (MongoDB)

### Sandbox Mode

Plugins podem rodar em modo sandbox:
- Credenciais fake
- Sem side effects reais
- Ideal para testes

## Escalabilidade

### Horizontal Scaling

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Node.js  │  │ Node.js  │  │ Node.js  │
│ Instance │  │ Instance │  │ Instance │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │            │            │
     └────────────┴────────────┘
                  │
          ┌───────▼────────┐
          │  Load Balancer │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │   PostgreSQL   │
          │   (Primary +   │
          │    Replicas)   │
          └────────────────┘
```

### Estateless Backend

- Sessão via JWT (stateless)
- WebSocket com reconnect
- Dados em banco, não em memória

### Caching (Futuro)

```
┌─────────┐
│  Redis  │ ← Cache de:
└─────────┘   - Configurações de agentes
              - Plugins instalados
              - Rate limiting
```

## Segurança

### Autenticação

- JWT com expiração configurável
- Refresh tokens (futuro)
- Password hashing com bcrypt

### Autorização

- Usuário só acessa seus próprios agentes
- Validação em todas as rotas
- Middleware de auth obrigatório

### Dados Sensíveis

- Configurações de plugins podem ser encriptadas
- Senhas nunca em plain text
- Tokens externos em variáveis de ambiente

### CORS

- Apenas origens permitidas
- Configurado via variável de ambiente

## Monitoramento (Futuro)

```
┌─────────────┐
│   Metrics   │ ← Prometheus
└─────────────┘

┌─────────────┐
│    Logs     │ ← Winston / Morgan
└─────────────┘

┌─────────────┐
│   Traces    │ ← OpenTelemetry
└─────────────┘
```

## Performance

### Database Indexing

- Índices em foreign keys
- Índices em campos de busca frequente
- Índices compostos onde necessário

### Query Optimization

- Limit em queries de histórico
- Paginação em listagens
- Joins otimizados

### Connection Pooling

- PostgreSQL: Pool de 20 conexões
- MongoDB: Conexão persistente

## Decisões Arquiteturais

### Por que Node.js como orquestrador?

1. **Controle total**: Todas decisões passam por Node
2. **Segurança**: n8n nunca é exposto diretamente
3. **Flexibilidade**: Fácil adicionar lógica de negócio
4. **Auditoria**: Tudo é logado e rastreável

### Por que PostgreSQL + MongoDB?

1. **PostgreSQL**: Dados relacionais, ACID, integridade
2. **MongoDB**: Alta escrita, flexibilidade, logs

### Por que n8n?

1. **Workflow visual**: Não-técnicos podem customizar
2. **Integrações prontas**: 200+ nodes disponíveis
3. **LLM agnóstico**: Suporta OpenAI, Claude, etc.
4. **Self-hosted**: Controle total dos dados

## Próximos Passos

1. **Rate Limiting**: Limitar requisições por usuário
2. **Webhooks**: Notificações de eventos
3. **API Versioning**: Suporte a múltiplas versões
4. **GraphQL**: Alternativa à REST
5. **Event Sourcing**: Histórico completo de mudanças
6. **Multi-tenancy**: Suporte a organizações
