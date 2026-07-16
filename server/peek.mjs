// FAROL - peek: leitura GUARDADA de arquivo/pasta pro olho do Cockpit
// ("mostra o arquivo sendo codado"). READ-ONLY por construcao: so GET, so
// dentro de os.homedir(), cap de bytes, '..' nunca escapa da raiz.
// Motivo de existir: tool_results do espelho chegam truncados; o olho quer
// o trecho REAL ao redor da linha quente.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ROOT = os.homedir();
const MAX_BYTES = 256 * 1024; // le no maximo 256KB do arquivo
const SPAN = 40; // linhas na janela
const LINE_MAX = 220; // clip horizontal por linha
const DIR_CAP = 48;
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Normaliza e valida: absoluto, dentro de ROOT. null = negado.
export function resolveGuarded(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const abs = path.resolve(s);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

// Janela de linhas ao redor de `line` (1-based). line null => topo.
export function windowLines(text, line, span) {
  const all = String(text).split(/\r?\n/);
  const total = all.length;
  const want = Number.isInteger(line) && line > 0 ? line : 1;
  const half = Math.floor(span / 2);
  const from = Math.max(1, Math.min(want - half, Math.max(1, total - span + 1)));
  const out = [];
  for (let n = from; n < from + span && n <= total; n += 1) {
    const t = all[n - 1];
    out.push({ n, t: t.length > LINE_MAX ? t.slice(0, LINE_MAX - 1) + '…' : t });
  }
  return { from, total, lines: out };
}

async function peekFile(req, res) {
  const abs = resolveGuarded(req.query.path);
  if (!abs) return res.status(403).json({ error: 'path fora da area permitida' });
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return res.status(404).json({ error: 'nao encontrado' });
  }
  if (!st.isFile()) return res.status(400).json({ error: 'nao e arquivo' });
  let fh = null;
  try {
    fh = await fsp.open(abs, 'r');
    const len = Math.min(st.size, MAX_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    const line = Number.parseInt(req.query.line, 10);
    const win = windowLines(buf.toString('utf8'), Number.isInteger(line) ? line : null, SPAN);
    res.json({
      path: abs,
      name: path.basename(abs),
      line: Number.isInteger(line) ? line : null,
      truncated: st.size > MAX_BYTES,
      ...win,
    });
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function peekDir(req, res) {
  const abs = resolveGuarded(req.query.path);
  if (!abs) return res.status(403).json({ error: 'path fora da area permitida' });
  let items;
  try {
    items = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return res.status(404).json({ error: 'nao encontrado' });
  }
  const mapped = items
    .filter((d) => !d.name.startsWith('.git'))
    .map((d) => ({ name: d.name, dir: d.isDirectory() }))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name))
    .slice(0, DIR_CAP);
  res.json({ path: abs, name: path.basename(abs), items: mapped });
}

// Bytes de imagem (Content-Type correto) pro Cockpit exibir shot/screenshot
// produzido pela sessao. So extensoes de imagem conhecidas; SVG servido so
// pra uso em <img> — sem execucao de script nesse contexto.
async function peekImage(req, res) {
  const abs = resolveGuarded(req.query.path);
  if (!abs) return res.status(403).json({ error: 'fora do homedir' });
  const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
  if (!mime) return res.status(415).json({ error: 'extensão não suportada' });
  let st;
  try { st = await fsp.stat(abs); } catch { return res.status(404).json({ error: 'não existe' }); }
  if (!st.isFile()) return res.status(400).json({ error: 'não é arquivo' });
  if (st.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'grande demais' });
  // SVG: CSP mata script em navegação direta (server é alcançável via Tailscale)
  if (mime === 'image/svg+xml') {
    res.set({
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
  }
  res.type(mime).send(await fsp.readFile(abs));
}

export function register(app) {
  app.get('/api/peek/file', (req, res) => {
    peekFile(req, res).catch((err) => {
      console.error('[peek]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    });
  });
  app.get('/api/peek/dir', (req, res) => {
    peekDir(req, res).catch((err) => {
      console.error('[peek]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    });
  });
  app.get('/api/peek/image', (req, res) => {
    peekImage(req, res).catch((err) => {
      console.error('[peek]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    });
  });
}
