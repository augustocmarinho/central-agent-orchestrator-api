# 🚀 Guia Rápido - Sistema de Mensageria

## 📋 Pré-requisitos

Antes de iniciar, certifique-se que tem:
- ✅ Node.js 18+ instalado
- ✅ Docker e Docker Compose instalados
- ✅ PostgreSQL rodando (via Docker Compose)
- ✅ MongoDB rodando (via Docker Compose) - opcional
- ✅ Dependências instaladas (`npm install`)

---

## 🎯 Passo 1: Iniciar Infraestrutura

### Opção A: Iniciar todos os serviços

```bash
cd back
docker-compose up -d
```

Isso irá iniciar:
- PostgreSQL (porta 5432)
- MongoDB (porta 27017)
- Redis (porta 6379) 🆕

### Opção B: Iniciar apenas Redis

Se PostgreSQL e MongoDB já estão rodando:

```bash
docker-compose up -d redis
```

### Verificar Status

```bash
# Ver containers rodando
docker-compose ps

# Ver logs do Redis
docker-compose logs -f redis

# Testar conexão Redis
docker exec -it ai_agents_redis redis-cli ping
# Deve retornar: PONG
```

---

## 🎯 Passo 2: Configurar Variáveis de Ambiente

Certifique-se que o arquivo `.env` tem as configurações do Redis:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

## 🎯 Passo 3: Executar Migrations

Se ainda não executou:

```bash
npm run migrate
```

---

## 🎯 Passo 4: Iniciar Backend

### Modo Desenvolvimento (com hot reload)

```bash
npm run dev
```

Você deverá ver no console:

```
╔════════════════════════════════════════════╗
║   🤖 AI Agents Backend                     ║
╚════════════════════════════════════════════╝

🌍 Servidor rodando em: http://localhost:3000
🔌 WebSocket disponível em: ws://localhost:3000/ws/chat
📊 Health check: http://localhost:3000/api/health
📥 Message Queue: Redis on localhost:6379
🌐 Ambiente: development
📝 Log Level: info

✅ Redis client connected
✅ Redis publisher connected
✅ Redis subscriber connected
✅ Message Queue (Producer) initialized
✅ Message Consumer initialized
✅ Subscribed to response channels
✅ Sistema de mensageria inicializado
```

Se você vir esses logs, **tudo está funcionando perfeitamente!** ✨

---

## 🎯 Passo 5: Testar o Sistema

### 5.1 Fazer Login

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

**Copie o token JWT da resposta.**

### 5.2 Criar um Agente (se ainda não tem)

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Assistente de Testes",
    "creationMode": "simple",
    "objective": "Testar o sistema de mensageria",
    "persona": "amigável e técnico"
  }'
```

**Copie o `id` do agente.**

### 5.3 Enviar Mensagem (Assíncrono) 🎉

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "SEU_AGENT_ID_AQUI",
    "message": "Olá! Esta é uma mensagem de teste assíncrona.",
    "channel": "web"
  }'
```

**Resposta esperada (202 Accepted):**

```json
{
  "success": true,
  "message": "Mensagem recebida e em processamento",
  "data": {
    "messageId": "msg-uuid-123",
    "conversationId": "conv-uuid-456",
    "jobId": "msg-uuid-123",
    "status": "processing",
    "estimatedTime": "5-30 segundos"
  }
}
```

### 5.4 Verificar Status da Mensagem

```bash
curl http://localhost:3000/api/messages/SEU_MESSAGE_ID/status \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

**Resposta:**

```json
{
  "success": true,
  "data": {
    "messageId": "msg-uuid-123",
    "state": "completed",
    "progress": 100,
    "finishedOn": 1675350000000
  }
}
```

### 5.5 Ver Estatísticas da Fila

```bash
curl http://localhost:3000/api/messages/queue/stats \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

**Resposta:**

```json
{
  "success": true,
  "data": {
    "waiting": 0,
    "active": 0,
    "completed": 5,
    "failed": 0,
    "delayed": 0,
    "paused": 0,
    "total": 5
  }
}
```

---

## 🎯 Passo 6: Testar com WebSocket

### 6.1 Conectar ao WebSocket

Abra o console do navegador e execute:

```javascript
// 1. Conectar
const token = 'SEU_TOKEN_JWT_AQUI';
const ws = new WebSocket(`ws://localhost:3000/ws/chat?token=${token}`);

// 2. Listener de mensagens
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Recebido:', data);
};

ws.onopen = () => {
  console.log('✅ Conectado ao WebSocket');
};

ws.onerror = (error) => {
  console.error('❌ Erro:', error);
};
```

### 6.2 Enviar Mensagem

```javascript
// Enviar mensagem
ws.send(JSON.stringify({
  type: 'message',
  data: {
    agentId: 'SEU_AGENT_ID_AQUI',
    content: 'Olá! Como você está?'
  }
}));
```

### 6.3 Observar Fluxo Completo

Você deverá ver no console:

```javascript
// 1. Confirmação de conexão
{
  type: 'connected',
  data: {
    message: 'Conectado ao chat',
    socketId: 'ws-uuid-123'
  }
}

// 2. Mensagem enfileirada
{
  type: 'queued',
  data: {
    message: 'Mensagem recebida, processando...'
  }
}

// 3. Status de processamento
{
  type: 'processing',
  data: {
    conversationId: 'conv-uuid',
    messageId: 'msg-uuid',
    jobId: 'msg-uuid',
    status: 'processing'
  }
}

// 4. Resposta final (após 5-30 segundos)
{
  type: 'message',
  data: {
    messageId: 'msg-uuid',
    conversationId: 'conv-uuid',
    message: 'Olá! Estou muito bem, obrigado por perguntar!',
    timestamp: '2026-02-02T10:00:05Z',
    metadata: {
      model: 'gpt-4o-mini',
      tokensUsed: 120,
      processingTime: 2500,
      finishReason: 'stop'
    }
  }
}
```

---

## 📊 Monitorar o Sistema

### Ver Logs em Tempo Real

```bash
# Terminal 1: Logs gerais
npm run dev

# Terminal 2: Logs do Redis
docker-compose logs -f redis

# Terminal 3: Inspecionar fila (opcional)
docker exec -it ai_agents_redis redis-cli
> KEYS bull:*
> GET bull:ai-messages:1
```

### Inspecionar Filas no Redis

```bash
# Conectar ao Redis CLI
docker exec -it ai_agents_redis redis-cli

# Ver todas as keys do Bull
KEYS bull:*

# Ver jobs aguardando
LRANGE bull:ai-messages:wait 0 -1

# Ver jobs ativos
LRANGE bull:ai-messages:active 0 -1

# Ver estatísticas
HGETALL bull:ai-messages:meta
```

---

## 🐛 Troubleshooting

### Problema: Redis não conecta

**Sintoma:** `Redis client error` nos logs

**Solução:**

```bash
# Verificar se Redis está rodando
docker ps | grep redis

# Se não estiver, iniciar
docker-compose up -d redis

# Ver logs
docker-compose logs redis
```

### Problema: Jobs não são processados

**Sintoma:** `waiting` aumenta mas `completed` não

**Soluções:**

1. Verificar se consumer está rodando (deve aparecer nos logs)
2. Verificar logs de erro: `grep "Job failed" logs/combined.log`
3. Verificar se N8N está configurado e rodando

### Problema: WebSocket não recebe resposta

**Sintoma:** Mensagem processada mas não chega ao cliente

**Soluções:**

1. Verificar console do navegador (erros JS)
2. Confirmar que `socketId` está sendo registrado (ver logs)
3. Testar com polling: `GET /api/messages/{messageId}/status`

### Problema: TypeScript não compila

**Solução:**

```bash
# Limpar node_modules e reinstalar
rm -rf node_modules package-lock.json
npm install

# Verificar tipos
npx tsc --noEmit
```

---

## 🧪 Testes Adicionais

### Teste de Carga (Simples)

```bash
# Enviar 10 mensagens simultâneas
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"agentId\": \"$AGENT_ID\",
      \"message\": \"Mensagem de teste $i\"
    }" &
done
wait

# Ver estatísticas
curl http://localhost:3000/api/messages/queue/stats \
  -H "Authorization: Bearer $TOKEN"
```

### Health Check Completo

```bash
# Health check geral
curl http://localhost:3000/api/health

# Health check da fila
curl http://localhost:3000/api/messages/queue/health \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🎓 Próximos Passos

Agora que o sistema está funcionando:

1. ✅ Leia a [Documentação Completa](./docs/MESSAGING_ARCHITECTURE.md)
2. ✅ Configure o [N8N](./docs/N8N_INTEGRATION.md)
3. ✅ Implemente handlers para WhatsApp/Telegram
4. ✅ Configure monitoramento (Grafana, Prometheus)
5. ✅ Configure alertas (quando fila > 100)

---

## 📚 Documentação Relacionada

- [Arquitetura de Mensageria](./docs/MESSAGING_ARCHITECTURE.md)
- [Integração N8N](./docs/N8N_INTEGRATION.md)
- [Arquitetura do Sistema](./docs/ARCHITECTURE.md)

---

**Última atualização:** Fevereiro 2026

---

🎉 **Parabéns!** Seu sistema de mensageria assíncrona está funcionando perfeitamente!
