// A TORRE - helper de instrumentacao da ESTEIRA (fase 2).
//
// Anexa UMA run de automacao ao log que a Esteira le:
//   <DATA_DIR>/esteira-runs/<TaskName>.jsonl   (1 linha por run: {ts,ok,output})
// Mantem so as ultimas ~20 linhas (rolling) para o arquivo nao crescer sem fim.
//
// USO (fase 2 - as 11 automacoes chamam isto no fim do seu run):
//   CLI:    node scripts/esteira-log.mjs <TaskName> <ok|fail> "<output>"
//           ex: node scripts/esteira-log.mjs PushWatcher ok "sem commits novos"
//   import: import { logRun } from './scripts/esteira-log.mjs';
//           await logRun('PushWatcher', true, 'sem commits novos');
//
// NOTA: os scripts das automacoes NAO sao tocados aqui (fase 2, manual). Este
// arquivo so oferece o helper + a CLI. Defensivo: erro de IO nunca lanca pra
// fora de logRun (a automacao nao pode quebrar so porque o log falhou).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR = torre/.data (mesmo de server/config.mjs); scripts/ e irmao de server/.
const DATA_DIR = path.resolve(__dirname, '..', '.data');
const RUNS_DIR = path.join(DATA_DIR, 'esteira-runs');
const MAX_LINES = 20;
const OUTPUT_LEN = 240; // clip generoso do summary curto; a Esteira reclipa pra UI
const DETAIL_LEN = 6000; // clip do stdout/stderr completos (mantem o FIM)
const TASK_NAME_RE = /^[\w.-]+$/; // guard de path traversal no nome da task

// summary curto: colapsa whitespace (1 linha pra coluna de output).
function clip(s, n) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

// detalhe: PRESERVA quebras de linha (e um log multi-linha), so corta tamanho
// mantendo o FIM (consistente com o tail do wrapper).
function clipRaw(s, n) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\r\n/g, '\n').trimEnd();
  return t.length > n ? t.slice(t.length - n) : t;
}

// Anexa uma run e re-escreve o arquivo com as ultimas MAX_LINES (rolling).
// `extra` (opcional, retrocompat): { stdout, stderr, exit, durationMs }.
// Retorna true em sucesso, false em qualquer erro (sem lancar).
export async function logRun(taskName, ok, output, extra = {}) {
  const name = typeof taskName === 'string' ? taskName.trim() : '';
  if (!name || !TASK_NAME_RE.test(name)) {
    console.error('[esteira-log] nome de task invalido:', taskName);
    return false;
  }
  const entry = {
    ts: new Date().toISOString(),
    ok: ok !== false && ok !== 'fail' && ok !== 0,
    output: clip(output, OUTPUT_LEN),
  };
  // Campos ricos (detalhe do output). So gravados quando presentes -> entries
  // antigas {ts,ok,output} continuam validas e o server degrada sozinho.
  if (extra && typeof extra === 'object') {
    const so = clipRaw(extra.stdout, DETAIL_LEN);
    const se = clipRaw(extra.stderr, DETAIL_LEN);
    if (so) entry.stdout = so;
    if (se) entry.stderr = se;
    if (Number.isFinite(extra.exit)) entry.exit = extra.exit;
    if (Number.isFinite(extra.durationMs)) entry.durationMs = extra.durationMs;
  }
  try {
    await fsp.mkdir(RUNS_DIR, { recursive: true });
    const file = path.join(RUNS_DIR, `${name}.jsonl`);
    const prev = await readLines(file);
    const next = prev.concat(JSON.stringify(entry)).slice(-MAX_LINES);
    await fsp.writeFile(file, next.join('\n') + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('[esteira-log] falha ao gravar run:', err.message);
    return false;
  }
}

async function readLines(file) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return []; // arquivo ainda nao existe: primeira run
  }
}

// ----------------------------------------------------------------- CLI ----
// Roda so quando invocado direto (node esteira-log.mjs ...), nao no import.

function isMainModule() {
  const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
  return invoked === import.meta.url;
}

async function cli() {
  const [taskName, status, ...rest] = process.argv.slice(2);
  if (!taskName || !status) {
    console.error('uso: node scripts/esteira-log.mjs <TaskName> <ok|fail> "<output>"');
    process.exitCode = 1;
    return;
  }
  const ok = status.toLowerCase() === 'ok';
  const good = await logRun(taskName, ok, rest.join(' '));
  if (!good) process.exitCode = 1;
}

if (isMainModule()) {
  cli();
}
