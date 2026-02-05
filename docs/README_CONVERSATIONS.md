# 📚 Documentação - Sistema de Persistência de Conversas

## 🎯 Visão Geral

Este sistema permite que **todas as conversas e mensagens** sejam automaticamente salvas no MongoDB, mantendo um histórico completo das interações entre usuários e agentes de IA.

## 📖 Índice da Documentação

### 1️⃣ [CONVERSATION_QUICKSTART.md](./CONVERSATION_QUICKSTART.md)
**Comece por aqui!** Guia rápido para entender e usar o sistema.

**Conteúdo:**
- O que mudou
- Como funciona (automático)
- Setup inicial
- Como consultar histórico
- Endpoints disponíveis
- FAQ

👉 **Recomendado para:** Desenvolvedores que querem começar rapidamente

---

### 2️⃣ [CONVERSATION_PERSISTENCE.md](./CONVERSATION_PERSISTENCE.md)
Documentação técnica completa do sistema.

**Conteúdo:**
- Estrutura de dados detalhada
- Modelos MongoDB (Conversation, Message, Contact)
- Fluxo de funcionamento completo
- APIs de consulta (todas)
- Exemplos de uso básicos
- Cenários de uso (WebSocket, WhatsApp, Telegram, API)
- Índices do MongoDB
- Segurança
- Troubleshooting

👉 **Recomendado para:** Desenvolvedores que querem entender a arquitetura

---

### 3️⃣ [CONVERSATION_EXAMPLES.md](./CONVERSATION_EXAMPLES.md)
Exemplos práticos de código prontos para usar.

**Conteúdo:**
- Quick Start com curl
- Integração WhatsApp (código completo)
- Integração WebSocket (cliente completo)
- Dashboard de análise
- Gerenciamento de conversas (fechar, pausar, etc.)
- Testes automatizados

👉 **Recomendado para:** Desenvolvedores implementando integrações

---

### 4️⃣ [CONVERSATION_CHANGELOG.md](./CONVERSATION_CHANGELOG.md)
Resumo completo de tudo que foi implementado.

**Conteúdo:**
- Lista de arquivos criados/modificados
- Funcionalidades implementadas
- Estrutura de dados
- Fluxo de funcionamento
- Performance e segurança
- Próximos passos

👉 **Recomendado para:** Time de desenvolvimento e gestores

---

## 🚀 Início Rápido

### Passo 1: Migrar Índices (Opcional)

```bash
cd back
npm run migrate:indexes
```

### Passo 2: Iniciar Backend

```bash
npm run dev
```

### Passo 3: Testar

Envie uma mensagem:

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "agentId": "1",
    "content": "Olá, preciso de ajuda",
    "channel": "web"
  }'
```

Consulte as conversas:

```bash
curl -X GET "http://localhost:3000/api/agents/1/conversations" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 📊 Principais Funcionalidades

### ✅ Persistência Automática
Todas as conversas e mensagens são salvas automaticamente, sem necessidade de código adicional.

### ✅ Múltiplos Canais
Suporte completo para:
- WebSocket (chat web)
- WhatsApp
- Telegram
- API

### ✅ Histórico Completo
Cada mensagem salva com:
- Conteúdo
- Tipo (user, assistant, system, external)
- Status (queued, processing, delivered, failed)
- Métricas (tempo de resposta, tokens, modelo)
- Canal e metadados

### ✅ Consultas Flexíveis
APIs para buscar:
- Conversas por agente
- Conversas por usuário
- Conversas por canal
- Mensagens de uma conversa
- Conversa por origem (número WhatsApp, chat Telegram, etc.)
- Estatísticas e análises

### ✅ Origem e Destino
Rastreamento completo de:
- Quem enviou (usuário, número, chat)
- Para quem enviou (agente, bot)
- Canal utilizado

---

## 🗂️ Estrutura de Dados

### Conversation (Conversa)
```typescript
{
  conversationId: string;          // UUID único
  agentId: string;                 // ID do agente
  source: IContact;                // Origem (usuário)
  destination: IContact;           // Destino (agente)
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  status: 'active' | 'closed' | 'transferred' | 'paused';
  messageCount: number;            // Total de mensagens
  startedAt: Date;
  lastMessageAt: Date;
}
```

### Message (Mensagem)
```typescript
{
  messageId: string;               // UUID único
  conversationId: string;          // Referência à conversa
  content: string;                 // Conteúdo
  type: 'user' | 'assistant' | 'system' | 'external';
  direction: 'inbound' | 'outbound';
  status: 'queued' | 'processing' | 'delivered' | 'failed';
  processingTime?: number;         // ms
  tokensUsed?: number;             // Tokens consumidos
  model?: string;                  // Modelo de IA usado
  createdAt: Date;
}
```

---

## 🔌 Endpoints Principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/conversations/:id` | Buscar conversa |
| GET | `/api/conversations/:id/messages` | Buscar mensagens |
| GET | `/api/conversations/:id/full` | Conversa completa |
| GET | `/api/agents/:agentId/conversations` | Conversas de um agente |
| GET | `/api/users/:userId/conversations` | Conversas de um usuário |
| GET | `/api/agents/:agentId/conversations/stats` | Estatísticas |
| PATCH | `/api/conversations/:id/status` | Atualizar status |
| POST | `/api/conversations/find-by-source` | Buscar por origem |

---

## 🔐 Autenticação

Todas as rotas exigem autenticação:

- **JWT Token**: Para usuários normais (acesso às próprias conversas)
- **System Token**: Para integrações (N8N, webhooks - acesso completo)

```bash
# Com JWT
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Com System Token
Authorization: Bearer sys_token_xxxxx
```

---

## 📈 Performance

- ✅ Operações assíncronas (não bloqueiam)
- ✅ Índices otimizados no MongoDB
- ✅ Redis continua sendo usado para cache
- ✅ Resiliência: funciona mesmo se MongoDB falhar

---

## 🎯 Casos de Uso

### 1. Dashboard de Atendimento
Visualizar todas as conversas ativas e responder em tempo real.

### 2. Histórico de Conversas
Consultar interações passadas com um cliente.

### 3. Analytics
Analisar volume de mensagens, tempo de resposta, etc.

### 4. Retomar Conversa
Continuar conversa anterior (WhatsApp, Telegram).

### 5. Auditoria
Rastrear todas as interações para compliance.

---

## 🐛 Troubleshooting

### Mensagens não estão sendo salvas
1. Verificar se MongoDB está conectado
2. Verificar logs do backend
3. Executar `npm run migrate:indexes`

### Não consigo consultar conversas
1. Verificar autenticação (JWT válido)
2. Verificar se há conversas criadas
3. Testar endpoint de health: `GET /api/health`

### Erro ao buscar conversa por origem
1. Verificar se `sourceType` está correto
2. Verificar se `sourceIdentifier` contém os campos certos
3. Verificar se há conversa ativa com essa origem

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Consulte esta documentação
2. Verifique os exemplos práticos
3. Verifique o changelog

---

## 🗺️ Roadmap

### Implementado ✅
- [x] Persistência automática
- [x] Múltiplos canais
- [x] APIs de consulta
- [x] Origem e destino
- [x] Métricas e estatísticas

### Próximos Passos 🚀
- [ ] Dashboard visual
- [ ] Export de conversas
- [ ] Busca full-text
- [ ] Tags e categorias
- [ ] Anexos e mídias
- [ ] Transferência de conversas

---

## 📝 Versão

**Versão Atual:** 1.0.0  
**Última Atualização:** 2024  
**Status:** Produção ✅

---

**Pronto para usar!** 🎉

Para começar, leia o [CONVERSATION_QUICKSTART.md](./CONVERSATION_QUICKSTART.md)
