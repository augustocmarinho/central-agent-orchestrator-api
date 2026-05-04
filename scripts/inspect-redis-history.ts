/**
 * Inspeciona o histórico de chat de uma conversa no Redis.
 *
 * Uso:
 *   npx tsx scripts/inspect-redis-history.ts <conversationId>
 *
 * Imprime:
 *   - resumo (summary) atual, se houver
 *   - número de mensagens na janela recente
 *   - cada mensagem formatada (role / ts / preview de conteúdo)
 *   - tamanho total em bytes da chave Redis
 *   - TTL restante
 */

import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function preview(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function roleColor(role: string): string {
  if (role === 'user') return c.cyan;
  if (role === 'assistant') return c.green;
  if (role === 'system') return c.magenta;
  return c.gray;
}

async function main() {
  const conversationId = process.argv[2];
  if (!conversationId) {
    console.error(`Uso: npx tsx scripts/inspect-redis-history.ts <conversationId>`);
    process.exit(1);
  }

  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD });
  const key = `chat:${conversationId}`;

  try {
    const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);

    console.log(`\n${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
    console.log(`${c.bold}  Chat History Inspector${c.reset}`);
    console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
    console.log(`  Conversation: ${c.cyan}${conversationId}${c.reset}`);
    console.log(`  Redis key:    ${c.gray}${key}${c.reset}`);

    if (!raw) {
      console.log(`\n  ${c.yellow}Nenhum histórico encontrado para essa conversa.${c.reset}\n`);
      return;
    }

    const sizeBytes = Buffer.byteLength(raw, 'utf8');
    console.log(`  Tamanho:      ${c.bold}${sizeBytes}${c.reset} bytes`);
    console.log(
      `  TTL:          ${ttl > 0 ? `${c.green}${ttl}s${c.reset} (~${Math.round(ttl / 3600)}h)` : `${c.red}sem TTL${c.reset}`}`
    );

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`\n  ${c.red}Conteúdo não é JSON válido.${c.reset}`);
      console.log(raw);
      return;
    }

    const isLegacy = Array.isArray(parsed);
    const summary: string | null = isLegacy ? null : (typeof parsed.summary === 'string' ? parsed.summary : null);
    const messages: any[] = isLegacy ? parsed : (Array.isArray(parsed.messages) ? parsed.messages : []);

    console.log(`  Formato:      ${isLegacy ? `${c.yellow}LEGADO (array puro)${c.reset}` : `${c.green}NOVO (summary+messages)${c.reset}`}`);
    console.log(`  Mensagens:    ${c.bold}${messages.length}${c.reset}`);

    if (summary) {
      console.log(`\n${c.bold}  RESUMO:${c.reset}`);
      console.log(`${c.dim}${summary}${c.reset}`);
    } else {
      console.log(`\n  ${c.dim}(sem resumo — janela ainda dentro do trigger de sumarização)${c.reset}`);
    }

    console.log(`\n${c.bold}  MENSAGENS:${c.reset}`);
    if (messages.length === 0) {
      console.log(`  ${c.dim}(vazio)${c.reset}`);
    } else {
      messages.forEach((m, i) => {
        const role = typeof m.role === 'string' ? m.role : '?';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const ts = m.ts || m.timestamp || '';
        const extras: string[] = [];
        if (m.tokens !== undefined) extras.push(`tokens=${m.tokens}`);
        if (m.finish_reason !== undefined) extras.push(`finish=${m.finish_reason}`);
        const extraStr = extras.length ? ` ${c.red}[lixo legado: ${extras.join(', ')}]${c.reset}` : '';
        console.log(
          `  ${c.dim}${String(i + 1).padStart(3, '0')}.${c.reset} ${roleColor(role)}${role.padEnd(9)}${c.reset} ${c.gray}${ts}${c.reset}${extraStr}`
        );
        console.log(`        ${preview(content)}`);
      });
    }

    console.log('');
  } finally {
    await redis.quit();
  }
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
