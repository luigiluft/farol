// FAROL - modulo agenda (ownership: W-SERVER, F7 C3.3).
// GET /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD: parser READ-ONLY das
// dailies VAULT/6-Daily/<date>.md para a pagina Agenda. Default: from =
// hoje-45d, to = hoje; range cap em 120 dias. Resposta: { days: [{ date,
// path, exists, events, tasks, sessions, github, note }] } em ordem
// cronologica. Secoes extraidas por heading (corpo vai ate o proximo
// heading de nivel igual ou superior): 'Agenda' => events [HH:MM(-HH:MM)]
// titulo; 'Prioridades do Dia' => tasks - [ ]/- [x] (so non-empty);
// 'Claude Code Session (HH:MM)' => sessions com ate 3 bullets de Tarefas no
// title (clip 120); 'GitHub Activity' => github (clip 100); note = Insight
// do dia ou Notas Rapidas (strip md, clip 200, <4 chars => null). TUDO
// defensivo: arquivo ausente => exists:false e arrays vazias. Cache 120s
// por range key. Emoji no titulo de evento PODE ficar (conteudo do usuario).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { VAULT } from './config.mjs';

const DAILY_REL = '6-Daily';
const DAILY_DIR = path.join(path.resolve(VAULT), DAILY_REL);
const DEFAULT_BACK_DAYS = 45;
const MAX_RANGE_DAYS = 120;
const CACHE_MS = 120 * 1000;
const CACHE_MAX_KEYS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_LEN = 200;
const NOTE_MIN_LEN = 4;
const SESSION_TITLE_LEN = 120;
const SESSION_BULLETS_MAX = 3;
const GITHUB_LEN = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const EVENT_RE = /^-\s+\[(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\]\s*(.+)$/;
const TASK_RE = /^-\s+\[( |x|X)\]\s*(.*)$/;
const GITHUB_LINE_RE = /^-\s+\[(\d{1,2}:\d{2})\]\s*(.+)$/;
const SESSION_HEAD_RE = /^Claude Code Session\s*\((\d{1,2}:\d{2})\)/;

const cache = new Map(); // 'from|to' -> { ts, data, pending }

// ----------------------------------------------------------------- datas ----

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function toUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveRange(fromRaw, toRaw) {
  const today = todayStr();
  let to = DATE_RE.test(toRaw) ? toRaw : today;
  let from = DATE_RE.test(fromRaw)
    ? fromRaw
    : fromUtcMs(toUtcMs(to) - DEFAULT_BACK_DAYS * DAY_MS);
  if (toUtcMs(from) > toUtcMs(to)) [from, to] = [to, from];
  const days = Math.floor((toUtcMs(to) - toUtcMs(from)) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) from = fromUtcMs(toUtcMs(to) - (MAX_RANGE_DAYS - 1) * DAY_MS);
  return { from, to };
}

// ---------------------------------------------------------------- parsing ----

function clipText(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

// Itera secoes cujo TEXTO de heading casa com headingRe; o corpo vai da
// linha seguinte ate o proximo heading de nivel igual ou superior.
function eachSection(lines, headingRe, cb) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (!m || !headingRe.test(m[2].trim())) continue;
    const level = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].match(HEADING_RE);
      if (h && h[1].length <= level) break;
      body.push(lines[j]);
    }
    cb(m[2].trim(), body);
  }
}

function parseEvents(body, out) {
  for (const line of body) {
    const m = line.trim().match(EVENT_RE);
    if (!m) continue;
    out.push({ start: m[1], end: m[2] || null, title: m[3].trim() });
  }
}

function parseTasks(body, out) {
  for (const line of body) {
    const m = line.trim().match(TASK_RE);
    if (!m) continue;
    const text = m[2].trim();
    if (!text) continue;
    out.push({ done: m[1].toLowerCase() === 'x', text });
  }
}

function parseGithub(body, out) {
  for (const line of body) {
    const m = line.trim().match(GITHUB_LINE_RE);
    if (!m) continue;
    const text = clipText(m[2].replace(/\*\*/g, ''), GITHUB_LEN);
    if (!text) continue;
    // push sem commit (tag/force/ruido do watcher) nao informa nada
    if (/\b0 commit/.test(text)) continue;
    out.push({ time: m[1], text });
  }
}

// Bullets uteis de '**Tarefas:**' dentro do bloco da sessao; wrappers de
// comando (<command-name> etc) e embeds de imagem sao ruido, nao tarefa.
function sessionTitle(body) {
  const bullets = [];
  let inTarefas = false;
  for (const line of body) {
    const t = line.trim();
    if (/^\*\*Tarefas/i.test(t)) {
      inTarefas = true;
      continue;
    }
    if (!inTarefas) continue;
    if (t.startsWith('**')) break; // proxima subsecao do bloco
    if (!t.startsWith('- ')) continue;
    const item = t.slice(2).trim();
    if (!item || item.startsWith('<') || item.startsWith('[Image')) continue;
    bullets.push(item);
    if (bullets.length >= SESSION_BULLETS_MAX) break;
  }
  if (!bullets.length) return 'Claude Code Session';
  return clipText(`Claude Code Session: ${bullets.join(' · ')}`, SESSION_TITLE_LEN);
}

function cleanNote(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[#*>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < NOTE_MIN_LEN) return null;
  return t.length > NOTE_LEN ? t.slice(0, NOTE_LEN) : t;
}

// Bullet '- ' no inicio da linha e sintaxe md, nao conteudo ('-' no meio
// do texto, como datas, fica intacto).
function stripBullet(line) {
  return line.trim().replace(/^-\s+/, '');
}

// Marker de callout Obsidian no inicio da linha e sintaxe, nao conteudo:
// '> [!info] DECISAO' / '[!note]+ texto' / '!tip texto' => so o texto.
// Sem o strip, cleanNote troca os colchetes por espaco e '!info' vaza
// literal na NOTA do painel do dia. Quote '>' tambem e sintaxe aqui.
function stripCallout(line) {
  return line
    .trim()
    .replace(/^(?:>\s*)+/, '')
    .replace(/^\[?!\w+\]?[+-]?\s*/, '');
}

// Ordem: callout primeiro ('> - item' vira '- item'), bullet depois.
function stripNoteLine(line) {
  return stripBullet(stripCallout(line));
}

// Texto apos a linha '**Insight do dia:**' ate o proximo heading, label em
// negrito ou hrule. Vazio => fallback p/ a secao 'Notas Rapidas'.
function extractNote(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^\*\*Insight do dia:?\*\*/i.test(lines[i].trim())) continue;
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (HEADING_RE.test(t) || /^\*\*[^*]+\*\*:?$/.test(t) || t.startsWith('---')) break;
      if (t) buf.push(stripNoteLine(t));
    }
    const insight = cleanNote(buf.join(' '));
    if (insight) return insight;
    break;
  }
  let rapidas = null;
  eachSection(lines, /^Notas Rapidas/i, (h, body) => {
    if (rapidas === null) rapidas = cleanNote(body.map(stripNoteLine).join(' '));
  });
  return rapidas;
}

function parseDaily(date, raw) {
  const lines = raw.split(/\r?\n/);
  const events = [];
  const tasks = [];
  const sessions = [];
  const github = [];
  eachSection(lines, /Agenda/i, (h, body) => parseEvents(body, events));
  eachSection(lines, /Prioridades do Dia/i, (h, body) => parseTasks(body, tasks));
  eachSection(lines, /^Claude Code Session\s*\(\d/, (h, body) => {
    const m = h.match(SESSION_HEAD_RE);
    if (m) sessions.push({ time: m[1], title: sessionTitle(body) });
  });
  eachSection(lines, /GitHub Activity/i, (h, body) => parseGithub(body, github));
  return {
    date,
    path: `${DAILY_REL}/${date}.md`,
    exists: true,
    events,
    tasks,
    sessions,
    github,
    note: extractNote(lines),
  };
}

// ------------------------------------------------------------------ dias ----

function emptyDay(date) {
  return {
    date,
    path: `${DAILY_REL}/${date}.md`,
    exists: false,
    events: [],
    tasks: [],
    sessions: [],
    github: [],
    note: null,
  };
}

async function buildDay(date) {
  let raw;
  try {
    raw = await fsp.readFile(path.join(DAILY_DIR, `${date}.md`), 'utf8');
  } catch {
    return emptyDay(date);
  }
  try {
    return parseDaily(date, raw);
  } catch (err) {
    console.error('[agenda] parse falhou em', date, err.message);
    return emptyDay(date);
  }
}

async function collectDays(from, to) {
  const dates = [];
  for (let ms = toUtcMs(from); ms <= toUtcMs(to); ms += DAY_MS) {
    dates.push(fromUtcMs(ms));
  }
  const days = await Promise.all(dates.map(buildDay));
  return { days };
}

// ----------------------------------------------------------------- cache ----

function pruneCache(now) {
  if (cache.size <= CACHE_MAX_KEYS) return;
  for (const [key, hit] of cache) {
    if (!hit.pending && now - hit.ts > CACHE_MS) cache.delete(key);
  }
}

export async function getAgenda(fromRaw, toRaw) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const key = `${from}|${to}`;
  const now = Date.now();
  pruneCache(now);
  const hit = cache.get(key);
  if (hit && hit.data && now - hit.ts < CACHE_MS) return hit.data;
  if (hit && hit.pending) return hit.pending;
  const pending = collectDays(from, to)
    .then((data) => {
      cache.set(key, { ts: Date.now(), data, pending: null });
      return data;
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  // ts antigo preservado: dado stale nao volta a valer como fresco enquanto
  // a revalidacao roda (quem chegar agora pega o pending, nao o stale).
  cache.set(key, { ts: hit ? hit.ts : 0, data: hit ? hit.data : null, pending });
  return pending;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/agenda', async (req, res) => {
    try {
      res.json(await getAgenda(String(req.query.from || ''), String(req.query.to || '')));
    } catch (err) {
      console.error('[agenda]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
