# 📮 Guia da Collection Postman - AI Agents Backend

## 📥 Como Importar

### 1. Importe a Collection

1. Abra o Postman
2. Clique em **Import** no canto superior esquerdo
3. Selecione o arquivo `AI_Agents_Backend.postman_collection.json`
4. Clique em **Import**

### 2. Importe o Environment (Opcional mas Recomendado)

1. Clique em **Import** novamente
2. Selecione o arquivo `AI_Agents_Backend.postman_environment.json`
3. Clique em **Import**
4. Selecione o environment "AI Agents - Development" no dropdown no canto superior direito

---

## 🚀 Fluxo de Uso Recomendado

### Passo 1: Verificar API
```
GET /api/health
```
Verifica se a API está rodando corretamente.

### Passo 2: Fazer Login
```
POST /api/auth/login
```

**Body de exemplo:**
```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

✅ O token JWT será salvo automaticamente na variável `{{token}}` através do script de teste!

### Passo 3: Criar um Agente

#### Opção A - Modo Simplificado
```
POST /api/agents
```

**Body:**
```json
{
  "name": "Sofia - Assistente Virtual",
  "creationMode": "simple",
  "objective": "Ajudar clientes com dúvidas sobre produtos e serviços",
  "persona": "Assistente virtual amigável e prestativa",
  "audience": "Clientes da loja online",
  "topics": "Produtos, serviços, pedidos, entregas, pagamentos",
  "restrictions": "Não fornecer informações sobre preços sem verificar o catálogo",
  "knowledgeSource": "Base de conhecimento da empresa",
  "useAI": false
}
```

#### Opção B - Modo Avançado
```
POST /api/agents
```

**Body:**
```json
{
  "name": "Carlos - Especialista Técnico",
  "creationMode": "advanced",
  "finalPrompt": "Você é Carlos, um especialista técnico altamente qualificado..."
}
```

✅ O ID do agente será salvo automaticamente em `{{agentId}}`!

### Passo 4: Listar Plugins Disponíveis
```
GET /api/plugins
```

Veja quais plugins estão disponíveis para instalação.

### Passo 5: Instalar um Plugin
```
POST /api/agents/{{agentId}}/plugins
```

**Plugins disponíveis:**

#### Echo Plugin
```json
{
  "pluginId": "echo",
  "isSandbox": false,
  "config": {
    "prefix": "[Echo]"
  }
}
```

#### Calendar Fake Plugin
```json
{
  "pluginId": "calendar_fake",
  "isSandbox": true,
  "config": {
    "maxEvents": 50,
    "defaultDuration": 60
  }
}
```

### Passo 6: Enviar uma Mensagem
```
POST /api/chat/message
```

**Body:**
```json
{
  "agentId": "{{agentId}}",
  "content": "Olá! Preciso de ajuda com meu pedido.",
  "channel": "web"
}
```

✅ O ID da conversa será salvo automaticamente em `{{conversationId}}`!

### Passo 7: Continuar a Conversa
```
POST /api/chat/message
```

**Body:**
```json
{
  "agentId": "{{agentId}}",
  "conversationId": "{{conversationId}}",
  "content": "Qual o status do meu pedido #12345?",
  "channel": "web"
}
```

---

## 📁 Estrutura da Collection

### 1. Health Check
- ✅ Check API Health

### 2. Authentication
- 👤 Register User
- 🔑 Login
- 👨‍💼 Get Current User

### 3. Agents
- ➕ Create Agent - Simple Mode
- ➕ Create Agent - Advanced Mode
- 📋 List Agents
- 🔍 Get Agent by ID
- ✏️ Update Agent
- 🗑️ Delete Agent

### 4. Plugins
- 📋 List All Plugins
- 🔍 Get Plugin by ID
- 📋 List Agent Plugins
- ➕ Install Plugin - Echo
- ➕ Install Plugin - Calendar Fake
- 🗑️ Uninstall Plugin

### 5. Chat
- 💬 Send Message (New Conversation)
- 💬 Send Message (Existing Conversation)
- 📖 Get Conversation
- 📋 List Agent Conversations

### 6. WebSocket Examples
- ℹ️ WebSocket Connection Info

---

## 🔑 Variáveis da Collection

A collection utiliza as seguintes variáveis que são gerenciadas automaticamente:

| Variável | Descrição | Gerenciamento |
|----------|-----------|---------------|
| `{{baseUrl}}` | URL base da API | Manual (padrão: http://localhost:3000) |
| `{{token}}` | Token JWT de autenticação | Automático após login |
| `{{agentId}}` | ID do último agente criado | Automático após criar agente |
| `{{conversationId}}` | ID da última conversa | Automático após enviar mensagem |
| `{{pluginId}}` | ID de plugin | Manual (echo ou calendar_fake) |

### Como Funciona o Gerenciamento Automático?

Alguns requests possuem **Test Scripts** que salvam automaticamente valores importantes:

#### Login
Após um login bem-sucedido, o script salva o token:
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    pm.collectionVariables.set('token', response.data.token);
}
```

#### Criar Agente
Salva automaticamente o ID do agente criado:
```javascript
if (pm.response.code === 201) {
    const response = pm.response.json();
    pm.collectionVariables.set('agentId', response.data.agent.id);
}
```

#### Enviar Mensagem
Salva o ID da conversa:
```javascript
if (pm.response.code === 200) {
    const response = pm.response.json();
    pm.collectionVariables.set('conversationId', response.data.conversationId);
}
```

---

## 🌐 WebSocket - Como Usar

### Pré-requisito
```bash
npm install -g wscat
```

### Conectar
```bash
# Substitua SEU_TOKEN pelo token JWT obtido no login
wscat -c "ws://localhost:3000/ws/chat?token=SEU_TOKEN"
```

### Comandos WebSocket

#### 1. Entrar em uma conversa
```json
{
  "type": "join",
  "data": {
    "agentId": "uuid-do-agente"
  }
}
```

**Resposta:**
```json
{
  "type": "joined",
  "data": {
    "agentId": "...",
    "agentName": "Sofia - Assistente Virtual"
  }
}
```

#### 2. Enviar mensagem
```json
{
  "type": "message",
  "data": {
    "agentId": "uuid-do-agente",
    "content": "Olá, preciso de ajuda!"
  }
}
```

**Resposta:**
```json
{
  "type": "message",
  "data": {
    "conversationId": "...",
    "messageId": "...",
    "content": "Olá, preciso de ajuda!",
    "role": "user",
    "timestamp": "..."
  }
}
```

Seguido por:
```json
{
  "type": "agent_response",
  "data": {
    "conversationId": "...",
    "messageId": "...",
    "content": "Olá! Como posso ajudá-lo?",
    "role": "agent",
    "timestamp": "..."
  }
}
```

#### 3. Continuar conversa existente
```json
{
  "type": "message",
  "data": {
    "agentId": "uuid-do-agente",
    "conversationId": "uuid-da-conversa",
    "content": "Mais uma pergunta..."
  }
}
```

#### 4. Heartbeat (ping)
```json
{
  "type": "ping"
}
```

**Resposta:**
```json
{
  "type": "pong"
}
```

#### 5. Sair
```json
{
  "type": "leave"
}
```

---

## 🔒 Autenticação

A maioria dos endpoints requer autenticação. O token JWT é automaticamente incluído no header:

```
Authorization: Bearer {{token}}
```

### Endpoints Públicos (sem autenticação)
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`

### Endpoints com Autenticação Flexível
Estes endpoints aceitam tanto autenticação JWT quanto System API Key:
- `GET /api/agents/:id`
- `GET /api/agents/:agentId/plugins`
- `GET /api/chat/conversations/:id`
- `GET /api/agents/:agentId/conversations`

Para usar System API Key:
```
x-api-key: sua-chave-de-sistema
```

---

## 📝 Exemplos de Respostas

### Login Bem-Sucedido
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Admin User",
      "email": "admin@example.com",
      "created_at": "2024-01-20T10:30:00.000Z"
    }
  }
}
```

### Agente Criado
```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "name": "Sofia - Assistente Virtual",
      "status": "active",
      "creation_mode": "simple",
      "objective": "Ajudar clientes...",
      "final_prompt": "Você é Sofia, uma assistente...",
      "created_at": "2024-01-20T11:00:00.000Z",
      "updated_at": "2024-01-20T11:00:00.000Z"
    }
  }
}
```

### Lista de Plugins
```json
{
  "success": true,
  "data": {
    "plugins": [
      {
        "id": "echo",
        "name": "Echo Plugin",
        "description": "Repete mensagens",
        "version": "1.0.0",
        "category": "utility"
      },
      {
        "id": "calendar_fake",
        "name": "Calendar Fake",
        "description": "Sistema de agendamento simulado",
        "version": "1.0.0",
        "category": "productivity"
      }
    ]
  }
}
```

### Erro de Validação
```json
{
  "success": false,
  "error": "Dados inválidos",
  "details": [
    {
      "path": ["email"],
      "message": "Email inválido"
    }
  ]
}
```

---

## 🎯 Casos de Uso Completos

### Caso 1: Criar um Agente de Suporte e Testar

1. **Login**
   ```
   POST /api/auth/login
   ```

2. **Criar Agente**
   ```
   POST /api/agents
   Body: Modo simplificado com objetivo de suporte
   ```

3. **Instalar Plugin Echo**
   ```
   POST /api/agents/{{agentId}}/plugins
   Body: { "pluginId": "echo", "isSandbox": false }
   ```

4. **Testar Chat**
   ```
   POST /api/chat/message
   Body: { "agentId": "{{agentId}}", "content": "teste" }
   ```

5. **Ver Histórico**
   ```
   GET /api/chat/conversations/{{conversationId}}
   ```

### Caso 2: Gerenciar Múltiplos Agentes

1. **Login**
2. **Criar Agente de Vendas** (modo simplificado)
3. **Criar Agente Técnico** (modo avançado)
4. **Listar Todos os Agentes**
   ```
   GET /api/agents
   ```
5. **Atualizar Status de um Agente**
   ```
   PUT /api/agents/{{agentId}}
   Body: { "status": "paused" }
   ```

---

## ⚙️ Configuração Avançada

### Alterar URL da API
Se sua API não está rodando em `localhost:3000`:

1. Vá até a aba **Variables** da collection
2. Edite o valor de `baseUrl`
3. Ou, se estiver usando o environment, edite lá

### Usar Token Manualmente
Se quiser usar um token específico sem fazer login:

1. Vá até **Variables**
2. Edite o campo `token`
3. Cole seu JWT

### Adicionar Headers Customizados
Para adicionar headers a todas as requisições:

1. Clique com botão direito na collection
2. **Edit**
3. Aba **Authorization** ou **Headers**
4. Adicione seus headers

---

## 🐛 Troubleshooting

### "Unauthorized" em todas as requisições
- ✅ Verifique se fez login e o token foi salvo
- ✅ Veja a aba **Console** do Postman para verificar os logs
- ✅ Confirme que a variável `{{token}}` está preenchida

### "Agent not found"
- ✅ Certifique-se de que criou um agente antes
- ✅ Verifique se a variável `{{agentId}}` está correta
- ✅ Use o endpoint **List Agents** para ver seus agentes

### "Connection refused" no WebSocket
- ✅ Confirme que a API está rodando
- ✅ Verifique se o token JWT está correto e válido
- ✅ Use `wscat -c "ws://localhost:3000/ws/chat?token=SEU_TOKEN"`

### Script de teste não está salvando variáveis
- ✅ Veja a aba **Console** do Postman
- ✅ Confirme que a resposta foi bem-sucedida (200 ou 201)
- ✅ Verifique a estrutura da resposta JSON

---

## 📚 Recursos Adicionais

- **README.md** - Documentação principal do projeto
- **API.md** - Documentação completa da API
- **QUICKSTART.md** - Guia de início rápido
- **N8N_INTEGRATION.md** - Como integrar com n8n

---

## 💡 Dicas

1. **Use o Console**: Sempre ative o Postman Console (View → Show Postman Console) para debug
2. **Variáveis Automatizadas**: Os scripts de teste já gerenciam token, agentId e conversationId automaticamente
3. **Ordem Recomendada**: Siga o fluxo: Login → Criar Agente → Instalar Plugin → Testar Chat
4. **WebSocket para Real-time**: Para chat em tempo real, prefira WebSocket ao invés de REST
5. **Save Responses**: Use "Save Response" para ter exemplos de respostas

---

**Desenvolvido com ❤️ para facilitar o teste da API de AI Agents** 🚀
