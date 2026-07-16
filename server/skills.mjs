// FAROL - modulo skills (ownership: W-SERVER, F7 C3.1).
// GET /api/skills: catalogo da Oficina (~/.claude/skills) para a BIBLIOTECA
// orbital do grafo e a estante magica da sala. Fonte: readdir de
// CLAUDE/skills ignorando dirs que comecam com '_' ou '.'; cada SKILL.md
// lido com gray-matter em try/catch POR ARQUIVO (frontmatter quebrado =>
// name=dirname, description=''). usedCount/lastUsedTs vem do skillSeen de
// sessions.mjs (match por id OU name, ambos trim+lowercase — mesma regra do
// match da Frota). Catalogo cacheado 60s; counts mesclados frescos a cada
// request. Resposta: [{ id, name, description, usedCount, lastUsedTs }]
// ordenada por usedCount desc, name asc. Rota nunca derruba o server.

import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { CLAUDE } from './config.mjs';
import { getSkillSeen } from './sessions.mjs';

const SKILLS_DIR = path.join(CLAUDE, 'skills');
const CACHE_MS = 60 * 1000;
const DESC_LEN = 160;

const cache = { ts: 0, data: null, pending: null };

// --------------------------------------------------------------- catalogo ----

function clipDesc(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > DESC_LEN ? t.slice(0, DESC_LEN) : t;
}

async function readSkill(dirName) {
  let name = dirName;
  let description = '';
  try {
    const raw = await fsp.readFile(path.join(SKILLS_DIR, dirName, 'SKILL.md'), 'utf8');
    const { data } = matter(raw);
    if (data && typeof data.name === 'string' && data.name.trim()) name = data.name.trim();
    if (data && typeof data.description === 'string') description = clipDesc(data.description);
  } catch {
    // SKILL.md ausente ou frontmatter quebrado: name=dirname, description=''
  }
  return { id: dirName, name, description };
}

async function collectCatalog() {
  let entries = [];
  try {
    entries = await fsp.readdir(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('[skills] dir ilegivel:', err.message);
    return [];
  }
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
  );
  return Promise.all(dirs.map((e) => readSkill(e.name)));
}

async function getCatalog() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;
  if (!cache.pending) {
    cache.pending = collectCatalog()
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

// ------------------------------------------------------------------- uso ----

// Indice normalizado do skillSeen: casa por id (dirname) OU name do
// frontmatter, ambos trim().toLowerCase().
function seenIndex() {
  const idx = new Map();
  for (const [key, val] of getSkillSeen()) {
    if (typeof key !== 'string' || !val) continue;
    const norm = key.trim().toLowerCase();
    if (norm) idx.set(norm, val);
  }
  return idx;
}

function usageOf(idx, skill) {
  return idx.get(skill.id.toLowerCase()) || idx.get(skill.name.trim().toLowerCase()) || null;
}

export async function listSkills() {
  const catalog = await getCatalog();
  const idx = seenIndex();
  const out = catalog.map((skill) => {
    const seen = usageOf(idx, skill);
    return {
      ...skill,
      usedCount: seen && Number.isFinite(seen.count) ? seen.count : 0,
      lastUsedTs: seen && Number.isFinite(seen.lastUsedTs) ? seen.lastUsedTs : null,
    };
  });
  out.sort((a, b) => b.usedCount - a.usedCount || a.name.localeCompare(b.name, 'pt-BR'));
  return out;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/skills', async (req, res) => {
    try {
      res.json(await listSkills());
    } catch (err) {
      console.error('[skills]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
