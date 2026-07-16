// FAROL - usage: rollup de tokens PERSISTIDO (aba USO). Varre os transcripts
// top-level de ~/.claude/projects (subagentes em subdirs ficam FORA — somar o
// tail re-parseado inflaria, licao F7.1), extrai totais por sessao e agrega
// por dia x projeto x modelo. Incremental por (mtimeMs,size) com cache em
// .data/usage.json; backfill anda em fatias de MAX_INGEST por request
// (ready:false ate terminar — a UI re-polla). Atribuicao: tokens da sessao
// inteira caem no dia do FIM dela (mtime).
// shortcut: sessao multi-dia atribui tudo ao dia final; split por dia se a
// distorcao aparecer nas maratonas.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE, DATA_DIR, PROJECT_PREFIX_RE } from './config.mjs';
import { parseLines, rawUserText, isRealUserPrompt, clip } from './transcript-parse.mjs';
import { inferTopic } from './topics.mjs';
import { loadLimits, weeklyResetsInRange, nextWeeklyReset, lastWeeklyReset } from './limits.mjs';

// re-export: consumidores e checks seguem importando daqui
export { inferTopic } from './topics.mjs';

const PROJECTS = path.join(CLAUDE, 'projects');
const CACHE_FILE = path.join(DATA_DIR, 'usage.json');
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_INGEST = 10; // arquivos novos processados por request
const SAVE_MS = 10 * 1000;
const FIRST_PROMPT_LEN = 140;
// Classificacao de topico: quando o 1º prompt nao casa nenhuma regra (sessao
// que abre com "sim"/"continua"/"conclua"), varre os primeiros EARLY_PROMPTS
// prompts reais — a missao costuma aparecer nos primeiros turnos.
const EARLY_PROMPTS = 5;
const EARLY_TEXT_LEN = 600;
const TOP_SESSIONS = 20;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;

const files = new Map(); // id -> registro persistido
let loaded = false;
let saveTimer = null;
let ingesting = false;

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    // v3: topico com fallback (varre primeiros prompts p/ sessao de continuacao)
    // + earlyText. Cache v2/v1 e descartado => backfill re-classifica em fatias.
    if (raw && raw.v === 3 && raw.files && typeof raw.files === 'object') {
      for (const [id, rec] of Object.entries(raw.files)) {
        if (rec && Number.isFinite(rec.mtimeMs)) files.set(id, rec);
      }
    }
  } catch {
    // primeiro boot: cache vazio
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist().catch((err) => console.error('[usage] save:', err.message));
  }, SAVE_MS);
  saveTimer.unref();
}

async function persist() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const plain = { v: 3, files: Object.fromEntries(files) };
  await fsp.writeFile(CACHE_FILE, JSON.stringify(plain), 'utf8');
}

// Data local YYYY-MM-DD (relogio da maquina = America/Sao_Paulo).
function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Fatos de uso de um transcript parseado. PURO (testavel com fixture).
// v2: alem dos totais, distribui por DIA REAL da linha (o.timestamp) —
// sessao-maratona que vira a noite deixa cada token no dia certo.
// fallbackDate cobre linha sem timestamp valido.
export function extractUsageFacts(objs, fallbackDate) {
  let inTok = 0;
  let outTok = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let model = null;
  let firstPrompt = null;
  const earlyParts = [];
  const days = {};
  const bump = (date, u) => {
    const d = days[date] || { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 };
    d.in += u.in; d.out += u.out; d.cacheRead += u.cr; d.cacheCreate += u.cc;
    days[date] = d;
  };
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'assistant' && o.message) {
      // '<synthetic>' e marcador interno do CC, nao um modelo real
      if (o.message.model && o.message.model !== '<synthetic>') model = o.message.model;
      const u = o.message.usage;
      if (u && typeof u === 'object') {
        const li = Number.isFinite(u.input_tokens) ? u.input_tokens : 0;
        const lo = Number.isFinite(u.output_tokens) ? u.output_tokens : 0;
        const lcr = Number.isFinite(u.cache_read_input_tokens) ? u.cache_read_input_tokens : 0;
        const lcc = Number.isFinite(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0;
        inTok += li; outTok += lo; cacheRead += lcr; cacheCreate += lcc;
        const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
        const date = Number.isFinite(ts) ? localDate(ts) : (fallbackDate || 'sem-data');
        bump(date, { in: li, out: lo, cr: lcr, cc: lcc });
      }
    } else if (o.type === 'user' && isRealUserPrompt(o)) {
      const txt = rawUserText(o.message);
      if (firstPrompt === null) firstPrompt = clip(txt, FIRST_PROMPT_LEN);
      if (earlyParts.length < EARLY_PROMPTS && txt) earlyParts.push(txt);
    }
  }
  const earlyText = clip(earlyParts.join(' · '), EARLY_TEXT_LEN);
  return { in: inTok, out: outTok, cacheRead, cacheCreate, model, firstPrompt, earlyText, days };
}

// Agrega o mapa de arquivos em serie diaria + top sessoes + tópicos. PURO.
// v2: cada sessao distribui pelos SEUS dias (rec.days); só entram no periodo
// os dias >= sinceDate. Sessao entra no top se qualquer dia dela cair dentro.
export function aggregate(fileMap, sinceDate) {
  const days = new Map();
  const sessions = [];
  const topics = {};
  const totals = { in: 0, out: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
  const dayOf = (date) => {
    let d = days.get(date);
    if (!d) {
      d = {
        date, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, total: 0,
        byModel: {}, byProject: {}, byTopic: {},
      };
      days.set(date, d);
    }
    return d;
  };
  for (const [id, r] of fileMap) {
    if (!r) continue;
    const topic = r.topic || 'outros';
    // v2 tem rec.days; registro legado (sem days) cai no dia unico do fim
    const perDay = r.days && typeof r.days === 'object' && Object.keys(r.days).length
      ? r.days
      : (r.date ? { [r.date]: { in: r.in || 0, out: r.out || 0, cacheRead: r.cacheRead || 0, cacheCreate: r.cacheCreate || 0 } } : {});
    let sIn = 0; let sOut = 0; let sCr = 0;
    for (const [date, v] of Object.entries(perDay)) {
      if (!date || date < sinceDate) continue;
      const vi = v.in || 0; const vo = v.out || 0;
      const vcr = v.cacheRead || 0; const vcc = v.cacheCreate || 0;
      const vt = vi + vo;
      const day = dayOf(date);
      day.in += vi; day.out += vo;
      day.cacheRead += vcr; day.cacheCreate += vcc;
      day.total += vt;
      if (r.model) day.byModel[r.model] = (day.byModel[r.model] || 0) + vt;
      const proj = r.project || 'home';
      day.byProject[proj] = (day.byProject[proj] || 0) + vt;
      day.byTopic[topic] = (day.byTopic[topic] || 0) + vt;
      topics[topic] = (topics[topic] || 0) + vt;
      totals.in += vi; totals.out += vo;
      totals.cacheRead += vcr; totals.cacheCreate += vcc;
      totals.total += vt;
      sIn += vi; sOut += vo; sCr += vcr;
    }
    if (sIn + sOut > 0) {
      sessions.push({
        id,
        project: r.project || 'home',
        topic,
        model: r.model || null,
        date: r.date,
        in: sIn,
        out: sOut,
        cacheRead: sCr,
        total: sIn + sOut,
        durMs: r.durMs || 0,
        firstPrompt: r.firstPrompt || null,
      });
    }
  }
  sessions.sort((a, b) => b.total - a.total);
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topSessions: sessions.slice(0, TOP_SESSIONS),
    topics,
    totals,
    sessionCount: sessions.length,
  };
}

async function listTranscripts() {
  let dirs = [];
  try {
    dirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dirAbs = path.join(PROJECTS, d.name);
    let entries = [];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue; // subdirs (subagentes) FORA
      try {
        const st = await fsp.stat(path.join(dirAbs, e.name));
        out.push({
          id: path.basename(e.name, '.jsonl'),
          file: path.join(dirAbs, e.name),
          project: d.name.replace(PROJECT_PREFIX_RE, '') || 'home',
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs || st.mtimeMs,
          size: st.size,
        });
      } catch {
        // sumiu entre readdir e stat: ignorar
      }
    }
  }
  return out;
}

async function readBounded(file, size) {
  if (size <= MAX_SCAN_BYTES) return fsp.readFile(file, 'utf8');
  // gigante: head+tail (aproximacao aceitavel; so maratonas passam de 16MB)
  const half = Math.floor(MAX_SCAN_BYTES / 2);
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const a = Buffer.alloc(half);
    const b = Buffer.alloc(half);
    await fh.read(a, 0, half, 0);
    await fh.read(b, 0, half, size - half);
    return a.toString('utf8') + '\n' + b.toString('utf8');
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Processa ate MAX_INGEST arquivos desatualizados. Retorna pendentes restantes.
async function ingestSome() {
  const metas = await listTranscripts();
  const stale = metas.filter((m) => {
    const got = files.get(m.id);
    return !got || got.mtimeMs !== m.mtimeMs || got.size !== m.size;
  });
  const batch = stale.slice(0, MAX_INGEST);
  for (const m of batch) {
    try {
      const objs = parseLines(await readBounded(m.file, m.size));
      const facts = extractUsageFacts(objs, localDate(m.mtimeMs));
      // 1ª tentativa: missao (1º prompt). Se cair em 'outros', tenta os
      // primeiros prompts — pega sessao que abre com "sim"/"continua".
      let topic = inferTopic(facts.firstPrompt);
      if (topic === 'outros' && facts.earlyText) topic = inferTopic(facts.earlyText);
      files.set(m.id, {
        mtimeMs: m.mtimeMs,
        size: m.size,
        project: m.project,
        model: facts.model,
        date: localDate(m.mtimeMs),
        topic,
        days: facts.days,
        in: facts.in,
        out: facts.out,
        cacheRead: facts.cacheRead,
        cacheCreate: facts.cacheCreate,
        durMs: Math.max(0, m.mtimeMs - m.birthtimeMs),
        firstPrompt: facts.firstPrompt,
      });
    } catch (err) {
      console.error('[usage] pulou', m.id, err.message);
      files.set(m.id, {
        mtimeMs: m.mtimeMs, size: m.size, project: m.project, model: null,
        date: localDate(m.mtimeMs), topic: 'outros', days: {},
        in: 0, out: 0, cacheRead: 0, cacheCreate: 0,
        durMs: 0, firstPrompt: null,
      });
    }
  }
  if (batch.length) scheduleSave();
  return stale.length - batch.length;
}

// Marcador de reset semanal p/ o grafico. Le a ancora de .data/limits.json e
// projeta o ciclo de 7d dentro do periodo. null => UI mostra "configure".
function buildLimits(nDays) {
  const cfg = loadLimits();
  if (!cfg || !cfg.weekly) return null;
  const anchorMs = cfg.weekly.anchorMs;
  const untilMs = Date.now();
  const sinceMs = untilMs - nDays * 86400000; // 1 dia de folga na borda
  return {
    weekly: {
      resets: weeklyResetsInRange(anchorMs, sinceMs, untilMs).map(localDate),
      next: nextWeeklyReset(anchorMs, untilMs),
      cycleStart: localDate(lastWeeklyReset(anchorMs, untilMs)),
    },
  };
}

export function register(app) {
  app.get('/api/usage', async (req, res) => {
    try {
      await loadCache();
      let pending = 0;
      if (!ingesting) {
        ingesting = true;
        try {
          pending = await ingestSome();
        } finally {
          ingesting = false;
        }
      }
      const nDays = Math.min(
        MAX_DAYS,
        Math.max(1, Number.parseInt(req.query.days, 10) || DEFAULT_DAYS),
      );
      const since = localDate(Date.now() - (nDays - 1) * 86400000);
      const agg = aggregate(files, since);
      res.json({ ready: pending === 0, pendingFiles: pending, ...agg, limits: buildLimits(nDays) });
    } catch (err) {
      console.error('[usage]', err.message);
      res.status(500).json({ error: 'erro interno' });
    }
  });
}
