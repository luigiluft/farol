// FAROL - modulo mirror (ownership: W-SERVER, F7 C3.4).
// GET /api/mirror?session=<id>&cursor=<n>: espelho READ-ONLY do jsonl da
// sessao para as abas-espelho do Terminal. NUNCA toca /ws/terminal nem
// node-pty. Sem cursor: comeca no tail (max(0, size-256KB)) e devolve
// truncated:true. Le [cursor,size) SO em linhas completas (corta no ultimo
// \n; cursor avanca ate la), cap de 500 linhas mapeadas e ~1MB lidos por
// poll (sobrou => proximo poll pega). Mapeamento jsonl->linhas:
//   user texto cru (nao comecando com '<')  => kind 'user'   (clip 2000)
//   assistant content text                  => kind 'text'   (clip 4000)
//   assistant content tool_use              => kind 'tool'   {tool, target}
//   user content tool_result                => kind 'result' (clip 800)
// Clip e EXPLICITO: quando corta, anexa "… [cortado +N chars]" — resposta
// truncada em silencio parecia bug pro operador (feedback 02/07).
//   resto                                   => ignorado
// kind 'tool' reusa describeAction() de sessions.mjs (mesma tabela do
// buildAction, sem telemetria). Rota erra => {error} 500, nunca derruba.

import fsp from 'node:fs/promises';
import { getSessionFile, describeAction } from './sessions.mjs';

const TAIL_BYTES = 262144;
const MAX_READ_BYTES = 1024 * 1024;
const BEFORE_BYTES = 200 * 1024;        // janela padrao do "carregar mais"
const MAX_BEFORE_BYTES = 512 * 1024;    // teto de leitura por chamada de janela
const MAX_LINES = 500;
const USER_LEN = 2000;
const TEXT_LEN = 4000;
const RESULT_LEN = 800;
const SESSION_ID_RE = /^[\w-]+$/;
const NL = 0x0a;

// ----------------------------------------------------------------- leitura ----

function clip(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n… [cortado +${s.length - n} chars]`;
}

async function readMirror(file, cursorRaw) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const parsed = Number.parseInt(cursorRaw, 10);
    const hasCursor = Number.isFinite(parsed) && parsed >= 0;
    // head = 1o byte lido nesta resposta (raw). O cliente usa como topo do
    // buffer para pedir a janela ANTERIOR ("carregar mais"). atStart => topo
    // do arquivo, nada antes.
    const head = hasCursor ? Math.min(parsed, size) : Math.max(0, size - TAIL_BYTES);
    const truncated = !hasCursor && size > TAIL_BYTES;
    const end = Math.min(size, head + MAX_READ_BYTES);
    if (end <= head) return { cursor: head, head, atStart: head === 0, truncated, lines: [] };
    const buf = Buffer.alloc(end - head);
    const { bytesRead } = await fh.read(buf, 0, end - head, head);
    const view = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    return { ...consume(view, head, truncated), head, atStart: head === 0 };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Janela ANTERIOR de bytes para o "carregar mais" do Cockpit: le [start,before)
// e mapea SO linhas completas. before = topo atual do buffer do cliente. Alinha
// o inicio descartando o fragmento antes do 1o \n (a menos que start===0) e
// devolve head = 1o byte do trecho emitido, para virar o proximo before. Nunca
// 500: shape ruim/janela sem linha => { head, atStart, lines:[] }.
async function readBefore(file, beforeRaw, bytesRaw) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const bp = Number.parseInt(beforeRaw, 10);
    const before = Number.isFinite(bp) ? Math.max(0, Math.min(bp, size)) : size;
    if (before <= 0) return { head: 0, atStart: true, lines: [] };
    const wp = Number.parseInt(bytesRaw, 10);
    const win = Number.isFinite(wp) && wp > 0 ? Math.min(wp, MAX_BEFORE_BYTES) : BEFORE_BYTES;
    const start = Math.max(0, before - win);
    const buf = Buffer.alloc(before - start);
    const { bytesRead } = await fh.read(buf, 0, before - start, start);
    const view = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    // start>0 => 1a linha e um fragmento (cortado no meio): comeca apos o 1o \n.
    let from = 0;
    if (start > 0) {
      const firstNl = view.indexOf(NL);
      if (firstNl < 0) return { head: start, atStart: false, lines: [] };
      from = firstNl + 1;
    }
    const head = start + from;
    const lastNl = view.lastIndexOf(NL);
    if (lastNl < from) return { head, atStart: head === 0, lines: [] };
    const text = view.toString('utf8', from, lastNl + 1);
    const rawLines = text.split('\n');
    rawLines.pop(); // text termina em \n: ultimo elemento e sempre ''
    const lines = [];
    for (const rawLine of rawLines) {
      for (const m of mapLine(rawLine.trim())) lines.push(m);
    }
    return { head, atStart: head === 0, lines };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// Consome SO linhas completas; cursor avanca byte a byte por linha crua
// consumida. Cap EXATO de MAX_LINES mapeadas: linha crua que estouraria o
// cap NAO e consumida (cursor para antes dela; o proximo poll a rele) —
// nunca passa do cap nem perde linha mapeada.
function consume(buf, startCursor, truncated) {
  const lastNl = buf.lastIndexOf(NL);
  if (lastNl < 0) return { cursor: startCursor, truncated, lines: [] };
  const text = buf.toString('utf8', 0, lastNl + 1);
  const rawLines = text.split('\n');
  rawLines.pop(); // text termina em \n: ultimo elemento e sempre ''
  let cursor = startCursor;
  const lines = [];
  for (const rawLine of rawLines) {
    const mapped = mapLine(rawLine.trim());
    if (lines.length + mapped.length > MAX_LINES) {
      // Patologico: UMA linha crua mapeia alem do cap inteiro. Consumir com
      // corte para garantir progresso (senao todo poll travaria nela).
      if (lines.length === 0) {
        cursor += Buffer.byteLength(rawLine, 'utf8') + 1;
        for (const m of mapped.slice(0, MAX_LINES)) lines.push(m);
      }
      break;
    }
    cursor += Buffer.byteLength(rawLine, 'utf8') + 1;
    for (const m of mapped) lines.push(m);
  }
  return { cursor, truncated, lines };
}

// -------------------------------------------------------------- mapeamento ----

function mapLine(line) {
  if (!line) return [];
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return []; // fragmento do tail ou lixo: ignorar
  }
  if (!obj || typeof obj !== 'object') return [];
  const ts = typeof obj.timestamp === 'string' ? obj.timestamp : null;
  if (obj.type === 'user') return mapUser(obj, ts);
  if (obj.type === 'assistant') return mapAssistant(obj, ts);
  return [];
}

function mapUser(obj, ts) {
  const msg = obj.message;
  if (!msg) return [];
  const c = msg.content;
  if (typeof c === 'string') {
    const userLine = userTextLine(c, ts);
    return userLine ? [userLine] : [];
  }
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const part of c) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      const userLine = userTextLine(part.text, ts);
      if (userLine) out.push(userLine);
    } else if (part.type === 'tool_result') {
      const text = resultText(part.content);
      if (text) out.push({ kind: 'result', ts, text: clip(text, RESULT_LEN) });
    }
  }
  return out;
}

// Wrappers de comando/sistema (<command-name> etc) nao sao prompt do usuario.
function userTextLine(raw, ts) {
  const t = raw.trim();
  if (!t || t.startsWith('<')) return null;
  return { kind: 'user', ts, text: clip(t, USER_LEN) };
}

function resultText(content) {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const part = content.find((p) => p && p.type === 'text' && typeof p.text === 'string');
    return part ? part.text.trim() || null : null;
  }
  return null;
}

function mapAssistant(obj, ts) {
  const msg = obj.message;
  if (!msg || !Array.isArray(msg.content)) return [];
  const out = [];
  for (const part of msg.content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      const t = part.text.trim();
      if (t) out.push({ kind: 'text', ts, text: clip(t, TEXT_LEN) });
    } else if (part.type === 'tool_use' && typeof part.name === 'string' && part.name) {
      const a = describeAction(part.name, part.input);
      out.push({
        kind: 'tool',
        ts,
        text: a.detail || a.target || '',
        tool: a.tool,
        target: a.target,
      });
    }
  }
  return out;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/mirror', async (req, res) => {
    try {
      const id = String(req.query.session || '');
      if (!SESSION_ID_RE.test(id)) {
        return res.status(400).json({ error: 'session invalida' });
      }
      const file = await getSessionFile(id);
      if (!file) return res.status(404).json({ error: 'sessao nao encontrada' });
      const before = req.query.before;
      if (before !== undefined && String(before) !== '') {
        return res.json(await readBefore(file, String(before), String(req.query.bytes ?? '')));
      }
      res.json(await readMirror(file, String(req.query.cursor ?? '')));
    } catch (err) {
      console.error('[mirror]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    }
  });
}
