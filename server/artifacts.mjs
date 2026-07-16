// Trilha de artefatos por sessão: URLs citadas pelo assistant + arquivos produzidos.
// ANTI-VENENO (lição note-sessions): só message.content de assistant (text + tool_use.input);
// tool_result NUNCA — eco de leitura não é produção.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { getSessionFile } from './sessions.mjs';
import { parseLines } from './transcript-parse.mjs';

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const MAX_ITEMS = 200;
const CACHE_MAX = 8; // LRU, padrao visor.mjs

export function extractArtifacts(objs) {
  const byValue = new Map(); // value -> {ts, kind, value, tool?}
  for (const o of objs) {
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    if (o.type !== 'assistant') continue; // tool_result vive em type user — fora
    const ts = Date.parse(o.timestamp || '') || 0;
    for (const el of content) {
      if (el?.type === 'text' && typeof el.text === 'string') {
        for (const m of el.text.matchAll(URL_RE)) {
          const value = m[0].replace(/[.,;:]+$/, '');
          const prev = byValue.get(value);
          if (!prev || ts > prev.ts) byValue.set(value, { ts, kind: 'url', value });
        }
      } else if (el?.type === 'tool_use' && WRITE_TOOLS.has(el.name)) {
        const p = el.input?.file_path ?? el.input?.notebook_path;
        if (typeof p !== 'string' || !p) continue;
        const value = p.replaceAll('\\', '/');
        const kind = IMG_EXT_RE.test(value) ? 'image' : 'file';
        const prev = byValue.get(value);
        if (!prev || ts > prev.ts) byValue.set(value, { ts, kind, value, tool: el.name });
      }
    }
  }
  return [...byValue.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
}

// ------------------------------------------------------------- ledger ------
// Timeline do que a sessão fez, classificada. SÓ tool_use de assistant
// (anti-veneno note-sessions: regex em texto cru casa payload de hook).
const MAX_LEDGER = 200;

function shortPath(p) {
  if (typeof p !== 'string' || !p) return '';
  const parts = p.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/');
}

function hostOf(u) {
  try { return new URL(String(u)).host; } catch { return ''; }
}

function classifyUse(name, input) {
  if (name === 'Read') return { cat: 'viu', verb: 'leu', target: shortPath(input.file_path) };
  if (name === 'Write') return { cat: 'criou', verb: 'escreveu', target: shortPath(input.file_path) };
  if (name === 'Edit' || name === 'NotebookEdit') {
    return { cat: 'criou', verb: 'editou', target: shortPath(input.file_path || input.notebook_path) };
  }
  if (name === 'WebFetch') return { cat: 'acessou', verb: 'consultou', target: hostOf(input.url) };
  if (name === 'WebSearch') return { cat: 'acessou', verb: 'pesquisou', target: String(input.query || '').slice(0, 80) };
  if (name === 'Glob' || name === 'Grep') return { cat: 'acessou', verb: 'buscou', target: String(input.pattern || '').slice(0, 80) };
  if (name === 'Bash' || name === 'PowerShell') return { cat: 'rodou', verb: 'rodou', target: String(input.command || '').slice(0, 90) };
  if (name === 'Agent' || name === 'Task') return { cat: 'rodou', verb: 'despachou agente', target: String(input.description || '').slice(0, 80) };
  if (/^mcp__.+__(navigate|tabs_create_mcp)$/.test(name)) {
    return { cat: 'acessou', verb: 'navegou', target: hostOf(input.url) || String(input.url || '') };
  }
  if (name.startsWith('mcp__higgsfield__generate')) {
    return { cat: 'criou', verb: 'gerou (higgsfield)', target: String((input.params && input.params.model) || '') };
  }
  if (name.startsWith('mcp__')) {
    const m = name.match(/^mcp__(.+?)__(.+)$/);
    return { cat: 'acessou', verb: 'mcp ' + (m ? m[1] : ''), target: m ? m[2] : name };
  }
  return null;
}

export function extractLedger(objs) {
  const rows = [];
  for (const o of Array.isArray(objs) ? objs : []) {
    if (o?.type !== 'assistant') continue;
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    const ts = Date.parse(o.timestamp || '') || 0;
    for (const el of content) {
      if (el?.type !== 'tool_use' || typeof el.name !== 'string') continue;
      const c = classifyUse(el.name, el.input || {});
      if (c && c.target) rows.push({ ts, tool: el.name, ...c });
    }
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows.slice(-MAX_LEDGER);
}

// —— cache LRU por (id, mtime+size), padrao visor.mjs ——
const cache = new Map(); // id -> {mtimeMs, size, items, ledger}

// cache: id -> { mtimeMs, size, items, ledger }
async function entryFor(id) {
  const file = await getSessionFile(id);
  if (!file || !fs.existsSync(file)) return null;
  const st = await fsp.stat(file);
  const hit = cache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    cache.delete(id); cache.set(id, hit);
    return hit;
  }
  const text = await fsp.readFile(file, 'utf8');
  const objs = parseLines(text);
  const entry = { mtimeMs: st.mtimeMs, size: st.size, items: extractArtifacts(objs), ledger: extractLedger(objs) };
  cache.set(id, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry;
}

export function register(app) {
  app.get('/api/artifacts', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      if (!/^[a-f0-9][a-f0-9-]{7,}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
      const e = await entryFor(id);
      if (!e) return res.status(404).json({ error: 'sessão não encontrada' });
      res.json({ id, count: e.items.length, items: e.items });
    } catch (err) {
      console.error('[artifacts]', err?.message || err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.get('/api/ledger', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      if (!/^[a-f0-9][a-f0-9-]{7,}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
      const e = await entryFor(id);
      if (!e) return res.status(404).json({ error: 'sessão não encontrada' });
      res.json({ id, count: e.ledger.length, events: e.ledger });
    } catch (err) {
      console.error('[ledger]', err?.message || err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
