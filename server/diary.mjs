// FAROL - modulo Diario (Frente 1). Responde "o que eu fiz?": as 5 sessoes
// INTERATIVAS mais recentes (qualquer projeto, sem headless/one-shot), cada
// uma com fatos mecanicos + um resumo em prosa (voz C) sintetizado sob demanda.
//
// Difere da sessions.mjs (janela de 4h, "quem esta vivo agora"): o eixo aqui e
// HISTORICO. Varre TODOS os projetos, ordena por recencia, classifica e le o
// transcript inteiro (bounded) das candidatas top-5. Parse defensivo via
// transcript-parse.mjs. Cache do ENTRY inteiro em torre/.data/diary.json por
// id+mtimeMs: sessao encerrada e imutavel => computa uma vez (mecanico+prosa).
// Sessao viva nao e cacheada e nao recebe prosa congelada (isLive:true). A
// rota nunca 500: erro => []. Sem chave LLM => resumo:null (fallback mecanico).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE, VAULT, DATA_DIR, PROJECT_PREFIX_RE } from './config.mjs';
import { parseLines, rawUserText, isRealUserPrompt, clip } from './transcript-parse.mjs';
import { summarizeSession, proseEnabled } from './diary-prose.mjs';
import { inferTopic } from './topics.mjs';

const PROJECTS = path.join(CLAUDE, 'projects');
const TOP_N = 5;
const MAX_CANDIDATES = 40;              // teto de arquivos classificados por request
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const HEAD_BYTES = 256 * 1024;          // fatia para classificar (1o prompt fica no topo)
const ACTIVE_MS = 180 * 1000;           // < 3min = viva (mesmo corte da sessions.mjs)
const TASK_LINE_MAX = 12;               // one-shot curto
const NARRATIVE_LEN = 400;
const PROMPT_LEN = 400;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CMD_TOOLS = new Set(['Bash', 'PowerShell']);
const GIT_COMMIT_RE = /\bgit\s+commit\b/;
const CACHE_FILE = path.join(DATA_DIR, 'diary.json');
const CACHE_SAVE_MS = 30 * 1000;

// --------------------------------------------------------------- cache ----
const cache = new Map(); // id -> { mtimeMs, entry }
let cacheSaveTimer = null;
let cacheLoaded = false;

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [id, val] of Object.entries(raw)) {
        if (val && typeof val === 'object' && Number.isFinite(val.mtimeMs) && val.entry) {
          cache.set(id, { mtimeMs: val.mtimeMs, entry: val.entry });
        }
      }
    }
  } catch {
    // primeiro boot ou arquivo ausente/corrompido: cache vazio serve
  }
}

function scheduleCacheSave() {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    saveCache().catch((err) => console.error('[diary] diary.json:', err.message));
  }, CACHE_SAVE_MS);
  cacheSaveTimer.unref();
}

async function saveCache() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const plain = {};
  for (const [id, val] of cache) plain[id] = val;
  await fsp.writeFile(CACHE_FILE, JSON.stringify(plain), 'utf8');
}

// ------------------------------------------------------ coleta de arquivos ----
function projectLabel(dirName) {
  return dirName.replace(PROJECT_PREFIX_RE, '') || 'home';
}

async function collectFiles() {
  let projDirs = [];
  try {
    projDirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const d of projDirs) {
    if (!d.isDirectory()) continue;
    const dirAbs = path.join(PROJECTS, d.name);
    let entries = [];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const file = path.join(dirAbs, e.name);
      try {
        const st = await fsp.stat(file);
        files.push({
          file,
          id: path.basename(e.name, '.jsonl'),
          project: projectLabel(d.name),
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs || st.mtimeMs,
          size: st.size,
        });
      } catch {
        // sumiu entre readdir e stat: ignora
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

// ------------------------------------------------------------ leitura ----
async function readRange(file, start, end) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const len = Math.max(0, end - start);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Transcript inteiro quando cabe no teto; gigantes (so a sessao viva chega
// perto) leem head+tail e marcam approx. Devolve {objs, approx}.
async function readTranscript(file, size) {
  if (size <= MAX_SCAN_BYTES) {
    try {
      return { objs: parseLines(await fsp.readFile(file, 'utf8')), approx: false };
    } catch {
      return { objs: [], approx: false };
    }
  }
  const half = Math.floor(MAX_SCAN_BYTES / 2);
  const head = await readRange(file, 0, half);
  const tail = await readRange(file, size - half, size);
  return { objs: parseLines(head + '\n' + tail), approx: true };
}

// ------------------------------------------------------- classificacao ----
// Le so o head para decidir interativa vs tarefa (1o prompt fica no topo;
// arquivo grande = nao e one-shot). Reusa o corte da sessions.mjs.
async function classify(meta, now) {
  const isLive = now - meta.mtimeMs < ACTIVE_MS;
  const objs = parseLines(await readRange(meta.file, 0, Math.min(meta.size, HEAD_BYTES)));
  let firstUserSlash = null;
  let lineCount = 0;
  for (const o of objs) {
    lineCount += 1;
    if (firstUserSlash === null && o && o.type === 'user' && o.isMeta !== true && !o.toolUseResult) {
      const raw = rawUserText(o.message);
      if (typeof raw === 'string' && raw.length > 0) firstUserSlash = raw.startsWith('/');
    }
  }
  const small = meta.size <= HEAD_BYTES;
  let kind = 'interativa';
  if (firstUserSlash === true) kind = 'tarefa';
  else if (small && lineCount < TASK_LINE_MAX && !isLive) kind = 'tarefa';
  return { kind, isLive };
}

// ------------------------------------------------------------ extracao ----
async function resolveDailyPath(birthtimeMs) {
  const d = new Date(birthtimeMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rel = `6-Daily/${yyyy}-${mm}-${dd}.md`;
  try {
    await fsp.access(path.join(VAULT, rel));
    return rel;
  } catch {
    return null;
  }
}

function extractFacts(objs) {
  let model = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let commits = 0;
  let msgCount = 0;
  let narrative = null;
  const seenFiles = new Set();
  const fileNames = [];
  const prompts = [];
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'assistant' && o.message) {
      msgCount += 1;
      if (o.message.model) model = o.message.model;
      const u = o.message.usage;
      if (u && typeof u === 'object') {
        if (Number.isFinite(u.input_tokens)) tokensIn += u.input_tokens;
        if (Number.isFinite(u.output_tokens)) tokensOut += u.output_tokens;
      }
      const content = Array.isArray(o.message.content) ? o.message.content : [];
      let lastText = null;
      for (const blk of content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_use' && blk.name) {
          const inp = blk.input && typeof blk.input === 'object' ? blk.input : {};
          if (FILE_TOOLS.has(blk.name)) {
            const fp = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
            if (typeof fp === 'string' && fp.trim() && !seenFiles.has(fp)) {
              seenFiles.add(fp);
              fileNames.push(path.basename(fp.trim()));
            }
          } else if (CMD_TOOLS.has(blk.name)) {
            const cmd = typeof inp.command === 'string' ? inp.command : '';
            if (GIT_COMMIT_RE.test(cmd)) commits += 1;
          }
        } else if (blk.type === 'text' && typeof blk.text === 'string' && blk.text.trim()) {
          lastText = blk.text;
        }
      }
      if (lastText) narrative = clip(lastText, NARRATIVE_LEN);
    } else if (o.type === 'user' && isRealUserPrompt(o)) {
      msgCount += 1;
      const clean = clip(rawUserText(o.message), PROMPT_LEN);
      if (clean) prompts.push(clean);
    }
  }
  return {
    model,
    tokensIn,
    tokensOut,
    commits,
    fileCount: seenFiles.size,
    files: fileNames.slice(0, 30),
    narrative,
    msgCount,
    pedido: prompts.length ? prompts[0] : null,
    mission: prompts.length ? prompts[prompts.length - 1] : null,
  };
}

// --------------------------------------------------------- build entry ----
async function buildEntry(c, now) {
  const { meta } = c;
  if (c.cachedEntry) {
    const e = { ...c.cachedEntry, isLive: false };
    // backfill: entries cacheadas antes do refactor v2 nao tem topic
    if (!e.topic) e.topic = inferTopic([e.pedido, e.mission, e.narrative].filter(Boolean).join(' '));
    return e;
  }
  const { objs, approx } = await readTranscript(meta.file, meta.size);
  if (objs.length === 0) throw new Error('transcript vazio/ilegivel');
  const facts = extractFacts(objs);
  const dailyPath = await resolveDailyPath(meta.birthtimeMs);
  const base = {
    id: meta.id,
    project: meta.project,
    startedTs: new Date(meta.birthtimeMs).toISOString(),
    endedTs: new Date(meta.mtimeMs).toISOString(),
    durationMs: Math.max(0, meta.mtimeMs - meta.birthtimeMs),
    model: facts.model,
    tokensIn: facts.tokensIn,
    tokensOut: facts.tokensOut,
    files: facts.files,
    fileCount: facts.fileCount,
    commits: facts.commits,
    pedido: facts.pedido,
    // topic: mesma classificacao do Uso/sessions (topics.mjs) — e o join
    // canonico de "ultima sessao do projeto" no Projetos v2 (refactor v2 F3)
    topic: inferTopic([facts.pedido, facts.mission, facts.narrative].filter(Boolean).join(' ')),
    mission: facts.mission,
    narrative: facts.narrative,
    msgCount: facts.msgCount,
    dailyPath,
    approx,
    isLive: Boolean(c.isLive),
    resumo: null,
    pendencia: null,
    proseModel: null,
  };
  if (c.isLive) return base; // viva: sem prosa congelada, sem cache
  let prose = { resumo: null, pendencia: null, model: null };
  if (proseEnabled()) {
    try {
      prose = await summarizeSession(facts);
    } catch (err) {
      console.error('[diary] prose', meta.id, err.message);
    }
  }
  const entry = {
    ...base,
    resumo: prose.resumo || null,
    pendencia: prose.pendencia || null,
    proseModel: prose.model || null,
  };
  cache.set(meta.id, { mtimeMs: meta.mtimeMs, entry });
  scheduleCacheSave();
  return entry;
}

async function getDiary() {
  await loadCache();
  const now = Date.now();
  const files = await collectFiles();
  const chosen = [];
  let examined = 0;
  for (const meta of files) {
    if (chosen.length >= TOP_N || examined >= MAX_CANDIDATES) break;
    const cached = cache.get(meta.id);
    if (cached && cached.mtimeMs === meta.mtimeMs) {
      // entry cacheado = ja era interativa encerrada (vivas nunca sao cacheadas)
      chosen.push({ meta, cachedEntry: cached.entry });
      continue;
    }
    examined += 1;
    const { kind, isLive } = await classify(meta, now);
    if (kind !== 'interativa') continue;
    chosen.push({ meta, isLive });
  }
  const built = await Promise.all(chosen.map((c) => buildEntry(c, now).catch((err) => {
    console.error('[diary] pulou', c.meta.id, err.message);
    return null;
  })));
  return built.filter(Boolean);
}

export function register(app) {
  app.get('/api/diary', async (req, res) => {
    try {
      res.json(await getDiary());
    } catch (err) {
      console.error('[diary]', err && err.message ? err.message : err);
      res.json([]); // nunca 500: a UI mostra vazio
    }
  });
}
