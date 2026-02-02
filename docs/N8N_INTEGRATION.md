# 🔗 Integração com N8N

## Visão Geral

Este documento explica como o backend integra com o N8N e como o N8N pode acessar dados do backend usando System API Keys.

## Arquitetura de Integração

```
┌─────────────┐         ┌──────────────┐         ┌─────────┐
│   Backend   │◄────────│     N8N      │◄────────│   LLM   │
│  (Node.js)  │────────►│  (Workflow)  │────────►│ (GPT-4) │
└─────────────┘         └──────────────┘         └─────────┘
      │                        │
      ▼                        ▼
┌──────────┐           ┌──────────────┐
│ Database │           │  Webhook URL │
└──────────┘           └──────────────┘
```

## Workflows Disponíveis

### 1. Workflow de Chat (`openai-chat.json`)

Fluxo completo para conversação com agentes usando histórico Redis.

**Fluxo:**
1. **Usuário envia mensagem** → Backend
2. **Backend prepara contexto**:
   - Busca dados do agente (prompt, configuração)
   - Busca histórico de conversas
   - Busca plugins instalados no agente
3. **Backend chama N8N** via webhook/API
4. **N8N executa workflow**:
   - Formata prompt com contexto
   - Chama LLM (GPT-4, Claude, etc)
   - Processa resposta
5. **N8N pode consultar backend** usando System API Key
6. **N8N retorna resposta** → Backend
7. **Backend salva e envia** → Usuário

**Endpoint:** `POST /webhook/agent-chat`

### 2. Workflow de Criação de Prompts (`create-agent-prompt.json`)

Workflow simplificado para gerar prompts estruturados de agentes usando IA.

**Características:**
- ✅ Sem necessidade de Redis ou gerenciamento de estado
- ✅ Foco exclusivo em geração de prompts
- ✅ Retorna estrutura completa (prompt, personalidade, capacidades, diretrizes, restrições)
- ✅ Processamento único (stateless)

**Fluxo:**
1. **Usuário define características do agente** → Backend
2. **Backend chama N8N** com informações (nome, objetivo, persona, etc.)
3. **N8N valida e prepara prompt** estruturado para IA
4. **N8N chama OpenAI** para gerar prompt profissional
5. **N8N processa resposta JSON** da IA
6. **N8N retorna agente estruturado** → Backend
7. **Backend usa o prompt gerado** para criar o agente

**Endpoint:** `POST /webhook/create-agent`

**Documentação completa:** `/n8n/workflows/CREATE_AGENT_PROMPT.md`

## Usando o Workflow de Criação de Prompts

### Quando Usar

Use este workflow quando você quiser:
- Criar um novo agente com prompt gerado por IA
- Gerar prompts profissionais baseados em descrições simples
- Estruturar automaticamente personalidade, capacidades e restrições
- Economizar tempo na criação manual de prompts

### Entrada

```typescript
interface CreateAgentWithAIData {
  userId: string;          // Obrigatório: ID do usuário criador
  name: string;            // Obrigatório: Nome do agente
  objective?: string;      // Opcional: Objetivo principal
  persona?: string;        // Opcional: Personalidade desejada
  audience?: string;       // Opcional: Público-alvo
  topics?: string;         // Opcional: Áreas de conhecimento
  restrictions?: string;   // Opcional: Limitações e restrições
}
```

### Saída

```typescript
interface CreateAgentAIResponse {
  success: boolean;
  agent?: {
    userId: string;
    name: string;
    finalPrompt: string;         // Prompt completo do sistema
    personality: string;          // Descrição da personalidade
    capabilities: string[];       // Lista de capacidades
    guidelines: string[];         // Diretrizes de comportamento
    restrictions: string[];       // Restrições e limitações
    generatedBy: string;          // Modelo usado (ex: openai-gpt-4o-mini)
    timestamp: string;            // Data/hora da geração
  };
  rawResponse?: string;           // Resposta bruta da IA
  error?: string;                 // Mensagem de erro (se falhou)
}
```

### Exemplo de Uso no Controller

```typescript
// agent.controller.ts
async createAgentWithAI(req: Request, res: Response) {
  try {
    const { name, objective, persona, audience, topics, restrictions } = req.body;
    const userId = req.user.id;

    // Chamar N8N para gerar prompt
    const aiResult = await n8nService.createAgentWithAI({
      userId,
      name,
      objective,
      persona,
      audience,
      topics,
      restrictions
    });

    if (!aiResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Erro ao gerar prompt com IA',
        error: aiResult.error
      });
    }

    // Criar agente com o prompt gerado
    const agent = new Agent({
      userId,
      name: aiResult.agent.name,
      status: 'active',
      prompt: {
        finalPrompt: aiResult.agent.finalPrompt,
        personality: aiResult.agent.personality,
        objective: objective || '',
        capabilities: aiResult.agent.capabilities,
        guidelines: aiResult.agent.guidelines,
        restrictions: aiResult.agent.restrictions
      },
      metadata: {
        generatedBy: aiResult.agent.generatedBy,
        generatedAt: aiResult.agent.timestamp
      }
    });

    await agent.save();

    res.status(201).json({
      success: true,
      message: 'Agente criado com sucesso',
      data: { agent }
    });
  } catch (error) {
    console.error('Erro ao criar agente:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao criar agente'
    });
  }
}
```

## Configuração no Backend

### 1. Variáveis de Ambiente

```env
# URL base do N8N
N8N_BASE_URL=http://localhost:5678

# API Key do N8N (para backend chamar N8N)
N8N_API_KEY=sua-n8n-api-key

# System API Keys (para N8N chamar backend)
SYSTEM_API_KEYS=n8n-system-key-abc123,outro-sistema-key
```

### 2. Endpoints Disponíveis para N8N

O N8N pode acessar os seguintes endpoints usando `X-System-API-Key`:

#### Buscar Agente
```http
GET /api/agents/:id
X-System-API-Key: n8n-system-key-abc123
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "uuid",
      "name": "Nome do Agente",
      "status": "active",
      "prompt": {
        "finalPrompt": "Você é um assistente...",
        "persona": "profissional",
        "objective": "Ajudar usuários"
      }
    }
  }
}
```

#### Listar Plugins do Agente
```http
GET /api/agents/:agentId/plugins
X-System-API-Key: n8n-system-key-abc123
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "plugins": [
      {
        "id": "plugin.calendar",
        "name": "Calendário",
        "is_active": true,
        "config": {...}
      }
    ]
  }
}
```

#### Buscar Conversação
```http
GET /api/chat/conversations/:id
X-System-API-Key: n8n-system-key-abc123
```

#### Listar Conversações do Agente
```http
GET /api/agents/:agentId/conversations?limit=50
X-System-API-Key: n8n-system-key-abc123
```

## Configuração no N8N

### Workflow de Exemplo

```json
{
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "chat-ai-agent",
        "responseMode": "responseNode"
      }
    },
    {
      "name": "Buscar Agente no Backend",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://backend:3000/api/agents/{{ $json.agentId }}",
        "method": "GET",
        "headers": {
          "X-System-API-Key": "n8n-system-key-abc123"
        }
      }
    },
    {
      "name": "Chamar OpenAI",
      "type": "n8n-nodes-base.openAi",
      "parameters": {
        "operation": "message",
        "model": "gpt-4",
        "messages": [
          {
            "role": "system",
            "content": "={{ $node['Buscar Agente no Backend'].json.data.agent.prompt.finalPrompt }}"
          },
          {
            "role": "user",
            "content": "={{ $json.userMessage }}"
          }
        ]
      }
    },
    {
      "name": "Responder",
      "type": "n8n-nodes-base.respondToWebhook",
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { success: true, response: $json.choices[0].message.content } }}"
      }
    }
  ]
}
```

### Configurar HTTP Request Node

1. **Method**: GET
2. **URL**: `http://seu-backend:3000/api/agents/{{$json.agentId}}`
3. **Headers**:
   - Name: `X-System-API-Key`
   - Value: `n8n-system-key-abc123`

## Serviço N8N no Backend

O backend possui o serviço `n8n.service.ts` que encapsula chamadas ao N8N:

```typescript
// Exemplo de uso no backend
import { n8nService } from './services/n8n.service';

// Enviar mensagem para processamento
const result = await n8nService.sendMessageToN8n({
  agentId: 'uuid-do-agente',
  userId: 'uuid-do-usuario',
  message: 'Olá, agente!',
  conversationId: 'uuid-da-conversa',
  agentConfig: {...},
  history: [...],
  plugins: [...]
});
```

## Segurança

### ⚠️ Importante

1. **System API Keys são sensíveis**
   - Nunca exponha no frontend
   - Nunca commite no Git
   - Rotacione periodicamente

2. **Validação no Backend**
   - Todas requisições com System API Key são logadas
   - Rate limiting é recomendado
   - Monitore acessos suspeitos

3. **Network Security**
   - Use HTTPS em produção
   - Configure firewall adequadamente
   - N8N e Backend devem estar na mesma rede privada

### Logs de Segurança

O sistema loga automaticamente:
- Tentativas de acesso com API Key inválida
- Acessos bem-sucedidos com System API Key
- Todos erros de autenticação

```bash
# Verificar logs de sistema
grep "System API" logs/combined.log
```

## Troubleshooting

### N8N não consegue acessar backend

**Problema**: Erro 401 "API Key inválida"

**Solução**:
1. Verifique se `SYSTEM_API_KEYS` está configurado no backend
2. Confirme que a chave no N8N HTTP Request é a mesma
3. Reinicie o backend após alterar `.env`

**Problema**: Erro de conexão / timeout

**Solução**:
1. Verifique se backend está rodando (`curl http://backend:3000/api/health`)
2. Confirme network entre N8N e backend
3. Verifique firewall

### Backend não consegue chamar N8N

**Problema**: Erro ao chamar webhook do N8N

**Solução**:
1. Verifique `N8N_BASE_URL` no `.env`
2. Confirme que webhook está ativo no N8N
3. Teste manualmente: `curl -X POST http://n8n:5678/webhook/...`

## Exemplos de Integração

### 1. Criar Agente com IA

```typescript
// Backend chama N8N para gerar prompt do agente
import { n8nService } from './services/n8n.service';

const result = await n8nService.createAgentWithAI({
  userId: 'user-123',
  name: 'Assistente de Marketing',
  objective: 'Auxiliar em estratégias de marketing digital',
  persona: 'Profissional criativo e analítico',
  audience: 'Empresários e gestores de marketing',
  topics: 'SEO, marketing de conteúdo, redes sociais',
  restrictions: 'Não fornecer conselhos financeiros'
});

if (result.success) {
  const { finalPrompt, personality, capabilities } = result.agent;
  
  // Criar agente no banco com o prompt gerado
  await Agent.create({
    userId: result.agent.userId,
    name: result.agent.name,
    prompt: {
      finalPrompt: result.agent.finalPrompt,
      personality: result.agent.personality,
      capabilities: result.agent.capabilities,
      guidelines: result.agent.guidelines,
      restrictions: result.agent.restrictions
    }
  });
}
```

### 2. Chat Simples

```javascript
// Backend chama N8N para processamento de chat
const response = await axios.post(
  `${config.n8n.baseUrl}/webhook/agent-chat`,
  {
    agentId: 'uuid-agent',
    userMessage: 'Olá',
    history: [...],
  },
  {
    headers: {
      'x-n8n-api-key': config.n8n.apiKey
    }
  }
);
```

### 3. N8N Consulta Backend

```javascript
// Node HTTP Request no N8N
GET http://backend:3000/api/agents/{{$json.agentId}}
Headers:
  X-System-API-Key: n8n-system-key-abc123
```

### 4. Executar Plugin via N8N

```javascript
// Backend envia contexto de plugin
const response = await n8nService.executeWithPlugins({
  agentId: 'uuid',
  message: 'Agendar reunião às 15h',
  plugins: [{
    id: 'plugin.calendar',
    config: {...}
  }]
});
```

## Exemplos Pré-Configurados

O projeto inclui 8 exemplos pré-configurados de agentes no arquivo:
`/n8n/workflows/examples/create-agent-prompt-examples.json`

### Exemplos Disponíveis

1. **Marketing Pro** - Assistente de Marketing Digital
2. **CodeMaster** - Tutor de Programação
3. **Sales Expert** - Consultor de Vendas B2B
4. **Wellness Coach** - Assistente de Saúde e Bem-Estar
5. **Direito Fácil** - Assistente Jurídico Informativo
6. **PM Assistant** - Gerente de Projetos Virtual
7. **Social Creator** - Criador de Conteúdo para Redes Sociais
8. **Support Hero** - Assistente de Atendimento ao Cliente

### Como Testar

```bash
# Exemplo 1: Marketing Pro
curl -X POST http://localhost:5678/webhook/create-agent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "name": "Marketing Pro",
    "objective": "Auxiliar empresas a criar estratégias de marketing digital",
    "persona": "Profissional criativo e analítico com experiência em marketing",
    "audience": "Empresários e gestores de marketing",
    "topics": "SEO, marketing de conteúdo, redes sociais, email marketing",
    "restrictions": "Não fornecer conselhos financeiros ou jurídicos"
  }'

# Exemplo 2: CodeMaster
curl -X POST http://localhost:5678/webhook/create-agent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user456",
    "name": "CodeMaster",
    "objective": "Ensinar programação de forma didática",
    "persona": "Professor paciente que usa exemplos práticos",
    "audience": "Iniciantes em programação",
    "topics": "JavaScript, Python, algoritmos, boas práticas",
    "restrictions": "Não fornecer código completo de projetos acadêmicos"
  }'
```

## Melhorias Futuras

- [ ] Webhook bidirecional (N8N → Backend eventos)
- [ ] Retry automático em falhas
- [ ] Circuit breaker para resiliência
- [ ] Métricas de performance das chamadas N8N
- [ ] Cache de configurações de agentes
- [ ] Suporte a múltiplos modelos de IA (Claude, Gemini, etc.)
- [ ] Versionamento de prompts gerados
- [ ] Templates pré-definidos de agentes

## Recursos

- [Documentação N8N](https://docs.n8n.io/)
- [N8N API](https://docs.n8n.io/api/)
- [Webhooks N8N](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)

---

**Última atualização**: Janeiro 2026
