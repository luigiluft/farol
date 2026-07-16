// A TORRE - autostart de logon (scheduled task \TorreServer).
// Sobe o server da Torre (porta 7777) se nao estiver de pe e abre o
// browser default em http://localhost:7777. Idempotente: server ja
// vivo => so abre o browser. Termina rapido (max ~60s); o server fica
// vivo porque o spawn e detached+unref (a task nao fica "running").
// Kill-switch: schtasks /change /tn TorreServer /disable
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7777;
const URL_HOME = `http://localhost:${PORT}`;
const NODE_EXE = process.execPath; // o proprio node que rodou este script
const LOG_FILE = path.join(ROOT, '.data', 'autostart.log');
const LOG_MAX_BYTES = 100 * 1024;
const TCP_TIMEOUT_MS = 2000;
const BOOT_POLL_MS = 1000;
const BOOT_MAX_MS = 120 * 1000; // boot frio reindexa o vault (~41s medido 07-05; 45s dava falso-FALHA sob carga)

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > LOG_MAX_BYTES) fs.truncateSync(LOG_FILE, 0);
    } catch {
      // arquivo ainda nao existe: segue
    }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // log e best-effort: nunca derruba o autostart
  }
}

// Checagem TCP (nao HTTP): pega tambem um server que acabou de dar
// listen mas ainda esta indexando o vault — evita subir instancia
// dupla (catch do cross-review 2026-06-12).
function portListening() {
  return new Promise((resolve) => {
    const sock = net.connect({ port: PORT, host: '127.0.0.1' });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.once('timeout', () => done(false));
  });
}

function statsResponding() {
  return new Promise((resolve) => {
    const req = http.get(`${URL_HOME}/api/stats`, { timeout: TCP_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// stdio: tenta append nos logs do server; se um processo antigo segura
// lock exclusivo (ex: Start-Process -RedirectStandardOutput), cai pra
// 'ignore' em vez de quebrar (catch do cross-review 2026-06-12).
function serverStdio() {
  try {
    const out = fs.openSync(path.join(ROOT, 'server.out.log'), 'a');
    const err = fs.openSync(path.join(ROOT, 'server.err.log'), 'a');
    return ['ignore', out, err];
  } catch {
    return 'ignore';
  }
}

function spawnServer() {
  const child = spawn(NODE_EXE, ['server/index.mjs'], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: serverStdio(),
  });
  child.unref();
  return child.pid;
}

function openBrowser() {
  // 'start' resolve o browser default na sessao interativa do usuario
  spawn('cmd', ['/c', 'start', '', URL_HOME], { windowsHide: true }).unref();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntilUp(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await statsResponding()) return Date.now() - t0;
    await sleep(BOOT_POLL_MS);
  }
  return -1;
}

async function main() {
  if (await portListening()) {
    // vivo (ou subindo): espera a API só pra abrir o browser num app pronto
    await waitUntilUp(15 * 1000);
    openBrowser();
    log('ja-vivo: browser aberto');
    return;
  }
  const pid = spawnServer();
  const ms = await waitUntilUp(BOOT_MAX_MS);
  if (ms < 0) {
    log(`FALHA: server (pid ${pid}) nao respondeu em ${BOOT_MAX_MS / 1000}s`);
    process.exit(1); // RestartOnFailure da task re-tenta 3x
  }
  openBrowser();
  log(`subiu: pid ${pid} pronto em ${(ms / 1000).toFixed(1)}s; browser aberto`);
}

main().catch((err) => {
  log(`ERRO inesperado: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
