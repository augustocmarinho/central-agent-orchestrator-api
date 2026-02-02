# 📡 Documentação da API

## Base URL

```
http://localhost:3000/api
```

## Autenticação

A maioria dos endpoints requer autenticação via JWT Bearer Token.

```
Authorization: Bearer {token}
```

---

## 🔐 Autenticação

### POST /auth/login

Fazer login e obter token JWT.

**Body:**
```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Administrador",
      "email": "admin@example.com",
      "role": "admin"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### POST /auth/register

Criar nova conta de usuário.

**Body:**
```json
{
  "name": "João Silva",
  "email": "joao@example.com",
  "password": "senha123"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "João Silva",
      "email": "joao@example.com",
      "role": "user"
    }
  }
}
```

### GET /auth/me

Obter dados do usuário autenticado.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "João Silva",
      "email": "joao@example.com",
      "role": "user"
    }
  }
}
```

---

## 🤖 Agentes

### POST /agents

Criar novo agente.

**Headers:** `Authorization: Bearer {token}`

**Body (Modo Simplificado):**
```json
{
  "name": "Sofia - Suporte Vendas",
  "creationMode": "simple",
  "objective": "Auxiliar clientes com dúvidas sobre produtos e vendas",
  "persona": "amigável e profissional",
  "audience": "Clientes interessados em comprar",
  "topics": "Produtos, preços, formas de pagamento, prazos de entrega",
  "restrictions": "Não revelar informações confidenciais da empresa",
  "knowledgeSource": "Catálogo de produtos 2024..."
}
```

**Body (Modo Avançado):**
```json
{
  "name": "Carlos - Tech Support",
  "creationMode": "advanced",
  "finalPrompt": "Você é Carlos, um especialista técnico..."
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "uuid",
      "userId": "uuid",
      "name": "Sofia - Suporte Vendas",
      "status": "active",
      "createdAt": "2024-01-23T10:00:00Z",
      "prompt": {
        "objective": "Auxiliar clientes...",
        "persona": "amigável e profissional",
        "finalPrompt": "Você é Sofia...",
        "creationMode": "simple"
      }
    }
  }
}
```

### GET /agents

Listar todos os agentes do usuário.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "id": "uuid",
        "name": "Sofia - Suporte Vendas",
        "status": "active",
        "createdAt": "2024-01-23T10:00:00Z"
      }
    ]
  }
}
```

### GET /agents/:id

Buscar agente específico com detalhes completos.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "uuid",
      "userId": "uuid",
      "name": "Sofia - Suporte Vendas",
      "status": "active",
      "prompt": {
        "objective": "...",
        "persona": "...",
        "finalPrompt": "...",
        "creationMode": "simple"
      }
    }
  }
}
```

### PUT /agents/:id

Atualizar agente.

**Headers:** `Authorization: Bearer {token}`

**Body:**
```json
{
  "name": "Sofia - Suporte Premium",
  "status": "paused",
  "objective": "Novo objetivo..."
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "agent": { /* agente atualizado */ }
  }
}
```

### DELETE /agents/:id

Deletar agente.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "message": "Agente excluído com sucesso"
}
```

---

## 🔌 Plugins

### GET /plugins

Listar todos os plugins disponíveis.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "plugins": [
      {
        "id": "plugin.echo",
        "name": "Echo",
        "category": "utilitario",
        "description": "Plugin que repete mensagens",
        "version": "1.0.0",
        "authType": "none",
        "supportsSandbox": true
      }
    ]
  }
}
```

### GET /plugins/:id

Detalhes de um plugin específico.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "plugin": {
      "id": "plugin.calendar_fake",
      "name": "Calendário Fake",
      "category": "agendamento",
      "manifest": { /* manifest completo */ }
    }
  }
}
```

### GET /agents/:agentId/plugins

Listar plugins instalados em um agente.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "plugins": [
      {
        "id": "uuid",
        "pluginId": "plugin.echo",
        "name": "Echo",
        "category": "utilitario",
        "isActive": true,
        "isSandbox": false,
        "installedAt": "2024-01-23T10:00:00Z"
      }
    ]
  }
}
```

### POST /agents/:agentId/plugins

Instalar plugin em um agente.

**Headers:** `Authorization: Bearer {token}`

**Body:**
```json
{
  "pluginId": "plugin.calendar_fake",
  "isSandbox": true,
  "config": {
    "apiKey": "optional-config-values"
  }
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "installation": {
      "id": "uuid",
      "agentId": "uuid",
      "pluginId": "plugin.calendar_fake",
      "isActive": true,
      "isSandbox": true
    }
  }
}
```

### DELETE /agents/:agentId/plugins/:pluginId

Desinstalar plugin de um agente.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "message": "Plugin desinstalado com sucesso"
}
```

---

## 💬 Chat

### POST /chat/message

Enviar mensagem para um agente (via REST).

**Headers:** `Authorization: Bearer {token}`

**Body:**
```json
{
  "agentId": "uuid",
  "content": "Olá, preciso de ajuda!",
  "conversationId": "optional-uuid",
  "channel": "webchat"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "conversationId": "uuid",
    "message": {
      "id": "uuid",
      "role": "assistant",
      "content": "Olá! Como posso ajudar?",
      "createdAt": "2024-01-23T10:00:00Z"
    },
    "executionId": "uuid"
  }
}
```

### GET /chat/conversations/:id

Buscar conversação com todas as mensagens.

**Headers:** `Authorization: Bearer {token}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": "uuid",
      "agentId": "uuid",
      "status": "active",
      "startedAt": "2024-01-23T10:00:00Z"
    },
    "messages": [
      {
        "id": "uuid",
        "role": "user",
        "content": "Olá",
        "createdAt": "2024-01-23T10:00:00Z"
      },
      {
        "id": "uuid",
        "role": "assistant",
        "content": "Olá! Como posso ajudar?",
        "createdAt": "2024-01-23T10:00:01Z"
      }
    ]
  }
}
```

### GET /agents/:agentId/conversations

Listar conversações de um agente.

**Headers:** `Authorization: Bearer {token}`

**Query params:**
- `limit` (opcional): Número de conversações (padrão: 50)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "uuid",
        "agentId": "uuid",
        "status": "active",
        "startedAt": "2024-01-23T10:00:00Z"
      }
    ]
  }
}
```

---

## 🔌 WebSocket

### Conexão

```
ws://localhost:3000/ws/chat?token=SEU_JWT_TOKEN
```

### Eventos do Cliente → Servidor

**Entrar em uma conversa:**
```json
{
  "type": "join",
  "data": {
    "agentId": "uuid",
    "conversationId": "optional-uuid"
  }
}
```

**Enviar mensagem:**
```json
{
  "type": "message",
  "data": {
    "agentId": "uuid",
    "content": "Sua mensagem aqui"
  }
}
```

### Eventos do Servidor → Cliente

**Conectado:**
```json
{
  "type": "connected",
  "data": {
    "message": "Conectado ao chat"
  }
}
```

**Entrou na conversa:**
```json
{
  "type": "joined",
  "data": {
    "agentId": "uuid",
    "conversationId": "uuid"
  }
}
```

**Processando:**
```json
{
  "type": "processing",
  "data": {
    "message": "Processando sua mensagem..."
  }
}
```

**Resposta da mensagem:**
```json
{
  "type": "message",
  "data": {
    "conversationId": "uuid",
    "message": {
      "id": "uuid",
      "role": "assistant",
      "content": "Resposta do agente",
      "createdAt": "2024-01-23T10:00:00Z"
    }
  }
}
```

**Erro:**
```json
{
  "type": "error",
  "data": {
    "error": "Descrição do erro"
  }
}
```

---

## ❌ Códigos de Erro

- `400` - Bad Request (dados inválidos)
- `401` - Unauthorized (não autenticado)
- `404` - Not Found (recurso não encontrado)
- `500` - Internal Server Error

**Formato de erro:**
```json
{
  "success": false,
  "error": "Mensagem de erro"
}
```

---

## 🧪 Exemplos com cURL

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

### Criar Agente
```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sofia",
    "creationMode": "simple",
    "objective": "Ajudar clientes",
    "persona": "amigável"
  }'
```

### Listar Plugins
```bash
curl http://localhost:3000/api/plugins \
  -H "Authorization: Bearer SEU_TOKEN"
```

### Instalar Plugin
```bash
curl -X POST http://localhost:3000/api/agents/AGENT_ID/plugins \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pluginId":"plugin.echo","isSandbox":false}'
```

### Enviar Mensagem
```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "AGENT_ID",
    "content": "Olá, agente!"
  }'
```
