// FAROL - assets: gerações de MCP (Higgsfield) extraídas dos tool_results.
// Read-only sobre o jsonl; o payload de job_status traz JSON estruturado
// ({generation:{... results:{rawUrl,minUrl}}}); URLs soltas na CDN cobrem os
// results que só citam link. URL presigned (upload.higgsfield.ai) morre em
// 24h → thumb é CACHEADA em .data/assets no momento do index (Task 2).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE, DATA_DIR } from './config.mjs';
import { getSessionFile } from './sessions.mjs';
import {
  parseLines, isRealUserPrompt, rawUserText, clip,
} from './transcript-parse.mjs';
import { inferTopic } from './topics.mjs';

const GEN_TOOL_PREFIX = 'mcp__higgsfield__';
const CDN_RE = /https:\/\/(?:d8j0ntlcm91z4\.cloudfront\.net|cdn\.higgsfield\.ai|upload\.higgsfield\.ai)\/[^\s"'<>)\]}]+/g;
const ALLOWED_HOSTS = new Set(['d8j0ntlcm91z4.cloudfront.net', 'cdn.higgsfield.ai', 'upload.higgsfield.ai']);
const GEN_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(_min)?\.(png|webp|jpe?g|mp4)/i;

export function isAllowedAssetUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

// Thumb a baixar: imagem usa minUrl (fallback rawUrl); vídeo nunca baixa.
export function pickThumbUrl(gen) {
  if (!gen || gen.type === 'video') return null;
  return gen.thumb || gen.url || null;
}

// Boundary: URL de payload de transcript só entra como http(s) — esquema
// hostil (javascript:) viraria <a href> clicável no client.
function httpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '';
}

// Extrai um objeto JSON balanceado a partir do offset (ignora chaves em string).
function balancedJson(s, from) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < s.length; i += 1) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return s.slice(from, i + 1); }
  }
  return null;
}

// Payloads estruturados no texto do result: {"generation":{...}} (job_status)
// e {"results":[{...}]} (generate_*, vem sem URL — só id/model/prompt).
function parseGenPayloads(txt) {
  const out = [];
  for (const m of txt.matchAll(/\{"generation":\{/g)) {
    const blob = balancedJson(txt, m.index);
    if (!blob) continue;
    try {
      const o = JSON.parse(blob);
      if (o.generation && o.generation.id) out.push(o.generation);
    } catch { /* blob truncado: segue */ }
  }
  for (const m of txt.matchAll(/\{"results":\[\{/g)) {
    const blob = balancedJson(txt, m.index);
    if (!blob) continue;
    try {
      const o = JSON.parse(blob);
      if (Array.isArray(o.results)) out.push(...o.results.filter((r) => r && r.id));
    } catch { /* segue */ }
  }
  return out;
}

function resultText(el) {
  if (typeof el.content === 'string') return el.content;
  if (Array.isArray(el.content)) {
    return el.content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n');
  }
  return '';
}

function mergeGen(prev, g, ts) {
  const p = prev || { ts: 0 };
  return {
    id: g.id || p.id,
    ts: Math.max(p.ts || 0, ts),
    type: g.type || p.type || 'image',
    model: g.model || p.model || '',
    status: g.status || p.status || '',
    prompt: (g.params && g.params.prompt) || p.prompt || '',
    w: (g.params && g.params.width) || p.w || 0,
    h: (g.params && g.params.height) || p.h || 0,
    url: httpUrl(g.results && g.results.rawUrl) || p.url || '',
    thumb: httpUrl(g.results && g.results.minUrl) || p.thumb || '',
  };
}

// Gerações de um transcript parseado. PURO (check-assets.mjs).
// Anti-veneno: só tool_result cujo tool_use casado é mcp__higgsfield__*.
export function extractGens(objs) {
  const uses = new Map(); // tool_use_id -> name
  const gens = new Map(); // gen id -> Gen
  for (const o of Array.isArray(objs) ? objs : []) {
    const content = o && o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    const ts = Date.parse(o.timestamp || '') || 0;
    for (const el of content) {
      if (el && el.type === 'tool_use' && el.id && typeof el.name === 'string') {
        uses.set(el.id, el.name);
      } else if (el && el.type === 'tool_result' && el.tool_use_id) {
        const name = uses.get(el.tool_use_id) || '';
        if (!name.startsWith(GEN_TOOL_PREFIX)) continue;
        const txt = resultText(el);
        for (const g of parseGenPayloads(txt)) {
          gens.set(g.id, mergeGen(gens.get(g.id), g, ts));
        }
        for (const m of txt.matchAll(CDN_RE)) {
          const url = m[0].replace(/[.,;:')]+$/, '');
          const idm = url.match(GEN_ID_RE);
          if (!idm) continue;
          const gid = idm[1];
          const isThumb = Boolean(idm[2]);
          const isVideo = idm[3].toLowerCase() === 'mp4';
          const prev = gens.get(gid) || {
            id: gid, ts, type: isVideo ? 'video' : 'image', model: '', status: 'completed',
            prompt: '', w: 0, h: 0, url: '', thumb: '',
          };
          gens.set(gid, {
            ...prev,
            ts: Math.max(prev.ts || 0, ts),
            type: isVideo ? 'video' : prev.type,
            url: isThumb ? prev.url : (prev.url || url),
            thumb: isThumb ? url : prev.thumb,
            status: prev.status || 'completed',
          });
        }
      }
    }
  }
  return [...gens.values()]
    .filter((g) => g.url || g.thumb)
    .sort((a, b) => b.ts - a.ts);
}

// Contexto legivel de uma sessao a partir do transcript parseado: TOPICO
// (inferTopic sobre os primeiros prompts reais) + MISSAO (1o prompt clipado).
// Sessao que abre com /comando = 'rotina' da esteira (mesma regra do
// sessions.mjs). Resolve o "callsign opaco" da galeria. PURO (check-assets.mjs).
const META_PROMPTS = 5;
export function extractSessionMeta(objs) {
  const prompts = [];
  for (const o of Array.isArray(objs) ? objs : []) {
    if (!isRealUserPrompt(o)) continue;
    const raw = rawUserText(o.message);
    if (!raw) continue;
    if (prompts.length === 0 && raw.startsWith('/')) {
      return { topic: 'rotina', mission: clip(raw, 80) || raw.slice(0, 80) };
    }
    prompts.push(raw);
    if (prompts.length >= META_PROMPTS) break;
  }
  if (!prompts.length) return { topic: 'outros', mission: '' };
  return { topic: inferTopic(prompts.join(' ')), mission: clip(prompts[0], 90) || '' };
}

// ------------------------------------------------ rollup global + thumbs ----
const PROJECTS = path.join(CLAUDE, 'projects');
const CACHE_FILE = path.join(DATA_DIR, 'assets.json');
const THUMB_DIR = path.join(DATA_DIR, 'assets');
const MAX_INGEST = 8; // transcripts novos por request (backfill em fatias)
const MAX_SCAN_BYTES = 48 * 1024 * 1024;
const SAVE_MS = 10 * 1000;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const THUMB_TIMEOUT_MS = 8000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const MAX_GENS_OUT = 500;
const SESSION_ID_RE = /^[a-f0-9][a-f0-9-]{7,}$/i;
const THUMB_ID_RE = /^[0-9a-f-]{8,64}$/i;
const EXT_BY_MIME = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

const files = new Map(); // transcriptId -> { mtimeMs, size, gens: Gen[] }
let loaded = false;
let saveTimer = null;
let ingesting = false;
let backlog = 1; // >0 = ainda tem transcript não ingerido

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    if (raw && raw.v === 1 && raw.files && typeof raw.files === 'object') {
      for (const [id, rec] of Object.entries(raw.files)) {
        if (rec && Number.isFinite(rec.mtimeMs)) files.set(id, rec);
      }
    }
  } catch { /* primeiro boot */ }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist().catch((err) => console.error('[assets] save:', err.message));
  }, SAVE_MS);
  saveTimer.unref();
}

async function persist() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(CACHE_FILE, JSON.stringify({ v: 1, files: Object.fromEntries(files) }), 'utf8');
}

async function listTranscripts() {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(PROJECTS, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS, d.name);
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const f of entries) {
      if (f.isFile() && f.name.endsWith('.jsonl')) {
        out.push({ id: f.name.slice(0, -6), file: path.join(dir, f.name) });
      }
    }
  }
  return out;
}

function thumbPath(id, ext) {
  return path.join(THUMB_DIR, id + '.' + ext);
}

// Baixa a thumb UMA vez (best-effort; falha nunca quebra o index). Guarda
// gen.thumbExt no registro pra rota servir com o mime certo.
async function cacheThumb(gen) {
  if (!THUMB_ID_RE.test(String(gen && gen.id || ''))) return;
  if (!gen || gen.thumbExt) return;
  const src = pickThumbUrl(gen);
  if (!src || !isAllowedAssetUrl(src)) return;
  try {
    await fsp.mkdir(THUMB_DIR, { recursive: true });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), THUMB_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(src, { signal: ctrl.signal, redirect: 'error' });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return;
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim();
    const ext = EXT_BY_MIME[mime];
    if (!ext) return;
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > THUMB_MAX_BYTES) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > THUMB_MAX_BYTES) return;
    await fsp.writeFile(thumbPath(gen.id, ext), buf);
    gen.thumbExt = ext;
  } catch { /* offline/expirada: fica link-only */ }
}

// Uma fatia de ingest por request (padrão usage.mjs): stat em tudo, processa
// até MAX_INGEST mudados. backlog>0 => ready:false e a UI re-polla.
async function ingestSlice() {
  if (ingesting) return;
  ingesting = true;
  try {
    await loadCache();
    const all = await listTranscripts();
    let processed = 0;
    let pending = 0;
    for (const { id, file } of all) {
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      const rec = files.get(id);
      const unchanged = rec && rec.mtimeMs === st.mtimeMs && rec.size === st.size;
      // backfill de meta: sessao com midia mas sem contexto (cache antigo)
      // re-processa UMA vez, preservando thumbExt (nao re-baixa) — so quem
      // tem gens precisa de meta (sao as que aparecem na galeria).
      const needsMeta = unchanged && rec.gens && rec.gens.length > 0 && !rec.meta;
      if (unchanged && !needsMeta) continue;
      if (processed >= MAX_INGEST) { pending += 1; continue; }
      processed += 1;
      let gens = [];
      let meta = (rec && rec.meta) || null;
      if (st.size <= MAX_SCAN_BYTES) {
        try {
          const objs = parseLines(await fsp.readFile(file, 'utf8'));
          gens = extractGens(objs);
          if (gens.length > 0) meta = extractSessionMeta(objs);
        } catch (err) {
          console.error('[assets] scan', id, err.message);
        }
      }
      // preserva thumbExt já cacheado de runs anteriores
      const prevById = new Map(((rec && rec.gens) || []).map((g) => [g.id, g]));
      for (const g of gens) {
        const prev = prevById.get(g.id);
        if (prev && prev.thumbExt) g.thumbExt = prev.thumbExt;
      }
      files.set(id, { mtimeMs: st.mtimeMs, size: st.size, gens, meta });
      for (const g of gens) cacheThumb(g).then(scheduleSave).catch(() => {});
    }
    backlog = pending;
    if (processed > 0) scheduleSave();
  } finally {
    ingesting = false;
  }
}

function genOut(g, session) {
  return { ...g, session, local: g.thumbExt ? '/api/assets/thumb/' + g.id : null };
}

// ---------------------------------------------- por sessão (LRU, fresco) ----
const sessionCache = new Map(); // id -> { mtimeMs, size, gens }
const SESSION_CACHE_MAX = 8;

async function gensForSession(id) {
  const file = await getSessionFile(id);
  if (!file || !fs.existsSync(file)) return null;
  const st = await fsp.stat(file);
  const hit = sessionCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    sessionCache.delete(id);
    sessionCache.set(id, hit);
    return hit.gens;
  }
  // shortcut: readFile inteiro (padrão artifacts.mjs); cursor incremental se p95 > ~2s
  const text = await fsp.readFile(file, 'utf8');
  const gens = extractGens(parseLines(text));
  // reaproveita thumbExt do rollup global (mesmos ids)
  const global = files.get(id);
  if (global) {
    const byId = new Map(global.gens.map((g) => [g.id, g]));
    for (const g of gens) {
      const gg = byId.get(g.id);
      if (gg && gg.thumbExt) g.thumbExt = gg.thumbExt;
    }
  }
  sessionCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, gens });
  if (sessionCache.size > SESSION_CACHE_MAX) sessionCache.delete(sessionCache.keys().next().value);
  return gens;
}

// ---------------------------------------------------------------- rotas ----
function fail(res, err) {
  console.error('[assets]', err && err.message ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
}

export function register(app) {
  app.get('/api/assets', async (req, res) => {
    try {
      const sid = String(req.query.session || '').trim();
      if (sid) {
        if (!SESSION_ID_RE.test(sid)) return res.status(400).json({ error: 'session inválida' });
        const gens = await gensForSession(sid);
        if (gens === null) return res.status(404).json({ error: 'sessão não encontrada' });
        return res.json({ session: sid, count: gens.length, gens: gens.map((g) => genOut(g, sid)) });
      }
      await ingestSlice();
      const days = Math.max(1, Math.min(MAX_DAYS, Number(req.query.days) || DEFAULT_DAYS));
      const cutoff = Date.now() - days * 86400000;
      const out = [];
      for (const [id, rec] of files) {
        for (const g of rec.gens) if (g.ts >= cutoff) out.push(genOut(g, id));
      }
      out.sort((a, b) => b.ts - a.ts);
      // contexto por sessao (topico + missao) das que aparecem no output:
      // o cabecalho da galeria mostra o que a sessao fazia, nao um callsign opaco
      const sessions = {};
      for (const g of out) {
        if (sessions[g.session]) continue;
        const rec = files.get(g.session);
        if (rec && rec.meta) sessions[g.session] = { topic: rec.meta.topic, mission: rec.meta.mission };
      }
      res.json({
        ready: backlog === 0, days, count: out.length, gens: out.slice(0, MAX_GENS_OUT), sessions,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/assets/thumb/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!THUMB_ID_RE.test(id)) return res.status(400).json({ error: 'id inválido' });
      await loadCache();
      let found = null;
      for (const rec of files.values()) {
        const g = rec.gens.find((x) => x.id === id && x.thumbExt);
        if (g) { found = g; break; }
      }
      if (!found) return res.status(404).json({ error: 'thumb não cacheada' });
      const p = thumbPath(found.id, found.thumbExt);
      if (!p.startsWith(THUMB_DIR)) return res.status(403).json({ error: 'fora do cache' });
      res.set('Content-Type', 'image/' + (found.thumbExt === 'jpg' ? 'jpeg' : found.thumbExt));
      res.set('Cache-Control', 'public, max-age=86400');
      res.sendFile(p);
    } catch (err) {
      fail(res, err);
    }
  });
}
