# 🤖 Criação de Agentes com IA (OpenAI via n8n)

Este documento explica como usar o endpoint de criação de agentes com IA.

## 🎯 Visão Geral

O sistema agora permite criar agentes de duas formas:

1. **Tradicional**: Você fornece os dados e o sistema gera o prompt localmente
2. **Com IA** ⭐: O sistema usa OpenAI (via n8n) para gerar uma configuração profissional

## 🔄 Fluxo Completo

```
curl (Frontend)
   ↓
Backend Node.js
   ↓
n8n Webhook
   ↓
OpenAI GPT-4
   ↓
Gera Configuração Profissional
   ↓
n8n retorna para Node.js
   ↓
Node.js salva no PostgreSQL
   ↓
Retorna para Frontend
```

## 📡 Endpoint

### POST /api/agents (com IA)

**URL:** `http://localhost:3000/api/agents`

**Headers:**
```
Authorization: Bearer {seu-token-jwt}
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Sofia - Vendas Premium",
  "creationMode": "simple",
  "useAI": true,
  "objective": "Ajudar clientes a escolher o melhor produto",
  "persona": "profissional e consultiva",
  "audience": "Clientes high-ticket interessados em produtos premium",
  "topics": "Produtos premium, benefícios, comparações, garantias",
  "restrictions": "Não fazer desconto sem autorização, não prometer o que não pode cumprir"
}
```

**Campos:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do agente |
| `creationMode` | string | Não | `simple` ou `advanced` (default: simple) |
| `useAI` | boolean | Não | Se `true`, usa OpenAI para gerar (default: false) |
| `objective` | string | Não | Objetivo principal do agente |
| `persona` | string | Não | Tom/personalidade |
| `audience` | string | Não | Público-alvo |
| `topics` | string | Não | Tópicos que deve abordar |
| `restrictions` | string | Não | Restrições importantes |

## 🧪 Exemplos

### 1. Criar Agente SEM IA (Tradicional)

```bash
TOKEN="seu-token-aqui"

curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agente Básico",
    "creationMode": "simple",
    "objective": "Ajudar usuários"
  }'
```

### 2. Criar Agente COM IA (OpenAI) ⭐

```bash
TOKEN="seu-token-aqui"

curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sofia - Vendas Premium",
    "creationMode": "simple",
    "useAI": true,
    "objective": "Ajudar clientes a escolher o melhor produto premium",
    "persona": "profissional, consultiva e empática",
    "audience": "Clientes de alta renda interessados em produtos premium",
    "topics": "Produtos premium, benefícios exclusivos, comparações detalhadas, garantias vitalícias",
    "restrictions": "Nunca fazer desconto sem autorização da gerência, não prometer entrega instantânea"
  }'
```

### 3. Exemplo de Resposta (Com IA)

```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "uuid-do-agente",
      "userId": "uuid-do-usuario",
      "name": "Sofia - Vendas Premium",
      "status": "active",
      "createdAt": "2024-01-23T10:00:00.000Z",
      "updatedAt": "2024-01-23T10:00:00.000Z",
      "prompt": {
        "objective": "Ajudar clientes a escolher o melhor produto premium",
        "persona": "profissional, consultiva e empática",
        "audience": "Clientes de alta renda...",
        "topics": "Produtos premium...",
        "restrictions": "Nunca fazer desconto...",
        "knowledgeSource": null,
        "finalPrompt": "Você é Sofia, uma consultora especializada em vendas premium...\n\n[PROMPT GERADO PELA IA]",
        "creationMode": "simple"
      },
      "aiGenerated": {
        "capabilities": [
          "Análise de necessidades do cliente",
          "Recomendação personalizada de produtos",
          "Comparação detalhada entre opções",
          "Explicação de benefícios exclusivos",
          "Gestão de objeções"
        ],
        "guidelines": [
          "Fazer perguntas abertas para entender necessidades",
          "Usar linguagem consultiva, não vendedora",
          "Focar em valor, não em preço",
          "Ser transparente sobre prazos e garantias"
        ],
        "restrictions": [
          "Nunca oferecer desconto sem autorização",
          "Não prometer entrega instantânea",
          "Não fazer comparações negativas com concorrentes",
          "Não pressionar o cliente"
        ],
        "generatedBy": "openai-gpt4"
      }
    }
  }
}
```

## 🔧 Configuração Necessária

### 1. n8n Rodando

```bash
cd n8n
docker-compose up -d
```

Acesse: `http://localhost:5678`
- Usuário: `admin`
- Senha: `admin123`

### 2. Configurar OpenAI no n8n

1. No n8n, vá em **Settings → Credentials**
2. Clique em **Add Credential**
3. Selecione **OpenAI**
4. Cole sua API Key da OpenAI
5. Salve como **"OpenAI Account"**

### 3. Importar Workflow

1. No n8n, vá em **Workflows**
2. Clique em **Import from File**
3. Selecione `/n8n/workflows/create-agent.json`
4. **Ative o workflow**

### 4. Verificar Webhook

No workflow importado, copie a URL do webhook. Deve ser:
```
http://localhost:5678/webhook/create-agent
```

## 🎨 Diferenças: Com IA vs Sem IA

### Sem IA (Tradicional)

```
Entrada:
  name: "Agente de Vendas"
  objective: "Vender produtos"

Saída:
  Prompt básico gerado pelo template local
```

### Com IA (OpenAI via n8n) ⭐

```
Entrada:
  name: "Sofia - Vendas Premium"
  objective: "Ajudar clientes a escolher produtos premium"
  persona: "consultiva e empática"
  audience: "Clientes high-ticket"

Processamento:
  1. Node.js envia para n8n
  2. n8n processa com GPT-4
  3. GPT-4 gera:
     - Prompt profissional detalhado
     - Lista de capabilities
     - Guidelines de comportamento
     - Restrições específicas
     - Personalidade refinada

Saída:
  Configuração completa e profissional
  pronta para uso em produção
```

## 🚀 Vantagens de Usar IA

✅ **Prompt mais rico e detalhado**  
✅ **Capabilities sugeridas automaticamente**  
✅ **Guidelines de comportamento profissionais**  
✅ **Personalidade refinada**  
✅ **Adaptado ao contexto específico**  
✅ **Economiza tempo de configuração**  

## ⚠️ Considerações

### Custos

- Cada criação com IA consome tokens da OpenAI
- GPT-4 é mais caro que GPT-3.5
- Recomendado: usar GPT-3.5-turbo em desenvolvimento

### Tempo de Resposta

- Com IA: 5-15 segundos (depende da OpenAI)
- Sem IA: <1 segundo

### Fallback

Se a IA falhar (n8n offline, sem créditos OpenAI, etc):
- Sistema automaticamente volta para geração local
- Agente é criado normalmente com o prompt básico
- Nenhum erro é mostrado ao usuário

## 🐛 Troubleshooting

### "n8n não configurado, usando geração local"

**Solução:**
```bash
# Verifique se n8n está rodando
curl http://localhost:5678/healthz

# Se não estiver, inicie
cd n8n
docker-compose up -d
```

### "OpenAI API key inválida"

**Solução:**
1. Acesse n8n: `http://localhost:5678`
2. Vá em Settings → Credentials
3. Edite "OpenAI Account"
4. Cole uma API key válida da OpenAI

### Timeout na criação

**Solução:**
- OpenAI pode demorar
- Timeout configurado: 60 segundos
- Se passar disso, sistema usa fallback

## 📊 Logs

O backend loga todas as etapas:

```
🤖 Usando IA para gerar configuração do agente...
🤖 Chamando n8n para criar agente com OpenAI...
✅ Resposta do n8n recebida
✅ Configuração gerada pela IA com sucesso
```

Ou se falhar:

```
⚠️  IA não disponível, usando geração local
```

## 🎯 Casos de Uso

### 1. Agente de Vendas Complexo

Use IA quando:
- Produto é complexo
- Público é específico
- Tom de voz é crucial
- Muitas nuances no atendimento

### 2. Agente Simples

Não precisa de IA quando:
- FAQ básico
- Respostas simples e diretas
- Sem personalização necessária

## 🔐 Segurança

- API key da OpenAI fica **apenas no n8n**
- Frontend **nunca** acessa OpenAI diretamente
- Node.js **nunca** tem a API key
- Tudo passa pelo n8n (gateway seguro)

---

**Pronto para criar agentes incríveis com IA!** 🚀
