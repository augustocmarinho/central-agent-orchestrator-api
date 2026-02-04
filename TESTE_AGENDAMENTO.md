# 🧪 Teste Rápido: Agendamento de Mensagens

## 🚀 Teste em 5 Minutos

### 1️⃣ Agendar Mensagem para Daqui a 30 Segundos

```bash
# Calcular timestamp para 30 segundos no futuro
SCHEDULED_TIME=$(date -u -d '+30 seconds' +"%Y-%m-%dT%H:%M:%S.000Z")

curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"SEU_AGENT_ID\",
    \"message\": \"Esta mensagem foi agendada! ⏰\",
    \"channel\": \"web\",
    \"scheduledFor\": \"$SCHEDULED_TIME\"
  }"
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Mensagem agendada para 2026-02-02T15:30:45.000Z",
  "data": {
    "messageId": "msg-xxx",
    "conversationId": "conv-yyy",
    "jobId": "msg-xxx",
    "status": "scheduled",
    "scheduledFor": "2026-02-02T15:30:45.000Z",
    "estimatedTime": "Será processada no horário agendado"
  }
}
```

**Aguarde 30 segundos e:**
- ✅ Se você tiver WebSocket aberto na mesma conversa, receberá a mensagem
- ✅ Verifique o status: `GET /api/messages/msg-xxx/status`

---

### 2️⃣ Verificar Job no Redis

```bash
# Ver jobs agendados
redis-cli ZRANGE bull:ai-messages:delayed 0 -1 WITHSCORES

# Ver detalhes do job específico
redis-cli HGETALL bull:ai-messages:msg-xxx
```

**O que você verá:**

**Antes de processar (state = delayed):**
```bash
redis> ZRANGE bull:ai-messages:delayed 0 -1 WITHSCORES
1) "msg-xxx"
2) "1738594245000"  # Timestamp Unix
```

**Depois de 30 segundos (state = completed):**
```bash
redis> ZRANGE bull:ai-messages:delayed 0 -1
(empty array)  # Job foi movido para :completed

redis> ZRANGE bull:ai-messages:completed 0 -1 WITHSCORES
1) "msg-xxx"
2) "1738594250000"
```

---

### 3️⃣ Teste com WebSocket Aberto

**Terminal 1: Conectar WebSocket**

```bash
# Instale wscat se não tiver
npm install -g wscat

# Conecte
wscat -c "ws://localhost:3000/ws/chat?token=SEU_TOKEN"

# Envie (crie nova conversa ou use existente)
> {"type":"message","data":{"agentId":"SEU_AGENT_ID","content":"Olá"}}

# Anote o conversationId que receber!
```

**Terminal 2: Agendar Mensagem**

```bash
# Use o conversationId do WebSocket!
CONV_ID="conv-que-recebeu-do-websocket"
SCHEDULED_TIME=$(date -u -d '+15 seconds' +"%Y-%m-%dT%H:%M:%S.000Z")

curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"SEU_AGENT_ID\",
    \"conversationId\": \"$CONV_ID\",
    \"message\": \"Mensagem agendada chegou via POST! 📬\",
    \"channel\": \"web\",
    \"scheduledFor\": \"$SCHEDULED_TIME\"
  }"
```

**Terminal 1: Aguarde 15 segundos**

```
< {"type":"message","data":{"messageId":"msg-xxx",...,"message":"Mensagem agendada chegou via POST! 📬"}}
✅ Mensagem recebida no WebSocket!
```

---

## 📊 Testes de Validação

### Teste 1: Data no Passado (Deve Falhar)

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-123",
    "message": "Teste",
    "scheduledFor": "2020-01-01T00:00:00.000Z"
  }'
```

**Esperado:**
```json
{
  "success": false,
  "error": "scheduledFor deve ser uma data futura"
}
```

---

### Teste 2: Formato Inválido (Deve Falhar)

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-123",
    "message": "Teste",
    "scheduledFor": "invalid-date"
  }'
```

**Esperado:**
```json
{
  "success": false,
  "error": "scheduledFor deve ser uma data válida (ISO 8601)"
}
```

---

### Teste 3: Múltiplas Mensagens Agendadas

```bash
# Agendar 5 mensagens em intervalos de 10 segundos
for i in {1..5}; do
  DELAY=$((i * 10))
  SCHEDULED_TIME=$(date -u -d "+$DELAY seconds" +"%Y-%m-%dT%H:%M:%S.000Z")
  
  curl -X POST http://localhost:3000/api/messages \
    -H "Authorization: Bearer TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"agentId\": \"agent-123\",
      \"message\": \"Mensagem agendada #$i\",
      \"scheduledFor\": \"$SCHEDULED_TIME\"
    }"
  
  echo "Agendada #$i para +${DELAY}s"
  sleep 1
done
```

**Verificar:**
```bash
curl http://localhost:3000/api/messages/queue/stats \
  -H "Authorization: Bearer TOKEN"
```

**Esperado:**
```json
{
  "data": {
    "delayed": 5  ← 5 mensagens agendadas!
  }
}
```

---

## 🎯 Teste Completo: Fluxo End-to-End

### Cenário: Lembrete de Reunião

**1. Criar conversa via WebSocket:**

```javascript
// No browser console
const ws = new WebSocket('ws://localhost:3000/ws/chat?token=SEU_TOKEN');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'message',
    data: {
      agentId: 'agent-123',
      content: 'Agendar reunião para amanhã às 14:00'
    }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  
  if (data.type === 'processing') {
    window.conversationId = data.data.conversationId;
    console.log('✅ ConversationId:', window.conversationId);
  }
};
```

**2. Agendar lembrete para 1 minuto antes:**

```bash
# Use o conversationId obtido acima
CONV_ID="conv-xxx"

# Amanhã 13:59 (1 min antes da reunião)
TOMORROW_1359=$(date -u -d 'tomorrow 13:59' +"%Y-%m-%dT%H:%M:%S.000Z")

curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"agent-123\",
    \"conversationId\": \"$CONV_ID\",
    \"message\": \"⏰ LEMBRETE: Sua reunião começa em 1 minuto!\",
    \"channel\": \"web\",
    \"scheduledFor\": \"$TOMORROW_1359\"
  }"
```

**3. Verificar status:**

```bash
curl http://localhost:3000/api/messages/msg-xxx/status \
  -H "Authorization: Bearer TOKEN"
```

**Esperado:**
```json
{
  "data": {
    "state": "delayed",
    "progress": 0,
    "data": {
      "message": "⏰ LEMBRETE: Sua reunião começa em 1 minuto!"
    }
  }
}
```

**4. No horário agendado:**

- ✅ WebSocket recebe automaticamente
- ✅ Status muda para `completed`
- ✅ Job é removido de `:delayed`

---

## 📈 Monitoramento em Tempo Real

### Script de Monitoramento

```bash
#!/bin/bash
# monitor-scheduled.sh

while true; do
  clear
  echo "=== JOBS AGENDADOS ==="
  redis-cli ZRANGE bull:ai-messages:delayed 0 -1 WITHSCORES | \
    awk '{if(NR%2==1) {id=$1} else {print id " -> " strftime("%Y-%m-%d %H:%M:%S", $1/1000)}}'
  
  echo ""
  echo "=== ESTATÍSTICAS ==="
  curl -s http://localhost:3000/api/messages/queue/stats \
    -H "Authorization: Bearer TOKEN" | jq '.data'
  
  sleep 5
done
```

**Executar:**
```bash
chmod +x monitor-scheduled.sh
./monitor-scheduled.sh
```

---

## 🐛 Debug de Problemas

### Problema: Job não está sendo processado

**1. Verificar se está na fila delayed:**
```bash
redis-cli ZRANGE bull:ai-messages:delayed 0 -1 WITHSCORES
```

**2. Verificar timestamp:**
```bash
# Pegar timestamp do job
TIMESTAMP=$(redis-cli ZRANGE bull:ai-messages:delayed 0 0 WITHSCORES | tail -1)

# Comparar com agora
NOW=$(date +%s)000
echo "Job timestamp: $TIMESTAMP"
echo "Agora: $NOW"
echo "Diferença (segundos):" $(( ($TIMESTAMP - $NOW) / 1000 ))
```

**3. Verificar worker:**
```bash
curl http://localhost:3000/api/messages/queue/health \
  -H "Authorization: Bearer TOKEN"
```

**4. Ver logs:**
```bash
tail -f logs/combined.log | grep -i "scheduled\|delayed"
```

---

## ✅ Checklist de Teste

Marque conforme testar:

- [ ] Agendar mensagem para 30 segundos no futuro
- [ ] Verificar job aparece em `:delayed` no Redis
- [ ] Aguardar e confirmar processamento automático
- [ ] Receber via WebSocket (se conectado)
- [ ] Testar data no passado (deve falhar)
- [ ] Testar formato inválido (deve falhar)
- [ ] Agendar múltiplas mensagens
- [ ] Verificar estatísticas da fila
- [ ] Monitorar estado do job
- [ ] Testar com diferentes canais (web, whatsapp)

---

**Tudo testado? Sistema funcionando perfeitamente! 🚀**
