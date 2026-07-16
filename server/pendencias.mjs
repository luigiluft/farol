// FAROL - pendencias do VAULT (1-Projects/_Pendencias) + contagem do
// 0-Inbox, pro Comando do Dia (o que o brief da manha mostra, na tela).
// Read-only: parseia frontmatter dos .md TOP-LEVEL (subpastas done/_standby/
// etc ficam fora), ranqueia por status (vermelho > amarelo > branco) e
// devolve o top N + total + inbox. Cache 60s (arquivos mudam pouco).
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { VAULT } from './config.mjs';

const PEND_DIR = path.join(VAULT, '1-Projects', '_Pendencias');
const INBOX_DIR = path.join(VAULT, '0-Inbox');
const TOP_N = 3;
const CACHE_MS = 60 * 1000;
const STATUS_RANK = { '🔴': 0, '🟡': 1, '⚪': 2 };

const cache = { ts: 0, data: null, pending: null };

// Ranqueia um status cru do frontmatter; desconhecido = pior que branco.
export function statusRank(s) {
  const key = String(s || '').trim();
  return STATUS_RANK[key] !== undefined ? STATUS_RANK[key] : 3;
}

async function readPendencias() {
  let entries = [];
  try {
    entries = await fsp.readdir(PEND_DIR, { withFileTypes: true });
  } catch {
    return { total: 0, top: [] };
  }
  const items = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue; // done/ etc fora
    try {
      const raw = await fsp.readFile(path.join(PEND_DIR, e.name), 'utf8');
      const fm = matter(raw).data || {};
      if (fm.type && fm.type !== 'pendencia') continue;
      items.push({
        id: String(fm.id || e.name.replace(/\.md$/, '')),
        status: String(fm.status || '⚪').trim(),
        title: String(fm.title || fm.id || e.name.replace(/\.md$/, '')),
        projeto: fm.projeto ? String(fm.projeto) : null,
        tempo: fm.tempo ? String(fm.tempo) : null,
        path: '1-Projects/_Pendencias/' + e.name, // vault-rel: abre no NoteView
      });
    } catch {
      // arquivo ilegivel/frontmatter quebrado: pula sem derrubar o card
    }
  }
  items.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id));
  return { total: items.length, top: items.slice(0, TOP_N) };
}

// Contagem + item mais NOVO do 0-Inbox (o "atalho" do card).
async function readInbox() {
  let entries = [];
  try {
    entries = await fsp.readdir(INBOX_DIR, { withFileTypes: true });
  } catch {
    return { count: 0, newest: null };
  }
  let count = 0;
  let newest = null;
  let newestMs = 0;
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    count += 1;
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const st = await fsp.stat(path.join(INBOX_DIR, e.name));
      if (st.mtimeMs > newestMs) {
        newestMs = st.mtimeMs;
        newest = '0-Inbox/' + e.name;
      }
    } catch {
      // sumiu entre readdir e stat
    }
  }
  return { count, newest };
}

async function collect() {
  const [pend, inbox] = await Promise.all([readPendencias(), readInbox()]);
  return { ...pend, inbox };
}

export function register(app) {
  app.get('/api/pendencias', async (req, res) => {
    try {
      const now = Date.now();
      if (cache.data && now - cache.ts < CACHE_MS) return res.json(cache.data);
      if (!cache.pending) {
        cache.pending = collect()
          .then((data) => {
            cache.data = data;
            cache.ts = Date.now();
            return data;
          })
          .finally(() => { cache.pending = null; });
      }
      res.json(await cache.pending);
    } catch (err) {
      console.error('[pendencias]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    }
  });
}
