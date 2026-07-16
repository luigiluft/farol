// FAROL - modulo esteira (ownership: modulo esteira). A Esteira e o monitor
// das automacoes agendadas (Scheduled Tasks Windows). GET /api/esteira devolve
// { jobs:[...], feed:[...] } cruzando TRES fontes:
//   (a) Windows Task Scheduler  - spawn de powershell.exe Get-ScheduledTask +
//       Get-ScheduledTaskInfo (State/LastRunTime/NextRunTime/LastTaskResult).
//       PS 5.1: ConvertTo-Json colapsa array de 1 item em objeto (normalizamos
//       p/ array); datas vem como /Date(ms)/ .NET OU ISO (tratamos ambos).
//   (b) Logs de run            - <DATA_DIR>/esteira-runs/<Task>.jsonl, 1 linha
//       por run {ts,ok,output}. hist=ultimas 14 (ok|fail|skip), uptime=% ok
//       sobre nao-skip, lastOutput=output da ultima linha. feed=todas as runs
//       de todos os jobs por ts desc, top ~20.
//   (c) Mapa estatico          - esteira-config.mjs (what/src/dst/cadence/
//       claude). SO as tasks deste mapa entram (Microsoft/Opera/etc somem).
//
// Degrade sem log: hist=1 entrada derivada do LastTaskResult (ok se 0, senao
// fail), lastOutput='exit <N>', uptime=100|null; feed derivado dos LastRunTime.
// Cache de 30s (sem spawn de PS a cada request). Tudo defensivo igual
// sessions.mjs: nenhum parse/rota derruba o processo; erro vira 500 JSON.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR } from './config.mjs';
import { ESTEIRA } from './esteira-config.mjs';

const RUNS_DIR = path.join(DATA_DIR, 'esteira-runs');
const CACHE_MS = 30 * 1000;
const HIST_LEN = 14; // ultimas N execucoes no heartbeat
const FEED_MAX = 20; // teto do feed global
const RUNS_OUT = 12; // runs expostas no detalhe da rotina (drawer), newest-first
const OUTPUT_LEN = 120; // clip do summary curto (defesa contra linha gigante)
const DETAIL_LEN = 4000; // clip do stdout/stderr expostos pro drawer (defesa)
const PS_TIMEOUT_MS = 12 * 1000; // teto do spawn de PowerShell
const PS_MAX_BUFFER = 4 * 1024 * 1024;
const UPTIME_OK = 100; // degrade: result 0 e sem log => 100% (heuristica)

// Script PS: so tasks da raiz '\\'; projeta os campos minimos; Depth 3 cobre
// os tipos aninhados. -NoProfile/-NonInteractive p/ nao herdar perfil nem
// travar pedindo input. Datas saem como ISO 'o' (ToString) p/ evitar a
// ambiguidade do /Date(ms)/ - ainda tratamos os dois no parse por seguranca.
const PS_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue";',
  "Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\\' } | ForEach-Object {",
  '  $i = $_ | Get-ScheduledTaskInfo;',
  '  [PSCustomObject]@{',
  '    Name = $_.TaskName;',
  '    State = [string]$_.State;',
  '    Last = if ($i.LastRunTime) { $i.LastRunTime.ToString("o") } else { $null };',
  '    Next = if ($i.NextRunTime) { $i.NextRunTime.ToString("o") } else { $null };',
  '    Result = $i.LastTaskResult;',
  '  }',
  '} | ConvertTo-Json -Depth 3',
].join(' ');

const cache = { ts: 0, data: null, pending: null };

// --------------------------------------------------- task scheduler (PS) ----

function runPowerShell() {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT];
    execFile(
      'powershell.exe',
      args,
      { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // timeout / powershell ausente / erro de exec: degrade silencioso.
          console.error('[esteira] powershell falhou:', err.message);
          resolve(null);
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : null);
      }
    );
  });
}

// PS 5.1 colapsa array de 1 item em objeto e array vazio em ''/null. Normaliza
// para sempre devolver array. JSON corrompido => [] (nunca lanca).
function parseScheduler(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    console.error('[esteira] JSON do scheduler invalido:', err.message);
    return [];
  }
  if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r === 'object');
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

// Indexa o scheduler por nome de task (so as do mapa estatico interessam).
function schedulerIndex(rows) {
  const idx = new Map();
  for (const row of rows) {
    const name = typeof row.Name === 'string' ? row.Name.trim() : '';
    if (!name) continue;
    idx.set(name, {
      state: typeof row.State === 'string' ? row.State.trim() : '',
      last: parseWinDate(row.Last),
      next: parseWinDate(row.Next),
      result: Number.isFinite(row.Result) ? row.Result : toNum(row.Result),
    });
  }
  return idx;
}

// Aceita ISO ('2026-06-16T10:27:00...') E /Date(1718...)/ .NET. Devolve epoch
// ms ou null. Nada lanca: entrada estranha => null.
function parseWinDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const dotNet = s.match(/\/Date\((-?\d+)/);
  if (dotNet) {
    const ms = Number(dotNet[1]);
    return Number.isFinite(ms) ? ms : null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --------------------------------------------------------- logs de run ----

// Le <RUNS_DIR>/<task>.jsonl e devolve as ultimas linhas parseadas (cronolog.,
// mais antiga primeiro). Arquivo ausente/ilegivel => []. Linha corrompida e
// pulada (parse defensivo linha a linha).
async function readRunLog(taskName) {
  const file = path.join(RUNS_DIR, `${taskName}.jsonl`);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return []; // sem log ainda: degrade no caller
  }
  const runs = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    const run = normalizeRun(obj);
    if (run) runs.push(run);
  }
  return runs;
}

function normalizeRun(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const ts = parseWinDate(obj.ts);
  if (ts === null) return null;
  return {
    ts,
    ok: obj.ok !== false, // qualquer coisa != false conta como ok
    output: clip(obj.output, OUTPUT_LEN),
    // campos ricos (detalhe do output); ausentes em entries antigas.
    stdout: clipRaw(obj.stdout, DETAIL_LEN),
    stderr: clipRaw(obj.stderr, DETAIL_LEN),
    exit: Number.isFinite(obj.exit) ? obj.exit : null,
    durationMs: Number.isFinite(obj.durationMs) ? obj.durationMs : null,
  };
}

// summary curto: colapsa whitespace.
function clip(s, n) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

// detalhe: preserva quebras de linha, corta mantendo o FIM.
function clipRaw(s, n) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\r\n/g, '\n').trimEnd();
  return t.length > n ? t.slice(t.length - n) : t;
}

// "0.4s" / "8.4s" / "1m 02s" — duracao humana a partir de ms.
function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

// Uma run "rodou ok mas sem nada a relatar": ok, sem stdout, e output vazio ou
// so o fallback "exit 0". A UI mostra isso como "rodou - sem saida" (calmo),
// em vez de repetir "exit 0" em todo lugar.
function isSilent(run) {
  if (!run.ok) return false;
  if (run.stdout && run.stdout.trim()) return false;
  const o = (run.output || '').trim();
  return o === '' || /^exit\s+0$/i.test(o);
}

// Projeta uma run pra UI (detalhe). Newest-first no array do job.
function runOut(run) {
  const silent = isSilent(run);
  return {
    t: fmtTime(run.ts),
    ok: run.ok,
    exit: run.exit,
    dur: fmtDur(run.durationMs),
    summary: silent ? '' : (run.output || ''),
    silent,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
  };
}

// hist = status das ultimas HIST_LEN runs (ok|fail), mais recente por ultimo.
// Logs nao guardam skip; skip so aparece no degrade derivado do scheduler.
function histFromRuns(runs) {
  return runs.slice(-HIST_LEN).map((r) => (r.ok ? 'ok' : 'fail'));
}

// uptime = % de ok sobre nao-skip. Sem runs nao-skip => null.
function uptimeFromHist(hist) {
  const counted = hist.filter((h) => h !== 'skip');
  if (!counted.length) return null;
  const ok = counted.filter((h) => h === 'ok').length;
  return Math.round((ok / counted.length) * 100);
}

// ---------------------------------------------------------- montar jobs ----

// enabled deriva do State do scheduler ('Disabled' => off). Sem scheduler
// (PS falhou) assume habilitada (a config existe, melhor mostrar viva).
function isEnabled(sched) {
  if (!sched || !sched.state) return true;
  return sched.state.toLowerCase() !== 'disabled';
}

// Texto humano da proxima execucao a partir do epoch + estado.
function nextLabel(nextMs, enabled, cadence) {
  if (!enabled) return '—'; // em-dash so em label de dado, nao em copy EN
  if (cadence === 'continuo') return 'sempre';
  if (nextMs === null) return '—';
  return fmtDateTime(nextMs);
}

function lastLabel(lastMs) {
  if (lastMs === null) return '—';
  return fmtDateTime(lastMs);
}

// Formato curto e estavel ('16/06 10:27'); a UI decide o realce.
function fmtDateTime(ms) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

// Constroi UM job cruzando config + scheduler + runs. Nunca muta a config.
function buildJob(name, sched, runs) {
  const cfg = ESTEIRA[name];
  const enabled = isEnabled(sched);
  const result = sched && sched.result !== null ? sched.result : 0;

  let hist;
  let uptime;
  let lastOutput;
  let runsOut;
  if (runs.length) {
    hist = histFromRuns(runs);
    uptime = uptimeFromHist(hist);
    lastOutput = runs[runs.length - 1].output || '';
    // newest-first, ultimas RUNS_OUT, projetadas com detalhe pro drawer.
    runsOut = runs.slice(-RUNS_OUT).reverse().map(runOut);
  } else {
    // Degrade: deriva uma unica entrada do LastTaskResult do scheduler.
    const ok = result === 0;
    hist = [ok ? 'ok' : 'fail'];
    uptime = ok ? UPTIME_OK : null;
    lastOutput = `exit ${result}`;
    runsOut = [runOut({
      ts: sched && sched.last !== null ? sched.last : Date.now(),
      ok,
      output: ok ? '' : `exit ${result}`,
      stdout: '',
      stderr: ok ? '' : `exit ${result}`,
      exit: result,
      durationMs: null,
    })];
  }

  const lastMs = runs.length ? runs[runs.length - 1].ts : sched ? sched.last : null;
  const nextMs = sched ? sched.next : null;

  return {
    name,
    what: cfg.what,
    src: cfg.src.slice(),
    dst: cfg.dst.slice(),
    cadence: cfg.cadence,
    claude: cfg.claude === true,
    enabled,
    result,
    last: lastLabel(lastMs),
    next: nextLabel(nextMs, enabled, cfg.cadence),
    lastMs, // v2 (Comando): cru pra ordenar/derivar sem parsear label
    nextMs,
    hist,
    uptime,
    lastOutput,
    runs: runsOut,
  };
}

// Feed global: todas as runs (com log) viram entradas; sem log, deriva 1 do
// LastRunTime do scheduler. Ordena por ts desc, top FEED_MAX.
function buildFeed(name, sched, runs) {
  const cfg = ESTEIRA[name];
  const claude = cfg.claude === true;
  if (runs.length) {
    return runs.map((r) => ({
      ts: r.ts,
      name,
      output: r.output || '',
      fail: !r.ok,
      claude,
    }));
  }
  // Degrade: uma entrada se o scheduler conhece a ultima execucao.
  if (sched && sched.last !== null) {
    const result = sched.result !== null ? sched.result : 0;
    return [
      {
        ts: sched.last,
        name,
        output: `exit ${result}`,
        fail: result !== 0,
        claude,
      },
    ];
  }
  return [];
}

function feedRowOut(row) {
  const fail = row.fail === true;
  const o = (row.output || '').trim();
  // sucesso sem nada a relatar (vazio ou "exit 0") -> calmo na UI.
  const silent = !fail && (o === '' || /^exit\s+0$/i.test(o));
  return {
    t: fmtTime(row.ts),
    name: row.name,
    output: row.output,
    fail,
    silent,
    claude: row.claude === true,
  };
}

function fmtTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

// ------------------------------------------------------------- coletor ----

async function collect() {
  const stdout = await runPowerShell();
  const idx = schedulerIndex(parseScheduler(stdout));

  const names = Object.keys(ESTEIRA);
  // Le todos os logs em paralelo (arquivos pequenos, IO independente).
  const runLists = await Promise.all(names.map((n) => readRunLog(n)));

  const jobs = [];
  let feedRaw = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const sched = idx.get(name) || null;
    const runs = runLists[i];
    jobs.push(buildJob(name, sched, runs));
    feedRaw = feedRaw.concat(buildFeed(name, sched, runs));
  }

  feedRaw.sort((a, b) => b.ts - a.ts);
  const feed = feedRaw.slice(0, FEED_MAX).map(feedRowOut);

  return { jobs, feed };
}

// Cache de 30s com de-dup de chamadas concorrentes (mesmo padrao do skills.mjs).
export async function getEsteira() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;
  if (!cache.pending) {
    cache.pending = collect()
      .then((data) => {
        cache.data = data;
        cache.ts = Date.now();
        return data;
      })
      .finally(() => {
        cache.pending = null;
      });
  }
  return cache.pending;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/esteira', async (req, res) => {
    try {
      res.json(await getEsteira());
    } catch (err) {
      console.error('[esteira]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
