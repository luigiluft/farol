// FAROL - servidor express (ownership: agente S).
// Monta as rotas dos modulos vault/sessions/stats, expoe o SSE /api/events
// (stats a cada 2s + sessions on-change via chokidar) e serve web/dist em prod.
// Toda falha de rota vira {error} 500; o processo nunca cai por causa de rota.

// F9: carrega torre/.env (se existir) antes de tudo, para o /api/briefing achar
// ANTHROPIC_API_KEY. Ausente = briefing degrada gracioso (nao quebra o boot).
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.mjs';
import * as vault from './vault.mjs';
import * as sessions from './sessions.mjs';
import * as stats from './stats.mjs';
import * as projects from './projects.mjs';
import * as terminal from './terminal.mjs';
import * as mcp from './mcp.mjs';
import * as skills from './skills.mjs';
import * as agenda from './agenda.mjs';
import * as mirror from './mirror.mjs';
import * as visor from './visor.mjs';
import * as peek from './peek.mjs';
import * as diff from './diff.mjs';
import * as artifacts from './artifacts.mjs';
import * as assets from './assets.mjs';
import * as usage from './usage.mjs';
import * as noteSessions from './note-sessions.mjs';
import * as pendencias from './pendencias.mjs';
import * as liveBrowser from './live-browser.mjs';
import * as briefing from './briefing.mjs';
import * as diary from './diary.mjs';
import * as esteira from './esteira.mjs';
import * as fluxo from './fluxo.mjs';
import * as bases from './bases.mjs';
import * as notifyNative from './notify-native.mjs';
import * as health from './health.mjs';
import * as resumable from './resumable.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SSE_STATS_MS = 2000;
const SSE_RETRY_MS = 5000;

const sseClients = new Set();

// -------------------------------------------------------------- modulos ----

function registerModules(app) {
  const modules = [
    ['vault', vault],
    ['sessions', sessions],
    ['stats', stats],
    ['projects', projects],
    ['terminal', terminal],
    ['mcp', mcp],
    ['skills', skills],
    ['agenda', agenda],
    ['mirror', mirror],
    ['visor', visor],
    ['peek', peek],
    ['diff', diff],
    ['artifacts', artifacts],
    ['assets', assets],
    ['usage', usage],
    ['note-sessions', noteSessions],
    ['pendencias', pendencias],
    ['live-browser', liveBrowser],
    ['briefing', briefing],
    ['diary', diary],
    ['esteira', esteira],
    ['fluxo', fluxo],
    ['bases', bases],
    ['native-toast', notifyNative],
    ['health', health],
    ['resumable', resumable],
  ];
  for (const [name, mod] of modules) {
    try {
      mod.register(app);
      console.log(`[torre] modulo ${name} montado`);
    } catch (err) {
      console.error(`[torre] modulo ${name} falhou ao montar: ${err.message}`);
    }
  }
}

// ------------------------------------------------------------------- SSE ----

function sseWrite(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    sseClients.delete(res);
  }
}

function sseBroadcast(payload) {
  if (sseClients.size === 0) return;
  for (const res of sseClients) sseWrite(res, payload);
}

async function sseSendSnapshot(res) {
  try {
    sseWrite(res, { type: 'stats', ...(await stats.getStats()) });
    sseWrite(res, { type: 'sessions', sessions: await sessions.getSessions() });
  } catch (err) {
    console.error('[torre] snapshot SSE falhou:', err.message);
  }
}

function mountSse(app) {
  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);
    sseClients.add(res);
    sseSendSnapshot(res);
    req.on('close', () => sseClients.delete(res));
  });
}

function startStatsLoop() {
  const timer = setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
      sseBroadcast({ type: 'stats', ...(await stats.getStats()) });
    } catch (err) {
      console.error('[torre] loop de stats falhou:', err.message);
    }
  }, SSE_STATS_MS);
  timer.unref();
}

function startSessionsWatch() {
  try {
    sessions.watchSessions(async () => {
      try {
        const list = await sessions.getSessions();
        sseBroadcast({ type: 'sessions', sessions: list });
        try {
          notifyNative.checkTransitions(list);
        } catch (err) {
          console.error('[torre] native toast falhou:', err.message);
        }
      } catch (err) {
        console.error('[torre] push de sessions falhou:', err.message);
      }
    });
  } catch (err) {
    console.error('[torre] watcher de sessions falhou:', err.message);
  }
}

// Vault mudou (reindex concluido) => ping SSE 'vault': o Graph refetcha ao
// vivo (nota nova aparece sem reload e o cometa do graph-fx nasce na hora).
function startVaultWatch() {
  try {
    vault.onVaultChange(() => sseBroadcast({ type: 'vault' }));
  } catch (err) {
    console.error('[torre] watch de vault p/ SSE falhou:', err.message);
  }
}

// ---------------------------------------------------------------- static ----

function mountStatic(app) {
  // Em prod (npm run build) serve web/dist; em dev o Vite cuida do front.
  // Cache: index.html NUNCA cacheia (aba aberta atravessando deploys ficava
  // com chunks orfaos = layout quebrado/navegacao travada, visto 2026-07-02);
  // assets com hash no nome sao imutaveis e podem cachear pra sempre.
  const dist = path.join(__dirname, '..', 'web', 'dist');
  if (!fs.existsSync(dist)) return;
  app.use(express.static(dist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.set('Cache-Control', 'no-store');
      } else if (/assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\./.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// ------------------------------------------------------------------ boot ----

function main() {
  const app = express();
  app.disable('x-powered-by');

  registerModules(app);
  mountSse(app);

  // Qualquer /api nao registrada acima responde 404 JSON.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'rota nao encontrada' });
  });

  mountStatic(app);

  // Ultima linha de defesa: erro sincrono em middleware vira 500 JSON.
  app.use((err, req, res, next) => {
    console.error('[torre] erro nao tratado:', err.message);
    if (res.headersSent) return next(err);
    res.status(err.status || err.statusCode || 500).json({ error: 'erro interno' });
  });

  startStatsLoop();
  startSessionsWatch();
  startVaultWatch();

  // Expor o http server ao terminal opcional (WebSocket no mesmo listener).
  const server = app.listen(PORT, () => {
    console.log(`[torre] FAROL no ar em http://localhost:${PORT}`);
    health.printBootSummary();
  });
  try {
    terminal.attach(server);
  } catch (err) {
    console.error('[torre] terminal attach falhou:', err.message);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('[torre] unhandledRejection:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[torre] uncaughtException:', err && err.message ? err.message : err);
});

main();
