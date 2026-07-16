// FAROL - modulo vault (ownership: agente A1).
// Rotas sobre o vault Obsidian: tree, note (GET e POST), resolve, graph,
// search, search semantica e asset. Cache de links/backlinks em memoria
// construido no boot e reconstruido por chokidar (debounce 2s); o cache
// guarda tambem o mtimeMs de cada nota, exposto nos nodes do /api/graph
// (global e local) para o brilho por recencia do universo (F3).
// Escrita SO via POST /api/note: guard de traversal, 409 por mtime e backup
// em torre/.backups (retencao 50) antes de gravar UTF-8 sem BOM.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import chokidar from 'chokidar';
import matter from 'gray-matter';
import { VAULT, CLAUDE } from './config.mjs';

const VAULT_ROOT = path.resolve(VAULT);
const SEMANTIC_QUERY = path.join(CLAUDE, 'scripts', 'vault', 'semantic', 'query.mjs');
const EXCLUDED = new Set(['.obsidian', '.claude', '.git', '.trash']);
const ARCHIVE = '4-Archive';
const PARA_GROUPS = [
  '0-Inbox', '1-Projects', '2-Areas', '3-Resources',
  '5-Atlas', '6-Daily', '7-Templates', '8-System',
];
const GLOBAL_CAP = 800;
const LOCAL_CAP = 500;
const SEARCH_LIMIT = 20;
const REINDEX_DEBOUNCE_MS = 2000;
const SEMANTIC_TIMEOUT_MS = 20000;
const SEMANTIC_K = 8;
const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf',
  '.mp3', '.mp4', '.wav', '.webm', '.ico',
]);
const WIKILINK_RE = /(!?)\[\[([^\[\]]+)\]\]/g;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', '.backups');
const BACKUP_KEEP = 50;
const NOTE_BODY_LIMIT = '8mb';
const MTIME_EPSILON_MS = 0.5;

// ---------------------------------------------------------------- indice ----

function emptyIndex() {
  return { notes: new Map(), byBase: new Map(), byRelLower: new Map() };
}

let index = emptyIndex();
let indexPromise = null;
let reindexTimer = null;
let started = false;

function ensureIndex() {
  if (!indexPromise) indexPromise = rebuildIndex().catch(logRebuildError);
  return indexPromise;
}

function logRebuildError(err) {
  console.error('[vault] falha ao indexar:', err.message);
}

async function rebuildIndex() {
  const t0 = Date.now();
  const rels = await listMdFiles(VAULT_ROOT, '', []);
  const next = emptyIndex();
  await scanNotes(rels, next);
  linkNotes(next);
  index = next;
  console.log(`[vault] indice pronto: ${rels.length} notas em ${Date.now() - t0}ms`);
}

async function listMdFiles(dirAbs, relDir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || EXCLUDED.has(e.name)) continue;
    const rel = relDir ? relDir + '/' + e.name : e.name;
    if (e.isDirectory()) await listMdFiles(path.join(dirAbs, e.name), rel, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(rel);
  }
  return out;
}

async function scanNotes(rels, idx) {
  for (const rel of rels) {
    const abs = path.join(VAULT_ROOT, rel);
    let raw;
    let st;
    try {
      raw = await fsp.readFile(abs, 'utf8');
      st = await fsp.stat(abs);
    } catch {
      continue;
    }
    const { data, content } = safeMatter(raw);
    const title =
      (data && typeof data.title === 'string' && data.title.trim()) ||
      path.basename(rel).replace(/\.md$/i, '');
    idx.notes.set(rel, {
      title,
      // frontmatter guardado p/ avaliar .base em memoria (sem reler disco). Path 1 / Fase B.
      data: data && typeof data === 'object' ? data : {},
      tags: collectTags(data, content),
      archived: rel.startsWith(ARCHIVE + '/'),
      // mtime vive no indice para o graph nao pagar stat por request (F3).
      mtimeMs: st.mtimeMs,
      targets: extractLinks(content),
      out: [],
      backlinks: new Set(),
    });
    idx.byRelLower.set(rel.toLowerCase(), rel);
    registerBase(idx, rel);
  }
}

function registerBase(idx, rel) {
  const base = path.basename(rel).replace(/\.md$/i, '').toLowerCase();
  const current = idx.byBase.get(base);
  if (!current) {
    idx.byBase.set(base, rel);
    return;
  }
  // Preferir nota fora do 4-Archive quando o basename colide.
  if (current.startsWith(ARCHIVE + '/') && !rel.startsWith(ARCHIVE + '/')) {
    idx.byBase.set(base, rel);
  }
}

function linkNotes(idx) {
  for (const [rel, note] of idx.notes) {
    for (const target of note.targets) {
      const resolved = resolveTarget(idx, target);
      note.out.push({ name: target, path: resolved });
      if (resolved && resolved !== rel) {
        idx.notes.get(resolved).backlinks.add(rel);
      }
    }
    note.targets = null;
  }
}

function extractLinks(body) {
  const out = [];
  const seen = new Set();
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[2].split('|')[0].split('#')[0].trim();
    if (!target || seen.has(target)) continue;
    const ext = path.extname(target).toLowerCase();
    if (ext && ext !== '.md') continue; // embed de asset nao entra em links
    seen.add(target);
    out.push(target);
  }
  return out;
}

function resolveTarget(idx, target) {
  const clean = String(target).replace(/\\/g, '/').replace(/^\/+/, '');
  const lower = clean.toLowerCase();
  if (lower.includes('/')) {
    const withMd = lower.endsWith('.md') ? lower : lower + '.md';
    const byPath = idx.byRelLower.get(withMd);
    if (byPath) return byPath;
  }
  const base = (lower.endsWith('.md') ? lower.slice(0, -3) : lower).split('/').pop();
  return idx.byBase.get(base) || null;
}

function safeMatter(raw) {
  try {
    return matter(raw);
  } catch {
    return { data: {}, content: raw };
  }
}

// Tags da nota: frontmatter (array ou string) + inline #tag do corpo. Lowercase,
// sem '#'. Usado pelo leitor .base (file.hasTag).
function collectTags(data, content) {
  const set = new Set();
  const add = (t) => { const c = String(t).replace(/^#/, '').trim().toLowerCase(); if (c) set.add(c); };
  const fm = data && data.tags;
  if (Array.isArray(fm)) fm.forEach(add);
  else if (typeof fm === 'string') fm.split(/[,\s]+/).filter(Boolean).forEach(add);
  const re = /(?:^|\s)#([A-Za-z0-9_][\w/-]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) add(m[1]);
  return set;
}

// --------------------------------------------------------------- watcher ----

function startWatcher() {
  const watcher = chokidar.watch(VAULT_ROOT, {
    ignoreInitial: true,
    ignored: shouldIgnoreWatch,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });
  watcher.on('all', (event, file) => {
    if (!String(file).toLowerCase().endsWith('.md')) return;
    scheduleReindex();
  });
  watcher.on('error', (err) => console.error('[vault] watcher:', err.message));
}

function shouldIgnoreWatch(p) {
  const rel = path.relative(VAULT_ROOT, String(p));
  if (rel.startsWith('..')) return true;
  return rel.split(path.sep).some((seg) => seg.startsWith('.') || EXCLUDED.has(seg));
}

// Assinantes de mudanca do vault (index.mjs faz virar SSE type 'vault' —
// e o que permite o front refetchar o grafo ao vivo). Notifica DEPOIS do
// reindex terminar: quando o client refetchar, /api/graph ja esta fresco.
// So o watcher notifica; o build inicial do boot fica silencioso.
const changeSubs = new Set();

export function onVaultChange(fn) {
  if (typeof fn === 'function') changeSubs.add(fn);
}

function notifyVaultChange() {
  for (const fn of changeSubs) {
    try { fn(); } catch { /* assinante nao derruba o reindex */ }
  }
}

function scheduleReindex() {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    reindexTimer = null;
    indexPromise = rebuildIndex()
      .then(() => { notifyVaultChange(); })
      .catch(logRebuildError);
  }, REINDEX_DEBOUNCE_MS);
}

// --------------------------------------------------------------- helpers ----

function normalizeRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function lookupRel(rel) {
  if (index.notes.has(rel)) return rel;
  return index.byRelLower.get(rel.toLowerCase()) || rel;
}

function noteTitle(rel) {
  const note = index.notes.get(rel);
  return note ? note.title : path.basename(rel).replace(/\.md$/i, '');
}

// Guard de path traversal: resolve e exige prefixo do vault.
function resolveInsideVault(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const cleaned = normalizeRel(rel);
  if (!cleaned || path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) return null;
  const abs = path.resolve(VAULT_ROOT, cleaned);
  if (abs !== VAULT_ROOT && !abs.startsWith(VAULT_ROOT + path.sep)) return null;
  return abs;
}

function topGroup(rel) {
  return rel.includes('/') ? rel.split('/')[0] : 'root';
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// ------------------------------------------------------------------ tree ----

async function buildTree(absDir, relDir) {
  const entries = await fsp.readdir(absDir, { withFileTypes: true });
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || EXCLUDED.has(e.name)) continue;
    const rel = relDir ? relDir + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (!relDir && e.name === ARCHIVE) {
        dirs.push({ name: e.name, path: rel, type: 'dir', archived: true, children: [] });
        continue;
      }
      dirs.push(await buildTree(path.join(absDir, e.name), rel));
    } else {
      files.push({ name: e.name, path: rel, type: 'file' });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  dirs.sort(byName);
  files.sort(byName);
  return {
    name: relDir ? path.basename(relDir) : 'Obsidian Vault',
    path: relDir,
    type: 'dir',
    children: [...dirs, ...files],
  };
}

// ------------------------------------------------------------------ note ----

async function handleNote(req, res) {
  const relRaw = String(req.query.path || '');
  const abs = resolveInsideVault(relRaw);
  if (!abs || !abs.toLowerCase().endsWith('.md')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  let raw;
  let st;
  try {
    raw = await fsp.readFile(abs, 'utf8');
    st = await fsp.stat(abs);
  } catch {
    return res.status(404).json({ error: 'nota nao encontrada' });
  }
  const { data, content } = safeMatter(raw);
  await ensureIndex();
  const rel = lookupRel(normalizeRel(relRaw));
  const entry = index.notes.get(rel);
  const links = entry
    ? entry.out
    : extractLinks(content).map((t) => ({ name: t, path: resolveTarget(index, t) }));
  const backlinks = entry
    ? [...entry.backlinks].map((src) => ({ title: noteTitle(src), path: src }))
    : [];
  res.json({
    path: rel,
    frontmatter: data || {},
    markdown: content,
    links,
    backlinks,
    mtimeMs: st.mtimeMs,
  });
}

// ------------------------------------------------------------ note write ----

async function handleNoteWrite(req, res) {
  const body = req.body || {};
  const abs = resolveInsideVault(String(body.path || ''));
  if (!abs || !abs.toLowerCase().endsWith('.md')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  if (typeof body.markdown !== 'string') {
    return res.status(400).json({ error: 'markdown obrigatorio' });
  }
  const base = Number(body.baseMtimeMs);
  if (!Number.isFinite(base)) {
    return res.status(400).json({ error: 'baseMtimeMs obrigatorio' });
  }
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return res.status(404).json({ error: 'nota nao encontrada' });
  }
  if (Math.abs(st.mtimeMs - base) > MTIME_EPSILON_MS) {
    return res.status(409).json({ error: 'conflito', currentMtimeMs: st.mtimeMs });
  }
  await backupNote(abs);
  // UTF-8 sem BOM: Node nao escreve BOM e o que vier do cliente e removido.
  const hasBom = body.markdown.charCodeAt(0) === 0xfeff;
  const clean = hasBom ? body.markdown.slice(1) : body.markdown;
  await fsp.writeFile(abs, clean, 'utf8');
  const after = await fsp.stat(abs);
  res.json({ ok: true, mtimeMs: after.mtimeMs });
}

async function backupNote(abs) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `${stamp}-${path.basename(abs)}`);
  await fsp.copyFile(abs, dest);
  await pruneBackups();
}

async function pruneBackups() {
  let names = [];
  try {
    names = await fsp.readdir(BACKUP_DIR);
  } catch {
    return;
  }
  // Prefixo ISO no nome ordena lexicograficamente = cronologicamente.
  const mds = names.filter((n) => n.toLowerCase().endsWith('.md')).sort();
  const excess = mds.length - BACKUP_KEEP;
  for (let i = 0; i < excess; i++) {
    await fsp.unlink(path.join(BACKUP_DIR, mds[i])).catch(() => {});
  }
}

// ----------------------------------------------------------------- graph ----

function buildGlobalGraph() {
  const budget = Math.max(0, GLOBAL_CAP - 1 - PARA_GROUPS.length);
  // Score = conexoes + boost de recencia: nota mexida nas ultimas 48h SEMPRE entra
  // (e o alvo das sondas do modo TORRE — sem ela o voo degrada pra chip).
  const now = Date.now();
  const ranked = [...index.notes.entries()]
    .filter(([, n]) => !n.archived)
    .map(([rel, n]) => {
      const ageH = n.mtimeMs ? (now - n.mtimeMs) / 3600000 : 9999;
      const recency = ageH < 48 ? 1000 : ageH < 24 * 14 ? 3 : 0;
      return { rel, n, bl: n.backlinks.size, score: n.backlinks.size + n.out.length * 0.5 + recency };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, budget);
  const nodes = [{ id: 'VAULT', label: 'VAULT', group: 'vault', size: 12, archived: false }];
  for (const g of PARA_GROUPS) {
    nodes.push({ id: g, label: g, group: g, size: 8, archived: false });
  }
  for (const { rel, n, bl } of ranked) {
    nodes.push({
      id: rel,
      label: n.title,
      group: topGroup(rel),
      size: round2(1 + Math.log(1 + bl)),
      archived: false,
      mtimeMs: n.mtimeMs || null,
    });
  }
  return { nodes, links: globalLinks(ranked) };
}

function globalLinks(ranked) {
  const selected = new Set(ranked.map((r) => r.rel));
  const links = PARA_GROUPS.map((g) => ({ source: 'VAULT', target: g }));
  const seen = new Set();
  for (const { rel, n } of ranked) {
    const group = topGroup(rel);
    links.push({ source: PARA_GROUPS.includes(group) ? group : 'VAULT', target: rel });
    for (const o of n.out) {
      if (!o.path || o.path === rel || !selected.has(o.path)) continue;
      const key = rel + '->' + o.path;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: rel, target: o.path });
    }
  }
  return links;
}

function neighborsOf(rel) {
  const note = index.notes.get(rel);
  if (!note) return [];
  const out = note.out.filter((o) => o.path && o.path !== rel).map((o) => o.path);
  return [...new Set([...out, ...note.backlinks])];
}

function buildLocalGraph(startRel, depth) {
  const dist = new Map([[startRel, 0]]);
  let frontier = [startRel];
  for (let d = 1; d <= depth && dist.size < LOCAL_CAP; d++) {
    const next = [];
    for (const rel of frontier) {
      for (const nb of neighborsOf(rel)) {
        if (dist.has(nb)) continue;
        dist.set(nb, d);
        next.push(nb);
        if (dist.size >= LOCAL_CAP) break;
      }
      if (dist.size >= LOCAL_CAP) break;
    }
    frontier = next;
  }
  const nodes = [...dist.keys()].map((rel) => localNode(rel, rel === startRel));
  return { nodes, links: localLinks(dist) };
}

function localNode(rel, isCenter) {
  const note = index.notes.get(rel);
  const bl = note ? note.backlinks.size : 0;
  return {
    id: rel,
    label: noteTitle(rel),
    group: topGroup(rel),
    size: round2((isCenter ? 4 : 1) + Math.log(1 + bl)),
    archived: rel.startsWith(ARCHIVE + '/'),
    mtimeMs: note ? note.mtimeMs || null : null,
  };
}

function localLinks(dist) {
  const links = [];
  const seen = new Set();
  for (const rel of dist.keys()) {
    const note = index.notes.get(rel);
    if (!note) continue;
    for (const o of note.out) {
      if (!o.path || o.path === rel || !dist.has(o.path)) continue;
      const key = rel + '->' + o.path;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: rel, target: o.path });
    }
  }
  return links;
}

async function handleGraph(req, res) {
  await ensureIndex();
  const scope = String(req.query.scope || 'global');
  if (scope === 'global') return res.json(buildGlobalGraph());
  if (scope !== 'local') return res.status(400).json({ error: 'scope invalido' });
  const rel = lookupRel(normalizeRel(String(req.query.path || '')));
  if (!rel || !index.notes.has(rel)) {
    return res.status(404).json({ error: 'nota nao encontrada no indice' });
  }
  const depth = Math.min(3, Math.max(1, parseInt(req.query.depth, 10) || 2));
  res.json(buildLocalGraph(rel, depth));
}

// ---------------------------------------------------------------- search ----

function scoreMatch(ql, tokens, title, rel) {
  let score = 0;
  const ti = title.indexOf(ql);
  if (ti === 0) score = 100;
  else if (ti > 0) score = 70 - Math.min(ti, 40);
  if (tokens.length > 1 && tokens.every((t) => title.includes(t))) {
    score = Math.max(score, 60);
  }
  const pi = rel.indexOf(ql);
  if (pi >= 0) score = Math.max(score, 45 - Math.min(Math.floor(pi / 4), 25));
  return score;
}

function searchNotes(q) {
  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const [rel, note] of index.notes) {
    const score = scoreMatch(ql, tokens, note.title.toLowerCase(), rel.toLowerCase());
    if (score > 0) hits.push({ title: note.title, path: rel, score });
  }
  hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return hits.slice(0, SEARCH_LIMIT);
}

// ------------------------------------------------------ search semantica ----

function semanticSearch(q) {
  return new Promise((resolve) => {
    // Sanitizar mesmo com array args (defesa em profundidade).
    const clean = q.replace(/["'`;|&<>$\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return resolve([]);
    execFile(
      process.execPath,
      [SEMANTIC_QUERY, clean, '-k', String(SEMANTIC_K), '--json'],
      { timeout: SEMANTIC_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error('[vault] semantic falhou:', err.message);
          return resolve([]);
        }
        resolve(parseSemantic(stdout));
      }
    );
  });
}

function parseSemantic(stdout) {
  try {
    const rows = JSON.parse(stdout);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({ ...r, vaultPath: toVaultRel(r.path) }));
  } catch {
    return [];
  }
}

function toVaultRel(p) {
  if (typeof p !== 'string') return null;
  const abs = path.resolve(p);
  if (!abs.startsWith(VAULT_ROOT + path.sep)) return null;
  return path.relative(VAULT_ROOT, abs).replace(/\\/g, '/');
}

// ----------------------------------------------------------------- asset ----

function handleAsset(req, res) {
  const abs = resolveInsideVault(String(req.query.path || ''));
  if (!abs) return res.status(400).json({ error: 'path invalido' });
  const ext = path.extname(abs).toLowerCase();
  if (!ASSET_EXT.has(ext)) return res.status(415).json({ error: 'extensao nao suportada' });
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return res.status(404).json({ error: 'asset nao encontrado' });
  }
  if (!st.isFile()) return res.status(404).json({ error: 'asset nao encontrado' });
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'falha ao servir asset' });
  });
}

// ------------------------------------------------------------------ crud ----
// Path 1: criar / renomear / mover / excluir notas e pastas pela UI da Torre,
// pra aposentar o Obsidian. Markdown continua canonico. Invariantes:
//  - nunca sobrescreve (create usa flag 'wx'; rename exige destino livre = 409);
//  - nunca hard-delete (soft pra torre/.trash, fora do vault, nao reindexa/sync);
//  - backup antes de toda escrita destrutiva; o watcher chokidar reindexa sozinho.

const TRASH_DIR = path.resolve(__dirname, '..', '.trash');

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// rel ja normalizado: recusa segmento oculto (.obsidian/.git/...) ou de sistema.
function relSegmentsSafe(rel) {
  return rel.length > 0 && rel.split('/').every((seg) => seg && !seg.startsWith('.') && !EXCLUDED.has(seg));
}

function resolveMdInside(relRaw) {
  const cleaned = normalizeRel(String(relRaw || ''));
  const abs = resolveInsideVault(cleaned);
  if (!abs || !abs.toLowerCase().endsWith('.md') || !relSegmentsSafe(cleaned)) return null;
  return { abs, rel: cleaned };
}

async function pathExists(abs) {
  try { await fsp.access(abs); return true; } catch { return false; }
}

async function moveFile(fromAbs, toAbs) {
  try {
    await fsp.rename(fromAbs, toAbs);
  } catch (err) {
    // cross-device (vault e .trash podem estar em volumes diferentes): copia + apaga.
    if (err.code === 'EXDEV') {
      await fsp.copyFile(fromAbs, toAbs);
      await fsp.unlink(fromAbs);
    } else {
      throw err;
    }
  }
}

// Remove dirs vazios recem-criados, do dir dado ate (sem incluir) o vault root.
async function cleanupEmptyDirs(dirAbs) {
  let cur = dirAbs;
  while (cur !== VAULT_ROOT && cur.startsWith(VAULT_ROOT + path.sep)) {
    try {
      const entries = await fsp.readdir(cur);
      if (entries.length) break;
      await fsp.rmdir(cur);
      cur = path.dirname(cur);
    } catch {
      break;
    }
  }
}

function relNoExt(rel) {
  return rel.replace(/\.md$/i, '');
}

// ---- create ----------------------------------------------------------------
async function handleNoteCreate(req, res) {
  const body = req.body || {};
  const target = resolveMdInside(body.path);
  if (!target) return res.status(400).json({ error: 'path invalido' });
  const content = typeof body.content === 'string'
    ? stripBom(body.content)
    : `# ${path.basename(target.rel).replace(/\.md$/i, '')}\n\n`;
  await fsp.mkdir(path.dirname(target.abs), { recursive: true });
  try {
    // 'wx': cria ou falha. Mata o TOCTOU entre stat-e-grava (nunca sobrescreve).
    await fsp.writeFile(target.abs, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') return res.status(409).json({ error: 'ja existe', path: target.rel });
    await cleanupEmptyDirs(path.dirname(target.abs));
    throw err;
  }
  const st = await fsp.stat(target.abs);
  scheduleReindex();
  return res.status(201).json({ ok: true, path: target.rel, mtimeMs: st.mtimeMs });
}

// ---- rename / move ----------------------------------------------------------
// Move atomico primeiro (nota fica SEGURA no destino); rewrite de links inbound
// e best-effort, cada arquivo com backup, e o resultado e relatado (updated/failed) —
// nada silencioso. Pior caso = link [[antigo]] pendente (igual a nao reescrever),
// nunca perda de conteudo.
async function handleNoteRename(req, res) {
  const body = req.body || {};
  const src = resolveMdInside(body.from);
  const dst = resolveMdInside(body.to);
  if (!src || !dst) return res.status(400).json({ error: 'from/to invalidos' });
  if (src.rel === dst.rel) return res.status(400).json({ error: 'from == to' });
  if (!(await pathExists(src.abs))) return res.status(404).json({ error: 'origem nao encontrada' });
  if (await pathExists(dst.abs)) return res.status(409).json({ error: 'destino ja existe', path: dst.rel });

  await ensureIndex();
  const canonical = lookupRel(src.rel);
  const backlinkSrcs = [...(index.notes.get(canonical)?.backlinks || [])];
  const newRef = newRefFor(dst.rel, canonical);

  await backupNote(src.abs);
  await fsp.mkdir(path.dirname(dst.abs), { recursive: true });
  await moveFile(src.abs, dst.abs);
  scheduleReindex();

  const links = body.rewriteLinks === false
    ? { skipped: true }
    : await rewriteInboundLinks(backlinkSrcs, src.rel, dst.rel, newRef);
  return res.json({ ok: true, path: dst.rel, links });
}

// Escolhe a forma do novo link: basename se unico, senao path completo (anti-ambiguidade).
function newRefFor(toRel, fromRel) {
  const newBase = path.basename(toRel).replace(/\.md$/i, '');
  const existing = index.byBase.get(newBase.toLowerCase());
  if (existing && existing !== fromRel && relNoExt(existing).toLowerCase() !== relNoExt(toRel).toLowerCase()) {
    return relNoExt(toRel);
  }
  return newBase;
}

async function rewriteInboundLinks(srcRels, fromRel, toRel, newRef) {
  const oldBase = path.basename(fromRel).replace(/\.md$/i, '').toLowerCase();
  const oldPath = relNoExt(fromRel).toLowerCase();
  const updated = [];
  const failed = [];
  for (const srcRel of srcRels) {
    const abs = resolveInsideVault(srcRel);
    if (!abs) { failed.push({ path: srcRel, error: 'path invalido' }); continue; }
    try {
      const raw = await fsp.readFile(abs, 'utf8');
      const next = replaceWikilinkTarget(raw, oldBase, oldPath, newRef);
      if (next === raw) continue;
      await backupNote(abs);
      await fsp.writeFile(abs, stripBom(next), 'utf8');
      updated.push(srcRel);
    } catch (err) {
      failed.push({ path: srcRel, error: err.message });
    }
  }
  if (updated.length) scheduleReindex();
  return { updated: updated.length, failed };
}

// Reescreve so o ALVO do wikilink, preservando #heading e |alias e o embed (!).
function replaceWikilinkTarget(raw, oldBase, oldPath, newRef) {
  return raw.replace(/(!?)\[\[([^\[\]]+)\]\]/g, (full, bang, inner) => {
    const pipe = inner.indexOf('|');
    const alias = pipe >= 0 ? inner.slice(pipe) : '';
    const core = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const hash = core.indexOf('#');
    const heading = hash >= 0 ? core.slice(hash) : '';
    const target = (hash >= 0 ? core.slice(0, hash) : core).trim();
    const tnorm = target.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();
    if (tnorm === oldBase || tnorm === oldPath) {
      return `${bang}[[${newRef}${heading}${alias}]]`;
    }
    return full;
  });
}

// ---- delete (soft) ----------------------------------------------------------
async function handleNoteDelete(req, res) {
  const body = req.body || {};
  const src = resolveMdInside(body.path);
  if (!src) return res.status(400).json({ error: 'path invalido' });
  if (!(await pathExists(src.abs))) return res.status(404).json({ error: 'nota nao encontrada' });
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  // stamp com ms + rel achatado: dois foo.md de pastas diferentes nao colidem.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const flat = src.rel.replace(/[\\/]/g, '__');
  const dest = path.join(TRASH_DIR, `${stamp}-${flat}`);
  await moveFile(src.abs, dest);
  scheduleReindex();
  return res.json({ ok: true, trashed: path.basename(dest) });
}

// ---- folder create ----------------------------------------------------------
async function handleFolderCreate(req, res) {
  const body = req.body || {};
  const cleaned = normalizeRel(String(body.path || ''));
  const abs = resolveInsideVault(cleaned);
  if (!abs || !relSegmentsSafe(cleaned) || abs.toLowerCase().endsWith('.md')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  const existed = await pathExists(abs);
  await fsp.mkdir(abs, { recursive: true });
  return res.status(existed ? 200 : 201).json({ ok: true, path: cleaned, created: !existed });
}

// Pastas-raiz (depth 1 = grupos PARA) sao estruturais: nao renomeia/exclui.
function isProtectedDir(rel) {
  return !rel.includes('/');
}

async function moveDir(fromAbs, toAbs) {
  try {
    await fsp.rename(fromAbs, toAbs);
    return;
  } catch (err) {
    // No Windows/OneDrive o chokidar segura handle e o rename de DIR da EPERM/EBUSY;
    // cross-device da EXDEV. Em todos esses cai pra copia + remocao com retries.
    if (!['EXDEV', 'EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(err.code)) throw err;
  }
  await fsp.cp(fromAbs, toAbs, { recursive: true });
  await fsp.rm(fromAbs, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

// ---- folder rename / move ---------------------------------------------------
async function handleFolderRename(req, res) {
  const body = req.body || {};
  const fromRel = normalizeRel(String(body.from || ''));
  const toRel = normalizeRel(String(body.to || ''));
  const fromAbs = resolveInsideVault(fromRel);
  const toAbs = resolveInsideVault(toRel);
  if (!fromAbs || !toAbs || !relSegmentsSafe(fromRel) || !relSegmentsSafe(toRel)
      || fromAbs.toLowerCase().endsWith('.md') || toAbs.toLowerCase().endsWith('.md')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  if (fromRel === toRel) return res.status(400).json({ error: 'from == to' });
  if (isProtectedDir(fromRel)) return res.status(403).json({ error: 'pasta-raiz protegida' });
  if (toRel.startsWith(fromRel + '/')) return res.status(400).json({ error: 'destino dentro da origem' });
  let st;
  try { st = await fsp.stat(fromAbs); } catch { return res.status(404).json({ error: 'pasta nao encontrada' }); }
  if (!st.isDirectory()) return res.status(400).json({ error: 'nao e pasta' });
  if (await pathExists(toAbs)) return res.status(409).json({ error: 'destino ja existe', path: toRel });
  await ensureIndex();
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await moveDir(fromAbs, toAbs);
  scheduleReindex();
  const links = body.rewriteLinks === false ? { skipped: true } : await rewriteFolderLinks(fromRel, toRel);
  return res.json({ ok: true, path: toRel, links });
}

// Reescreve links path-qualified [[from/...]] -> [[to/...]] (basename-links ja
// resolvem sozinhos). Pre-filtro por string evita reler o vault inteiro a toa.
async function rewriteFolderLinks(fromRel, toRel) {
  const fromPrefix = (fromRel + '/').toLowerCase();
  const updated = [];
  const failed = [];
  // Varre o disco ATUAL (pos-move): o indice ainda tem os paths antigos ate
  // reindexar, entao iterar ele leria arquivos que ja mudaram de lugar.
  const rels = await listMdFiles(VAULT_ROOT, '', []);
  for (const rel of rels) {
    const abs = resolveInsideVault(rel);
    if (!abs) continue;
    try {
      const raw = await fsp.readFile(abs, 'utf8');
      if (!raw.includes('[[') || !raw.toLowerCase().includes(fromPrefix)) continue;
      const next = raw.replace(/(!?)\[\[([^\[\]]+)\]\]/g, (full, bang, inner) => {
        const pipe = inner.indexOf('|');
        const alias = pipe >= 0 ? inner.slice(pipe) : '';
        const core = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const hash = core.indexOf('#');
        const heading = hash >= 0 ? core.slice(hash) : '';
        const target = (hash >= 0 ? core.slice(0, hash) : core).trim().replace(/\\/g, '/').replace(/^\/+/, '');
        if (target.toLowerCase().startsWith(fromPrefix)) {
          return `${bang}[[${toRel}/${target.slice(fromRel.length + 1)}${heading}${alias}]]`;
        }
        return full;
      });
      if (next === raw) continue;
      await backupNote(abs);
      await fsp.writeFile(abs, stripBom(next), 'utf8');
      updated.push(rel);
    } catch (err) {
      failed.push({ path: rel, error: err.message });
    }
  }
  if (updated.length) scheduleReindex();
  return { updated: updated.length, failed };
}

// ---- folder delete (soft) ---------------------------------------------------
async function handleFolderDelete(req, res) {
  const body = req.body || {};
  const rel = normalizeRel(String(body.path || ''));
  const abs = resolveInsideVault(rel);
  if (!abs || !relSegmentsSafe(rel) || abs.toLowerCase().endsWith('.md')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  if (isProtectedDir(rel)) return res.status(403).json({ error: 'pasta-raiz protegida' });
  let st;
  try { st = await fsp.stat(abs); } catch { return res.status(404).json({ error: 'pasta nao encontrada' }); }
  if (!st.isDirectory()) return res.status(400).json({ error: 'nao e pasta' });
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(TRASH_DIR, `${stamp}-${rel.replace(/[\\/]/g, '__')}`);
  await moveDir(abs, dest);
  scheduleReindex();
  return res.json({ ok: true, trashed: path.basename(dest) });
}

// ---- canvas (JSON Canvas, read-only) ----------------------------------------
const CANVAS_MAX_BYTES = 4 * 1024 * 1024;

async function handleCanvas(req, res) {
  const rel = normalizeRel(String(req.query.path || ''));
  const abs = resolveInsideVault(rel);
  if (!abs || !relSegmentsSafe(rel) || !abs.toLowerCase().endsWith('.canvas')) {
    return res.status(400).json({ error: 'path invalido' });
  }
  let st;
  try { st = await fsp.stat(abs); } catch { return res.status(404).json({ error: 'canvas nao encontrado' }); }
  if (st.size > CANVAS_MAX_BYTES) return res.status(413).json({ error: 'canvas grande demais' });
  let data;
  try { data = JSON.parse(await fsp.readFile(abs, 'utf8')); } catch (err) {
    return res.status(422).json({ error: 'json invalido: ' + err.message });
  }
  res.json({
    path: rel,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
  });
}

// -------------------------------------------------------------- registro ----

function safeRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[vault]', req.path, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };
}

export function register(app) {
  if (!started) {
    started = true;
    ensureIndex();
    startWatcher();
  }
  app.get('/api/tree', safeRoute(async (req, res) => res.json(await buildTree(VAULT_ROOT, ''))));
  app.get('/api/note', safeRoute(handleNote));
  app.post('/api/note', express.json({ limit: NOTE_BODY_LIMIT }), safeRoute(handleNoteWrite));
  app.get('/api/resolve', safeRoute(handleResolve));
  app.get('/api/graph', safeRoute(handleGraph));
  app.get('/api/search', safeRoute(handleSearch));
  app.get('/api/search/semantic', safeRoute(handleSemanticSearch));
  app.get('/api/asset', safeRoute(handleAsset));
  // CRUD (Path 1) — todas via JSON; guards em resolveMdInside / resolveInsideVault.
  app.post('/api/note/create', express.json({ limit: NOTE_BODY_LIMIT }), safeRoute(handleNoteCreate));
  app.post('/api/note/rename', express.json(), safeRoute(handleNoteRename));
  app.post('/api/note/delete', express.json(), safeRoute(handleNoteDelete));
  app.post('/api/folder/create', express.json(), safeRoute(handleFolderCreate));
  app.post('/api/folder/rename', express.json(), safeRoute(handleFolderRename));
  app.post('/api/folder/delete', express.json(), safeRoute(handleFolderDelete));
  app.get('/api/canvas', safeRoute(handleCanvas));
}

async function handleResolve(req, res) {
  await ensureIndex();
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name obrigatorio' });
  res.json({ name, path: resolveTarget(index, name) });
}

async function handleSearch(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  await ensureIndex();
  res.json(searchNotes(q));
}

async function handleSemanticSearch(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(await semanticSearch(q));
}

// ----------------------------------------------------------- exports api ----

// Snapshot do indice p/ o leitor .base (server/bases.mjs): em memoria, sem reler
// disco. tags vira array; data = frontmatter ja parseado.
export async function notesSnapshot() {
  await ensureIndex();
  const out = [];
  for (const [rel, n] of index.notes) {
    out.push({ rel, title: n.title, data: n.data, tags: [...n.tags], mtimeMs: n.mtimeMs, archived: n.archived });
  }
  return out;
}

// Guard publico reutilizavel: traversal + segmentos seguros + extensao opcional.
export function safePath(relRaw, ext) {
  const cleaned = normalizeRel(String(relRaw || ''));
  const abs = resolveInsideVault(cleaned);
  if (!abs || !relSegmentsSafe(cleaned)) return null;
  if (ext && !abs.toLowerCase().endsWith(ext)) return null;
  return { abs, rel: cleaned };
}

export { VAULT_ROOT };
