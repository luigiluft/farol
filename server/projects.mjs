// FAROL - modulo projects (ownership: agente A1).
// GET /api/projects: agrega as subpastas de 1-Projects do vault (+ notas
// soltas na raiz como projeto "solto") com noteCount, ultimas 3 notas e
// activity[14] = notas modificadas por dia (indice 0 = 13 dias atras,
// indice 13 = hoje; dia-calendario local). Cache de 60s em memoria.
// Leitura defensiva: a rota nunca derruba o server.

import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { VAULT } from './config.mjs';

const VAULT_ROOT = path.resolve(VAULT);
const PROJECTS_REL = '1-Projects';
const PROJECTS_DIR = path.join(VAULT_ROOT, PROJECTS_REL);
const CACHE_MS = 60 * 1000;
// 6 cobre o maior tier do client (Projects.jsx xl=6/wide=5); o client
// fatia por tier, entao card menor segue mostrando 3 (seam F7).
const RECENT_COUNT = 6;
const MAX_TAGS = 3;
const ACTIVITY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOSE_NAME = 'solto';
// Tags de taxonomia do vault repetidas em todo card viram ruido nos chips;
// so as distintivas (nomes distintivos do projeto...) chegam na UI.
const STRUCTURAL_TAGS = new Set(['timeline', 'project']);
const STRUCTURAL_TAG_PREFIX = 'type/';

const cache = { ts: 0, data: null, pending: null };

// --------------------------------------------------------------- leitura ----

async function listMdWithStats(dirAbs, relDir, out) {
  let entries = [];
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = relDir + '/' + e.name;
    if (e.isDirectory()) {
      await listMdWithStats(path.join(dirAbs, e.name), rel, out);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      try {
        const st = await fsp.stat(path.join(dirAbs, e.name));
        out.push({ rel, mtimeMs: st.mtimeMs });
      } catch {
        // arquivo sumiu entre readdir e stat: ignorar
      }
    }
  }
  return out;
}

// F7 (C3.6): a MESMA leitura usada p/ o title tambem colhe as tags do
// frontmatter (zero I/O extra). Tags sao agregadas por projeto (cap 3).
async function noteInfo(rel) {
  const fallback = path.basename(rel).replace(/\.md$/i, '');
  try {
    const raw = await fsp.readFile(path.join(VAULT_ROOT, rel), 'utf8');
    const { data } = matter(raw);
    const title =
      data && typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : fallback;
    return { title, tags: normalizeTags(data ? data.tags : null) };
  } catch {
    // frontmatter quebrado ou arquivo ilegivel: cai no basename
    return { title: fallback, tags: [] };
  }
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const clean = t.trim();
    if (clean && !isStructuralTag(clean)) out.push(clean);
  }
  return out;
}

function isStructuralTag(tag) {
  const lc = tag.toLowerCase();
  return STRUCTURAL_TAGS.has(lc) || lc.startsWith(STRUCTURAL_TAG_PREFIX);
}

// -------------------------------------------------------------- agregacao ----

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayIndex(mtimeMs, todayStart) {
  // 0 = 13 dias atras ... 13 = hoje. mtime futuro (clock skew) cai em hoje.
  const back = mtimeMs >= todayStart ? 0 : Math.floor((todayStart - mtimeMs) / DAY_MS) + 1;
  if (back >= ACTIVITY_DAYS) return -1;
  return ACTIVITY_DAYS - 1 - back;
}

// Logo por CONVENCAO (pedido 2026-07-10): arquivo logo.{png,jpg,jpeg,svg,
// webp,ico} na RAIZ da pasta do projeto (case-insensitive). Achou = o card
// troca o identicon pela imagem via /api/asset; nao achou = null (fallback).
const LOGO_RE = /^logo\.(png|jpe?g|svg|webp|ico)$/i;

async function findLogo(relBase) {
  try {
    const entries = await fsp.readdir(path.join(VAULT_ROOT, relBase), { withFileTypes: true });
    const hit = entries.find((e) => e.isFile() && LOGO_RE.test(e.name));
    return hit ? `${relBase}/${hit.name}` : null;
  } catch {
    return null;
  }
}

async function buildProject(name, relBase, notes, todayStart) {
  const activity = new Array(ACTIVITY_DAYS).fill(0);
  let lastModified = 0;
  for (const n of notes) {
    if (n.mtimeMs > lastModified) lastModified = n.mtimeMs;
    const i = dayIndex(n.mtimeMs, todayStart);
    if (i >= 0) activity[i] += 1;
  }
  // Notas estruturais do vault (basename com '_' inicial, ex. _Timeline)
  // ficam fora das recentes — noteCount e activity continuam contando tudo.
  const visible = notes.filter((n) => !path.basename(n.rel).startsWith('_'));
  const recent = [...visible].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT_COUNT);
  const recentNotes = [];
  const tags = [];
  for (const n of recent) {
    const info = await noteInfo(n.rel);
    recentNotes.push({ title: info.title, path: n.rel, mtimeMs: n.mtimeMs });
    for (const t of info.tags) {
      if (tags.length >= MAX_TAGS) break;
      if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    }
  }
  return {
    name,
    path: relBase,
    noteCount: notes.length,
    lastModifiedTs: lastModified ? new Date(lastModified).toISOString() : null,
    recentNotes,
    activity,
    tags, // F7 (C3.6): ate 3, das recentNotes (mais recente primeiro)
    logo: await findLogo(relBase),
  };
}

async function collectProjects() {
  let entries = [];
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('[projects] 1-Projects ilegivel:', err.message);
    return [];
  }
  const todayStart = startOfToday();
  const out = [];
  const loose = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      const rel = PROJECTS_REL + '/' + e.name;
      const notes = await listMdWithStats(path.join(PROJECTS_DIR, e.name), rel, []);
      if (notes.length) out.push(await buildProject(e.name, rel, notes, todayStart));
    } else if (e.name.toLowerCase().endsWith('.md')) {
      try {
        const st = await fsp.stat(path.join(PROJECTS_DIR, e.name));
        loose.push({ rel: PROJECTS_REL + '/' + e.name, mtimeMs: st.mtimeMs });
      } catch {
        // ignorar
      }
    }
  }
  if (loose.length) out.push(await buildProject(LOOSE_NAME, PROJECTS_REL, loose, todayStart));
  out.sort((a, b) => String(b.lastModifiedTs).localeCompare(String(a.lastModifiedTs)));
  return out;
}

// ----------------------------------------------------------------- cache ----

export async function getProjects() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;
  if (!cache.pending) {
    cache.pending = collectProjects()
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
  app.get('/api/projects', async (req, res) => {
    try {
      res.json(await getProjects());
    } catch (err) {
      console.error('[projects]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
