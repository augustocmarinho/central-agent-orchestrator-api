# Como Criar um Novo Plugin - Exemplo Prático

## Exemplo: Plugin de Email

Vamos criar um plugin que permite ao agente enviar emails.

### 1. Criar Estrutura de Arquivos

```
back/src/plugins/email/
├── manifest.json
└── handler.ts
```

### 2. Criar `manifest.json`

```json
{
  "id": "plugin.email",
  "name": "Email",
  "category": "comunicacao",
  "description": "Permite ao agente enviar emails",
  "version": "1.0.0",
  "auth_type": "oauth",
  "supports_sandbox": true,
  "config_schema": [
    {
      "key": "smtp_host",
      "type": "string",
      "required": true,
      "description": "Servidor SMTP"
    },
    {
      "key": "smtp_port",
      "type": "number",
      "required": true,
      "description": "Porta SMTP"
    },
    {
      "key": "smtp_user",
      "type": "string",
      "required": true,
      "description": "Usuário SMTP"
    },
    {
      "key": "smtp_pass",
      "type": "string",
      "required": true,
      "secret": true,
      "description": "Senha SMTP"
    },
    {
      "key": "from_email",
      "type": "string",
      "required": true,
      "description": "Email do remetente"
    },
    {
      "key": "from_name",
      "type": "string",
      "required": false,
      "description": "Nome do remetente"
    }
  ],
  "depends_on": []
}
```

### 3. Criar `handler.ts`

```typescript
import nodemailer from 'nodemailer';
import { logInfo, logError } from '../../utils/logger';

interface EmailData {
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
}

interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  from_email: string;
  from_name?: string;
}

export const emailPlugin = {
  id: 'plugin.email',
  
  /**
   * Executa uma ação do plugin
   */
  async execute(action: string, data: any, config: EmailConfig) {
    switch (action) {
      case 'send':
        return await this.sendEmail(data, config);
      case 'validate':
        return await this.validateEmail(data);
      default:
        throw new Error(`Ação desconhecida: ${action}`);
    }
  },
  
  /**
   * Envia um email
   */
  async sendEmail(data: EmailData, config: EmailConfig) {
    try {
      logInfo('Enviando email', { to: data.to, subject: data.subject });
      
      // Criar transportador
      const transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port,
        secure: config.smtp_port === 465,
        auth: {
          user: config.smtp_user,
          pass: config.smtp_pass,
        },
      });
      
      // Preparar email
      const mailOptions = {
        from: config.from_name 
          ? `"${config.from_name}" <${config.from_email}>`
          : config.from_email,
        to: Array.isArray(data.to) ? data.to.join(', ') : data.to,
        subject: data.subject,
        [data.html ? 'html' : 'text']: data.body,
      };
      
      // Enviar
      const info = await transporter.sendMail(mailOptions);
      
      logInfo('Email enviado com sucesso', { messageId: info.messageId });
      
      return {
        success: true,
        messageId: info.messageId,
        message: 'Email enviado com sucesso',
      };
    } catch (error: any) {
      logError('Erro ao enviar email', error);
      throw new Error(`Falha ao enviar email: ${error.message}`);
    }
  },
  
  /**
   * Valida um endereço de email
   */
  async validateEmail(data: { email: string }) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(data.email);
    
    return {
      success: true,
      valid: isValid,
      email: data.email,
    };
  },
};

export default emailPlugin;
```

### 4. Instalar Dependências

```bash
cd back
npm install nodemailer
npm install --save-dev @types/nodemailer
```

### 5. Registrar em `back/src/plugins/index.ts`

```typescript
// ... imports existentes
import emailManifest from './email/manifest.json';

export const defaultPlugins = [
  {
    ...calendarFakeManifest,
    manifest: calendarFakeManifest,
  },
  {
    ...echoManifest,
    manifest: echoManifest,
  },
  // ✅ Adicionar novo plugin
  {
    ...emailManifest,
    manifest: emailManifest,
  },
];

// ... código existente

// ✅ Exportar handler
export { default as emailPlugin } from './email/handler';
```

### 6. Reiniciar o Backend

```bash
npm run dev
```

O plugin será automaticamente registrado no banco de dados na inicialização.

### 7. Usar no Frontend

1. Acessar detalhes de um agente
2. Clicar em "Gerenciar Plugins"
3. Na aba "Disponíveis", procurar por "Email"
4. Clicar em "Instalar"
5. Configurar as credenciais SMTP (se necessário)

## Exemplo de Plugin com Dependências

### Plugin de Notificações que depende do Email

```json
{
  "id": "plugin.notifications",
  "name": "Notificações",
  "category": "comunicacao",
  "description": "Sistema de notificações multi-canal",
  "version": "1.0.0",
  "auth_type": "none",
  "supports_sandbox": true,
  "config_schema": [],
  "depends_on": ["plugin.email"]
}
```

Quando o usuário tentar instalar este plugin:
- O sistema verificará se `plugin.email` está instalado
- Se não estiver, retornará erro
- Se estiver, permitirá a instalação

## Exemplo de Plugin com Auth OAuth

```json
{
  "id": "plugin.google_calendar",
  "name": "Google Calendar",
  "category": "produtividade",
  "description": "Integração com Google Calendar",
  "version": "1.0.0",
  "auth_type": "oauth",
  "supports_sandbox": false,
  "config_schema": [
    {
      "key": "client_id",
      "type": "string",
      "required": true,
      "description": "Google OAuth Client ID"
    },
    {
      "key": "client_secret",
      "type": "string",
      "required": true,
      "secret": true,
      "description": "Google OAuth Client Secret"
    },
    {
      "key": "refresh_token",
      "type": "string",
      "required": true,
      "secret": true,
      "description": "Refresh Token do OAuth"
    }
  ],
  "depends_on": []
}
```

## Tipos de Categorias Sugeridas

- `comunicacao`: Plugins de comunicação (email, SMS, WhatsApp, etc.)
- `produtividade`: Ferramentas de produtividade (calendário, tarefas, etc.)
- `integracao`: Integrações com APIs externas
- `agendamento`: Sistemas de agendamento
- `utilitario`: Utilidades gerais
- `analise`: Análise de dados
- `automacao`: Automação de processos
- `armazenamento`: Sistemas de armazenamento (cloud, database, etc.)

## Tipos de Auth

- `none`: Não requer autenticação
- `api_key`: Autenticação via API Key
- `oauth`: Autenticação OAuth 2.0
- `basic`: Autenticação básica (user/password)
- `token`: Autenticação via token

## Boas Práticas

1. **Logging**: Sempre fazer log das operações importantes
2. **Tratamento de Erros**: Capturar e tratar erros adequadamente
3. **Validação**: Validar inputs antes de processar
4. **Configuração**: Usar o sistema de configuração para valores variáveis
5. **Sandbox**: Implementar modo sandbox quando possível
6. **Documentação**: Documentar capabilities e como usar
7. **Versionamento**: Usar versionamento semântico
8. **Dependências**: Declarar dependências explicitamente
9. **Secrets**: Marcar configurações sensíveis como `secret: true`
10. **Performance**: Otimizar para não bloquear o agente

## Testando o Plugin

### Via API

```bash
# 1. Listar plugins disponíveis
curl http://localhost:3000/api/plugins \
  -H "Authorization: Bearer $TOKEN"

# 2. Instalar no agente
curl -X POST http://localhost:3000/api/agents/$AGENT_ID/plugins \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pluginId": "plugin.email",
    "isSandbox": false,
    "config": {
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "smtp_user": "seu@email.com",
      "smtp_pass": "sua_senha",
      "from_email": "seu@email.com",
      "from_name": "Seu Nome"
    }
  }'

# 3. Verificar instalação
curl http://localhost:3000/api/agents/$AGENT_ID/plugins \
  -H "Authorization: Bearer $TOKEN"
```

### Via Chat

Após instalar, o agente poderá usar o plugin nas conversas:

```
Usuário: "Envie um email para contato@example.com com o assunto 'Teste' e mensagem 'Olá!'"

Agente: *usa o plugin de email*
"Email enviado com sucesso para contato@example.com!"
```

## Troubleshooting

### Plugin não aparece na lista

- Verificar se o manifest.json está correto
- Verificar se foi adicionado em `defaultPlugins` em `plugins/index.ts`
- Reiniciar o backend
- Verificar logs do backend na inicialização

### Erro ao instalar

- Verificar dependências (se houver)
- Verificar se o `pluginId` está correto
- Verificar logs do backend

### Plugin instalado mas não funciona

- Verificar configurações (config)
- Verificar logs de execução do plugin
- Verificar se o handler está exportado corretamente
- Verificar se há erros no código do handler
