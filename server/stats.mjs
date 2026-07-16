// FAROL - modulo stats (ownership: agente S).
// CPU amostrada em background (os.cpus, janela de 500ms), RAM e uptime via
// node:os, disco via PowerShell Get-PSDrive com cache de 30s (nunca bloqueia
// a rota), drift do ~/.claude/logs/system-drift.json (campo overall).

import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { CLAUDE } from './config.mjs';
import { countActiveSessions, getUsageSummary } from './sessions.mjs';

const DRIFT_FILE = path.join(CLAUDE, 'logs', 'system-drift.json');
const DRIFT_LEVELS = new Set(['ok', 'warn', 'crit']);
const CPU_SAMPLE_MS = 500;
const DISK_CACHE_MS = 30 * 1000;
const DISK_TIMEOUT_MS = 10 * 1000;
const DRIFT_CACHE_MS = 10 * 1000;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

// ------------------------------------------------------------------- cpu ----

let prevCpus = os.cpus();
let lastCpuPct = 0;

function sampleCpu() {
  const cur = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < cur.length; i++) {
    const a = cur[i].times;
    const b = prevCpus[i] ? prevCpus[i].times : a;
    idle += a.idle - b.idle;
    total += a.user - b.user + (a.nice - b.nice) + (a.sys - b.sys) + (a.irq - b.irq) + (a.idle - b.idle);
  }
  if (total > 0) lastCpuPct = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
  prevCpus = cur;
}

const cpuTimer = setInterval(sampleCpu, CPU_SAMPLE_MS);
cpuTimer.unref();

// ----------------------------------------------------------------- disco ----

const disk = { value: null, ts: 0, pending: false };

function refreshDisk() {
  if (disk.pending) return;
  disk.pending = true;
  try {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-PSDrive C).Free'],
      { timeout: DISK_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        disk.pending = false;
        disk.ts = Date.now();
        if (err) {
          console.error('[stats] disco indisponivel:', err.message);
          disk.value = null;
          return;
        }
        const bytes = parseInt(String(stdout).trim(), 10);
        disk.value = Number.isFinite(bytes) ? Math.round((bytes / GB) * 10) / 10 : null;
      }
    );
  } catch (err) {
    disk.pending = false;
    disk.ts = Date.now();
    disk.value = null;
    console.error('[stats] disco indisponivel:', err.message);
  }
}

function diskFreeGb() {
  // Nunca bloquear: dispara refresh em background e devolve o cache atual.
  if (Date.now() - disk.ts > DISK_CACHE_MS) refreshDisk();
  return disk.value;
}

// ----------------------------------------------------------------- drift ----

const drift = { value: 'unknown', ts: 0 };

async function readDrift() {
  if (Date.now() - drift.ts < DRIFT_CACHE_MS) return drift.value;
  drift.ts = Date.now();
  try {
    const raw = await fsp.readFile(DRIFT_FILE, 'utf8');
    const overall = JSON.parse(raw).overall;
    drift.value = DRIFT_LEVELS.has(overall) ? overall : 'unknown';
  } catch {
    drift.value = 'unknown';
  }
  return drift.value;
}

// ------------------------------------------------------------------ stats ----

export async function getStats() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  let sessionsActive = 0;
  try {
    sessionsActive = await countActiveSessions();
  } catch {
    sessionsActive = 0;
  }
  let usage = null;
  try {
    usage = getUsageSummary();
  } catch {
    usage = null;
  }
  return {
    cpuPct: lastCpuPct,
    memUsedMb: Math.round((memTotal - memFree) / MB),
    memTotalMb: Math.round(memTotal / MB),
    diskFreeGb: diskFreeGb(),
    uptimeMin: Math.round(os.uptime() / 60),
    sessionsActive,
    drift: await readDrift(),
    usage,
  };
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  refreshDisk(); // aquece o cache para a primeira leitura nao vir null por muito tempo
  app.get('/api/stats', async (req, res) => {
    try {
      res.json(await getStats());
    } catch (err) {
      console.error('[stats]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
