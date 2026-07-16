// FAROL - modulo visor (o "olho da IA", historico). Read-only sobre o jsonl
// da sessao: imagem no transcript vem de DOIS jeitos — screenshot de tool
// (tool_result -> content[].source.data, casado por tool_use_id) OU imagem que
// o USUARIO colou no prompt (image top-level em message.content, SEM
// tool_use_id; o marcador "[Image: source: image-cache...]" fica numa linha
// irma so-texto). Aqui NAO decodificamos os blobs gigantes na indexacao:
// varremos linha a linha guardando so o OFFSET de byte de cada linha-de-imagem
// (regex barata p/ tool_use_id/media_type/timestamp); o binario so e lido/
// decodificado sob demanda pela rota /frame (ranged read de UMA linha). Indice
// cacheado por mtime+size (LRU curto). Cap dos 40 frames mais recentes. Toda
// rota erra => {error} 500/4xx, nunca derruba o server.

import fsp from 'node:fs/promises';
import { getSessionFile, describeAction } from './sessions.mjs';

const SESSION_ID_RE = /^[\w-]+$/;
const MAX_FRAMES = 40;
const CACHE_MAX = 8; // sessoes com indice em cache; alem disso evicta a mais antiga
const NL = 0x0a;
const FRAME_TTL = 'public, max-age=3600'; // frame historico e imutavel
const IMG_MARK = '"type":"image"';
const TOOL_MARK = '"type":"tool_use"';

// id -> { mtimeMs, size, frames:[{ idx, ts, toolUseId, mime, tool, target, verb, start, end }] }
const cache = new Map();

// ------------------------------------------------------------- indexacao ----

// Verbo curto PT-BR pra legenda do frame (linguagem do mock validado).
function verbFor(tool) {
  const t = String(tool || '');
  if (t === 'Read') return 'leu imagem';
  if (t.startsWith('mcp__claude-in-chrome')) return 'navegou (Chrome)';
  if (t.startsWith('mcp__playwright')) return 'screenshot (Playwright)';
  if (t === 'mcp__windows-mcp__Screenshot') return 'capturou a tela';
  if (t === 'mcp__windows-mcp__Snapshot') return 'snapshot da janela';
  if (t.startsWith('mcp__lovable')) return 'preview Lovable';
  if (t.startsWith('mcp__')) return 'consultou MCP';
  return t || 'capturou';
}

// Uma linha crua do jsonl. Linha pequena de tool_use => registra id->tool no
// mapa; linha de imagem (grande) => extrai metadados por regex SEM alocar/
// parsear o blob, guardando o offset de byte pra leitura posterior.
function handleLine(line, start, end, toolUse, found) {
  if (line.indexOf(IMG_MARK) === -1) {
    if (line.indexOf(TOOL_MARK) === -1) return;
    let obj;
    try { obj = JSON.parse(line); } catch { return; }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) return;
    for (const p of content) {
      if (p && p.type === 'tool_use' && p.id) {
        toolUse.set(p.id, { name: p.name || '', input: p.input || {} });
      }
    }
    return;
  }
  const mimeM = line.match(/"media_type"\s*:\s*"(image\/[a-z0-9.+-]+)"/i);
  if (!mimeM) return; // "type":"image" solto sem media_type: nao e frame real
  const idM = line.match(/"tool_use_id"\s*:\s*"([^"]+)"/);
  const tsM = line.match(/"timestamp"\s*:\s*"([^"]+)"/);
  const toolUseId = idM ? idM[1] : '';
  const tu = toolUse.get(toolUseId) || { name: '', input: {} };
  const desc = describeAction(tu.name, tu.input);
  // Sem tool_use_id nao e tool_result: e imagem que o usuario mandou no
  // prompt (assistant nunca produz content image no transcript).
  found.push({
    ts: tsM ? tsM[1] : '',
    toolUseId,
    mime: mimeM[1].toLowerCase(),
    tool: desc.tool || tu.name || '',
    target: desc.target || '',
    verb: toolUseId ? verbFor(tu.name) : 'você enviou',
    start,
    end,
  });
}

// Varre o buffer inteiro por linhas (indexOf(NL) nativo), delega a handleLine,
// ordena por timestamp asc e mantem so os MAX_FRAMES mais recentes.
export function scanFrames(buf) {
  const toolUse = new Map();
  const found = [];
  let start = 0;
  const len = buf.length;
  while (start < len) {
    let nl = buf.indexOf(NL, start);
    if (nl === -1) nl = len;
    if (nl > start) handleLine(buf.toString('utf8', start, nl), start, nl, toolUse, found);
    start = nl + 1;
  }
  found.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const capped = found.length > MAX_FRAMES ? found.slice(found.length - MAX_FRAMES) : found;
  return capped.map((f, idx) => ({ ...f, idx }));
}

// Indice com cache por (mtime,size). Hit => bump LRU e devolve; miss => le o
// arquivo inteiro UMA vez, indexa, evicta o mais antigo se estourar o cap.
async function readIndex(id, file) {
  const st = await fsp.stat(file);
  const hit = cache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const buf = await fsp.readFile(file);
  const entry = { mtimeMs: st.mtimeMs, size: st.size, frames: scanFrames(buf) };
  cache.set(id, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry;
}

function decodeImg(img) {
  return { mime: img.source.media_type || 'image/png', data: Buffer.from(img.source.data, 'base64') };
}

function isImg(p) {
  return p && p.type === 'image' && p.source && p.source.data;
}

// Le SO a linha do frame (ranged read pelo offset), parseia e decodifica o 1o
// bloco de imagem — em tool_result OU top-level (paste do usuario). Devolve
// {mime, data} ou null se a linha nao casar.
// shortcut: paste com N imagens serve so a 1a (1 frame por linha do indice);
// galeria por linha se alguem sentir falta das outras.
export async function readFrameBuf(file, desc) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const len = desc.end - desc.start;
    const b = Buffer.alloc(len);
    await fh.read(b, 0, len, desc.start);
    const obj = JSON.parse(b.toString('utf8'));
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) return null;
    for (const p of content) {
      if (isImg(p)) return decodeImg(p);
      if (p && p.type === 'tool_result' && Array.isArray(p.content)) {
        const img = p.content.find(isImg);
        if (img) return decodeImg(img);
      }
    }
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Descritor publico: sem os offsets internos de byte.
function publicDesc(f) {
  return { idx: f.idx, ts: f.ts, toolUseId: f.toolUseId, mime: f.mime, tool: f.tool, target: f.target, verb: f.verb };
}

// ------------------------------------------------------------- registro ----

function fail(res, err) {
  console.error('[visor]', err && err.message ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
}

async function resolveFile(req, res) {
  const id = String(req.query.session || '');
  if (!SESSION_ID_RE.test(id)) {
    res.status(400).json({ error: 'session invalida' });
    return null;
  }
  const file = await getSessionFile(id);
  if (!file) {
    res.status(404).json({ error: 'sessao nao encontrada' });
    return null;
  }
  return { id, file };
}

export function register(app) {
  // Indice dos frames historicos (metadados; sem base64).
  app.get('/api/visor', async (req, res) => {
    try {
      const found = await resolveFile(req, res);
      if (!found) return;
      const { frames } = await readIndex(found.id, found.file);
      res.json({ session: found.id, count: frames.length, frames: frames.map(publicDesc) });
    } catch (err) {
      fail(res, err);
    }
  });

  // Binario de UM frame historico (ranged read + decode sob demanda).
  app.get('/api/visor/frame', async (req, res) => {
    try {
      const idx = Number.parseInt(req.query.idx, 10);
      if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'idx invalido' });
      const found = await resolveFile(req, res);
      if (!found) return;
      const { frames } = await readIndex(found.id, found.file);
      const desc = frames[idx];
      if (!desc) return res.status(404).json({ error: 'frame inexistente' });
      const out = await readFrameBuf(found.file, desc);
      if (!out) return res.status(404).json({ error: 'imagem nao encontrada' });
      res.set('Content-Type', out.mime);
      res.set('Cache-Control', FRAME_TTL);
      res.send(out.data);
    } catch (err) {
      fail(res, err);
    }
  });
}
