# 📅 Agendamento de Mensagens

Sistema completo para agendar mensagens para serem processadas em horários específicos.

---

## 🎯 Funcionalidades

✅ Agendar mensagem para horário específico  
✅ Visualizar jobs agendados no Redis  
✅ Cancelar agendamento  
✅ Monitorar status de agendamento  
✅ Suporta todos os canais (web, whatsapp, telegram)

---

## 🚀 Como Usar

### 1️⃣ Via API REST

#### Enviar Mensagem Agendada

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-123",
    "conversationId": "conv-456",
    "message": "Lembrete: Reunião em 15 minutos!",
    "channel": "web",
    "scheduledFor": "2026-02-03T14:00:00.000Z"
  }'
```

**Resposta:**
```json
{
  "success": true,
  "message": "Mensagem agendada para 2026-02-03T14:00:00.000Z",
  "data": {
    "messageId": "msg-abc-123",
    "conversationId": "conv-456",
    "jobId": "msg-abc-123",
    "status": "scheduled",
    "scheduledFor": "2026-02-03T14:00:00.000Z",
    "estimatedTime": "Será processada no horário agendado"
  }
}
```

---

### 2️⃣ Via WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/chat?token=SEU_TOKEN');

ws.onopen = () => {
  // Enviar mensagem agendada
  ws.send(JSON.stringify({
    type: 'message',
    data: {
      agentId: 'agent-123',
      conversationId: 'conv-456',
      content: 'Lembrete: Reunião em 15 minutos!',
      scheduledFor: '2026-02-03T14:00:00.000Z'
    }
  }));
};
```

---

## 📅 Formatos de Data Aceitos

### ISO 8601 String (Recomendado)
```json
{
  "scheduledFor": "2026-02-03T14:00:00.000Z"
}
```

### Timestamp Unix (Milissegundos)
```json
{
  "scheduledFor": 1738594800000
}
```

### Exemplos de Cálculo

```javascript
// Daqui a 1 hora
const in1Hour = new Date(Date.now() + 60 * 60 * 1000);

// Amanhã às 14:00
const tomorrow2pm = new Date();
tomorrow2pm.setDate(tomorrow2pm.getDate() + 1);
tomorrow2pm.setHours(14, 0, 0, 0);

// Próxima segunda-feira às 09:00
const nextMonday = new Date();
const daysUntilMonday = (8 - nextMonday.getDay()) % 7 || 7;
nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
nextMonday.setHours(9, 0, 0, 0);
```

---

## 🔍 Monitoramento

### Verificar Status do Job Agendado

```bash
curl http://localhost:3000/api/messages/msg-abc-123/status \
  -H "Authorization: Bearer TOKEN"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "messageId": "msg-abc-123",
    "state": "delayed",
    "progress": 0,
    "data": {
      "id": "msg-abc-123",
      "agentId": "agent-123",
      "conversationId": "conv-456",
      "message": "Lembrete: Reunião em 15 minutos!",
      "channel": "web",
      "scheduledFor": "2026-02-03T14:00:00.000Z"
    },
    "processedOn": null,
    "finishedOn": null
  }
}
```

**Estados possíveis:**
- `delayed` → Aguardando horário agendado
- `waiting` → Pronto para processar (horário chegou)
- `active` → Sendo processado agora
- `completed` → Processado e entregue
- `failed` → Erro no processamento

---

### Ver Todos os Jobs Agendados

```bash
curl http://localhost:3000/api/messages/queue/stats \
  -H "Authorization: Bearer TOKEN"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "waiting": 5,
    "active": 2,
    "completed": 1234,
    "failed": 12,
    "delayed": 45,      ← Jobs agendados!
    "paused": 0,
    "total": 1298
  }
}
```

---

## 🗂️ Como Funciona no Redis

### Estrutura de Armazenamento

Quando você agenda uma mensagem, o Bull.js cria:

```
1. ZADD bull:ai-messages:delayed {timestamp} "msg-abc-123"
   ↓ Adiciona job no Sorted Set (ordenado por timestamp)

2. HSET bull:ai-messages:msg-abc-123 
   data: {...}
   opts: {"delay": 3600000}
   ↓ Armazena dados completos do job

3. (Quando timestamp chega)
   ZREM bull:ai-messages:delayed "msg-abc-123"
   ZADD bull:ai-messages:wait {timestamp} "msg-abc-123"
   ↓ Move automaticamente para fila de espera
```

### Visualizar no Redis

```bash
# Ver todos os jobs agendados
redis-cli ZRANGE bull:ai-messages:delayed 0 -1 WITHSCORES

# Resultado:
# "msg-abc-123"
# "1738594800000"  ← Timestamp Unix quando será processado

# Ver detalhes do job
redis-cli HGETALL bull:ai-messages:msg-abc-123
```

---

## 📊 Casos de Uso

### 1. Lembretes Automáticos

```javascript
// Lembrar cliente 1 hora antes da reunião
const meetingTime = new Date('2026-02-03T15:00:00Z');
const reminderTime = new Date(meetingTime.getTime() - 60 * 60 * 1000);

await fetch('http://localhost:3000/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-123',
    conversationId: 'conv-456',
    message: 'Lembrete: Sua reunião começa em 1 hora!',
    channel: 'whatsapp',
    scheduledFor: reminderTime.toISOString()
  })
});
```

---

### 2. Follow-up Automático

```javascript
// Enviar follow-up 24h após primeira mensagem
const followUpTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

await fetch('http://localhost:3000/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-support',
    conversationId: 'conv-789',
    message: 'Olá! Tudo certo com sua solicitação anterior?',
    channel: 'web',
    scheduledFor: followUpTime.toISOString()
  })
});
```

---

### 3. Mensagens em Horário Comercial

```javascript
// Garantir que mensagem seja enviada apenas em horário comercial
function getNextBusinessHour() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  
  // Se for fim de semana (sábado=6, domingo=0)
  if (day === 0 || day === 6) {
    // Agendar para segunda-feira às 09:00
    const daysUntilMonday = day === 0 ? 1 : 2;
    now.setDate(now.getDate() + daysUntilMonday);
    now.setHours(9, 0, 0, 0);
    return now;
  }
  
  // Se for fora do horário comercial (antes das 8h ou depois das 18h)
  if (hour < 8) {
    now.setHours(9, 0, 0, 0);
    return now;
  } else if (hour >= 18) {
    // Agendar para próximo dia útil às 09:00
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
    return now;
  }
  
  // Já está em horário comercial, enviar imediatamente
  return now;
}

const scheduledFor = getNextBusinessHour();

await fetch('http://localhost:3000/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'agent-123',
    message: 'Olá! Como podemos ajudar?',
    scheduledFor: scheduledFor.toISOString()
  })
});
```

---

### 4. Campanhas Agendadas

```javascript
// Agendar série de mensagens de campanha
const messages = [
  { delay: 0, text: 'Bem-vindo! Aqui está seu guia de início.' },
  { delay: 24, text: 'Dia 2: Aprenda sobre nossas funcionalidades.' },
  { delay: 72, text: 'Dia 3: Dicas avançadas para você.' },
  { delay: 168, text: 'Semana 1 concluída! Como está sua experiência?' }
];

for (const msg of messages) {
  const scheduledFor = new Date(Date.now() + msg.delay * 60 * 60 * 1000);
  
  await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentId: 'agent-onboarding',
      conversationId: 'conv-new-user',
      message: msg.text,
      scheduledFor: scheduledFor.toISOString()
    })
  });
}
```

---

## ⚠️ Limitações e Boas Práticas

### ✅ Boas Práticas

1. **Sempre valide a data:**
   ```javascript
   const date = new Date(scheduledFor);
   if (isNaN(date.getTime()) || date < new Date()) {
     throw new Error('Data inválida ou no passado');
   }
   ```

2. **Use timezone correto:**
   ```javascript
   // Sempre use UTC para evitar ambiguidades
   const scheduledFor = new Date('2026-02-03T14:00:00.000Z');
   ```

3. **Considere timezone do usuário:**
   ```javascript
   // Se usuário está em UTC-3 e quer mensagem às 14:00 local:
   const localTime = new Date('2026-02-03T14:00:00');
   const utcTime = new Date(localTime.getTime() + 3 * 60 * 60 * 1000);
   ```

4. **Não abuse de agendamentos muito distantes:**
   - Máximo recomendado: 30 dias
   - Para períodos maiores, use um sistema de calendário

### ❌ Limitações

1. **Precisão:** ±1 segundo (depende do polling do Bull)
2. **Persistência:** Se Redis reiniciar, jobs agendados são mantidos (AOF/RDB)
3. **Timezone:** Sempre trabalhe em UTC
4. **Máximo de jobs agendados:** Limitado pela memória do Redis

---

## 🐛 Troubleshooting

### Problema: Mensagem não foi enviada no horário agendado

**Checklist:**
1. ✅ Verificar se worker está rodando: `GET /api/messages/queue/health`
2. ✅ Verificar estado do job: `GET /api/messages/:messageId/status`
3. ✅ Verificar logs do backend: `tail -f logs/combined.log`
4. ✅ Verificar Redis: `redis-cli ZRANGE bull:ai-messages:delayed 0 -1`

### Problema: Data no passado

**Erro:**
```json
{
  "success": false,
  "error": "scheduledFor deve ser uma data futura"
}
```

**Solução:**
```javascript
// Sempre adicione buffer para considerar latência
const scheduledFor = new Date(Date.now() + 60000); // +1 minuto
```

### Problema: Timezone incorreto

**Sintoma:** Mensagem enviada 3 horas antes/depois

**Solução:** Use sempre UTC:
```javascript
// ❌ Errado
const scheduledFor = new Date('2026-02-03 14:00:00'); // Ambíguo!

// ✅ Correto
const scheduledFor = new Date('2026-02-03T14:00:00.000Z'); // UTC explícito
```

---

## 📚 Referências

- [Bull Documentation - Delayed Jobs](https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queueadd)
- [Redis ZADD Command](https://redis.io/commands/zadd/)
- [ISO 8601 Date Format](https://en.wikipedia.org/wiki/ISO_8601)

---

## 🎯 Próximos Passos

- [ ] Dashboard para visualizar jobs agendados
- [ ] Cancelamento de agendamentos via API
- [ ] Reagendamento (mudar horário de job existente)
- [ ] Repetição periódica (diário, semanal, mensal)
- [ ] Timezone por usuário (conversão automática)

---

**Pronto para usar! 🚀**
