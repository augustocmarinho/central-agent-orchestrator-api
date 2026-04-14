/**
 * Monitor de Follow-Up em tempo real
 * Exibe estado das filas, jobs pendentes e eventos conforme acontecem.
 *
 * Uso: npx tsx scripts/monitor-followup.ts
 */

import Queue from 'bull';
import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redisConfig = { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };

const redis = new Redis(redisConfig);
const queue = new Queue('ai-messages-followup', { redis: redisConfig, prefix: 'bull' });

// ─── Cores ANSI ─────────────────────────────────────────────────────
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
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
};

function ts(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + '...' : id;
}

function formatDelay(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}min ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}min`;
}

// ─── Snapshot da fila ───────────────────────────────────────────────

async function printSnapshot() {
  const [waiting, active, delayed, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  console.log(`\n${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  FOLLOW-UP MONITOR  ${c.dim}(${ts()})${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`  ${c.yellow}Delayed: ${delayed}${c.reset}  |  ${c.cyan}Waiting: ${waiting}${c.reset}  |  ${c.blue}Active: ${active}${c.reset}  |  ${c.green}Done: ${completed}${c.reset}  |  ${c.red}Failed: ${failed}${c.reset}`);

  // Listar jobs delayed (pendentes de envio)
  const delayedJobs = await queue.getDelayed();
  if (delayedJobs.length > 0) {
    console.log(`\n${c.bold}  JOBS PENDENTES:${c.reset}`);
    for (const job of delayedJobs) {
      const d = job.data;
      const now = Date.now();
      const fireAt = job.timestamp + (job.opts.delay || 0);
      const remaining = fireAt - now;
      const status = remaining > 0
        ? `${c.yellow}dispara em ${formatDelay(remaining)}${c.reset}`
        : `${c.red}ATRASADO ${formatDelay(Math.abs(remaining))}${c.reset}`;

      console.log(`  ${c.dim}├─${c.reset} ${c.cyan}Passo ${d.stepOrder}${c.reset} | ${d.messageType === 'ai_generated' ? `${c.magenta}IA${c.reset}` : `${c.blue}Custom${c.reset}`} | ${status}`);
      console.log(`  ${c.dim}│  ${c.reset}Conv: ${c.gray}${shortId(d.conversationId)}${c.reset} | Agent: ${c.gray}${shortId(d.agentId)}${c.reset} | Canal: ${d.channel}`);
      if (d.messageType === 'custom' && d.customMessage) {
        const preview = d.customMessage.length > 50 ? d.customMessage.slice(0, 50) + '...' : d.customMessage;
        console.log(`  ${c.dim}│  ${c.reset}Msg: "${c.green}${preview}${c.reset}"`);
      }
    }
  }

  // Listar estados Redis ativos
  const keys = await redis.keys('followup:*');
  if (keys.length > 0) {
    console.log(`\n${c.bold}  SEQUÊNCIAS ATIVAS (Redis):${c.reset}`);
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const state = JSON.parse(raw);
      const convId = key.replace('followup:', '');
      const ttl = await redis.ttl(key);
      console.log(`  ${c.dim}├─${c.reset} Conv: ${c.gray}${shortId(convId)}${c.reset} | Step ${state.currentStep}/${state.totalSteps} | Canal: ${state.channel} | TTL: ${formatDelay(ttl * 1000)}`);
    }
  }

  if (delayedJobs.length === 0 && keys.length === 0) {
    console.log(`\n  ${c.dim}Nenhum follow-up pendente no momento.${c.reset}`);
  }

  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}\n`);
}

// ─── Eventos em tempo real ──────────────────────────────────────────

function setupEvents() {
  queue.on('waiting', (jobId) => {
    console.log(`${c.gray}[${ts()}]${c.reset} ${c.bgCyan}${c.bold} WAITING ${c.reset} Job ${jobId} entrou na fila`);
  });

  queue.on('active', (job) => {
    const d = job.data;
    console.log(`${c.gray}[${ts()}]${c.reset} ${c.bgYellow}${c.bold} ACTIVE  ${c.reset} Passo ${d.stepOrder} | Conv: ${shortId(d.conversationId)} | Tipo: ${d.messageType}`);
  });

  queue.on('completed', (job, result) => {
    const d = job.data;
    const r = typeof result === 'string' ? JSON.parse(result) : result;
    console.log(`${c.gray}[${ts()}]${c.reset} ${c.bgGreen}${c.bold} DONE    ${c.reset} Passo ${d.stepOrder} | Conv: ${shortId(d.conversationId)} | ${r?.success ? `${c.green}Enviado` : `${c.yellow}Skipped`}${c.reset}`);
  });

  queue.on('failed', (job, err) => {
    const d = job.data;
    console.log(`${c.gray}[${ts()}]${c.reset} ${c.bgRed}${c.bold} FAILED  ${c.reset} Passo ${d.stepOrder} | Conv: ${shortId(d.conversationId)} | Erro: ${err.message}`);
  });

  queue.on('removed', (job) => {
    console.log(`${c.gray}[${ts()}]${c.reset} ${c.magenta}REMOVED${c.reset}  Job ${typeof job === 'object' ? (job as any).id : job} removido (cancelado)`);
  });
}

// ─── Monitorar cancelamentos via Redis keyspace ─────────────────────

async function setupRedisMonitor() {
  // Subscriber separado para keyspace notifications
  const sub = new Redis(redisConfig);
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Kgx');
  } catch {
    // Pode falhar se Redis não suportar — ok
  }
  sub.psubscribe('__keyevent@0__:del');
  sub.on('pmessage', (_pattern, _channel, key) => {
    if (key.startsWith('followup:')) {
      const convId = key.replace('followup:', '');
      console.log(`${c.gray}[${ts()}]${c.reset} ${c.red}CANCEL${c.reset}   Sequência cancelada | Conv: ${shortId(convId)}`);
    }
  });
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(`${c.bold}${c.cyan}`);
  console.log(`  ╔══════════════════════════════════════╗`);
  console.log(`  ║   Follow-Up Monitor - Tempo Real     ║`);
  console.log(`  ╚══════════════════════════════════════╝${c.reset}`);
  console.log(`  ${c.dim}Pressione Ctrl+C para sair${c.reset}\n`);

  setupEvents();
  await setupRedisMonitor();
  await printSnapshot();

  // Refresh a cada 15 segundos
  setInterval(printSnapshot, 15000);
}

main().catch((err) => {
  console.error('Erro no monitor:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(`\n${c.dim}Encerrando monitor...${c.reset}`);
  await queue.close();
  await redis.quit();
  process.exit(0);
});
