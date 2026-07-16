// FAROL - note-sessions: indice reverso nota->sessoes. Varre os transcripts
// top-level de ~/.claude/projects (mesmo escopo do usage.mjs — subagentes em
// subdirs ficam FORA) e extrai, de cada linha com tool_use tocando file_path/
// notebook_path, quais notas do vault foram tocadas naquela sessao.
// Extracao e tool_use-only (JSON.parse por linha + filtro message.content[].
// type==='tool_use'), nao regex sobre o texto cru: evita falso positivo de
// linhas estruturadas sem message.content (ex.: attachment hook payloads).
// Incremental por (mtimeMs,size) com cache em .data/note-sessions.json;
// backfill anda em fatias de MAX_INGEST por request (ready:false ate terminar
// — a UI re-polla), espelhando o padrao do usage.mjs.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE, DATA_DIR, VAULT, PROJECT_PREFIX_RE } from './config.mjs';
import { parseLines } from './transcript-parse.mjs';

const PROJECTS_DIR = path.join(CLAUDE, 'projects');
const CACHE_FILE = path.join(DATA_DIR, 'note-sessions.json');
const MAX_INGEST = 10; // arquivos novos processados por request
const SAVE_MS = 10000;
const TOP_SESSIONS = 20;
// Raiz do vault: config.mjs e a fonte canonica (comentario do proprio arquivo:
// "Consts canonicas do SPEC. Modulos importam daqui; nunca re-declarar paths").
const VAULT_ROOT = path.resolve(VAULT);
const VAULT_LC = VAULT_ROOT.toLowerCase().replaceAll('\\', '/');

// Extrai notas do vault tocadas num transcript: parseia cada linha JSONL e
// olha SO para blocos tool_use dentro de message.content (Edit/Write/Read/
// NotebookEdit passam file_path/notebook_path no input). tool_result (eco do
// conteudo lido/escrito) e ignorado de proposito — nao e "toque" e pode
// conter qualquer texto, inclusive um "file_path" de outra nota citado ali.
export function extractVaultNotes(text, vaultRootLc = VAULT_LC) {
  const out = new Map(); // relPath -> count (case original)
  const root = String(vaultRootLc).toLowerCase().replaceAll('\\', '/').replace(/\/+$/, '');
  for (const o of parseLines(text)) {
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const el of content) {
      if (!el || el.type !== 'tool_use') continue;
      const p = el.input?.file_path ?? el.input?.notebook_path;
      if (typeof p !== 'string') continue;
      const norm = p.replaceAll('\\', '/');
      const lc = norm.toLowerCase();
      if (!lc.startsWith(root + '/')) continue;
      const rel = norm.slice(root.length + 1);
      if (!rel || !/\.(md|base|canvas)$/i.test(rel)) continue;
      out.set(rel, (out.get(rel) || 0) + 1);
    }
  }
  return [...out.entries()].map(([rel, count]) => ({ rel, count }));
}

// —— cache + backfill (espelho do usage.mjs) ——
const files = new Map(); // id -> {mtimeMs,size,project,lastTs,notes:[{rel,count}]}
let loaded = false;
let saveTimer = null;

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    // v2: extracao tool_use-only + notes como [{rel,count}] (v1 era regex
    // sobre texto cru, poluida por tool_result, e guardava so as keys).
    // Cache v1 e descartado => backfill automatico re-roda em fatias.
    if (raw?.v === 2 && raw.files) {
      for (const [id, rec] of Object.entries(raw.files)) files.set(id, rec);
    }
  } catch {
    // primeira run: cache ainda nao existe
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(CACHE_FILE, JSON.stringify({ v: 2, files: Object.fromEntries(files) }));
    } catch {
      // melhor-esforco: proxima save tenta de novo
    }
  }, SAVE_MS);
  saveTimer.unref();
}

async function listTranscripts() {
  const out = [];
  let dirs = [];
  try {
    dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let fl = [];
    try {
      fl = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of fl) {
      if (f.endsWith('.jsonl')) {
        out.push({
          id: f.slice(0, -6),
          file: path.join(dir, f),
          project: d.name.replace(PROJECT_PREFIX_RE, '') || 'home',
        });
      }
    }
  }
  return out;
}

// shortcut: readFile inteiro do transcript (maior visto ~29MB); ler em stream
// com o mesmo parse por chunk se o p95 do request passar de ~2s.
async function ingestSome() {
  const all = await listTranscripts();
  let pending = 0;
  let done = 0;
  for (const t of all) {
    let st;
    try {
      st = await fsp.stat(t.file);
    } catch {
      continue;
    }
    const rec = files.get(t.id);
    if (rec && rec.mtimeMs === st.mtimeMs && rec.size === st.size) continue;
    pending += 1;
    if (done >= MAX_INGEST) continue;
    done += 1;
    try {
      const text = await fsp.readFile(t.file, 'utf8');
      const notes = extractVaultNotes(text);
      files.set(t.id, { mtimeMs: st.mtimeMs, size: st.size, project: t.project, lastTs: st.mtimeMs, notes });
    } catch (err) {
      console.error('[note-sessions] pulou', t.id, err.message);
      files.set(t.id, { mtimeMs: st.mtimeMs, size: st.size, project: t.project, lastTs: st.mtimeMs, notes: [] });
    }
  }
  if (done) scheduleSave();
  return { pending: pending - done };
}

export function register(app) {
  app.get('/api/note-sessions', async (req, res) => {
    try {
      await loadCache();
      const { pending } = await ingestSome();
      const rel = String(req.query.path || '').replaceAll('\\', '/').replace(/^\/+/, '');
      if (!rel) return res.status(400).json({ error: 'path obrigatorio' });
      const relLc = rel.toLowerCase();
      const hits = [];
      for (const [id, rec] of files) {
        if (!rec.notes) continue;
        const hit = rec.notes.find((note) => note.rel.toLowerCase() === relLc);
        if (hit) hits.push({ id, project: rec.project, lastTs: rec.lastTs, count: hit.count });
      }
      hits.sort((a, b) => b.lastTs - a.lastTs);
      res.json({ ready: pending === 0, pending, sessions: hits.slice(0, TOP_SESSIONS) });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
