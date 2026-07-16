// FAROL - fluxo de informacao do vault (refactor v2, F2b). Le o git do
// VAULT (o VaultSync commita de hora em hora) e expoe os MOVIMENTOS reais:
// quem editou o que, +/-, e o diff da nota sob demanda. READ-ONLY.
// Specs pinadas no plano (cross-review r2/r3): --no-merges; rename {a => b};
// binario ('-') = flag sem barras; linhas POR ARQUIVO com cap 6/commit
// (moreFiles) e 40 no feed; listing cacheado por rev-parse HEAD (TTL 15s);
// diff STATELESS (sha imutavel): valida ^{commit}, `--` separator, execFile
// sem shell, cap 64KB; patch vazio (rename/mode-only) = 200 com diff vazio.
import { execFile } from 'node:child_process';
import { VAULT } from './config.mjs';

const SHA_RE = /^[0-9a-f]{7,40}$/;
const LIST_TTL_MS = 15000;
const MAX_COMMITS = 30;
const MAX_FILES_PER_COMMIT = 6;
const MAX_ROWS = 40;
const DIFF_CAP = 64 * 1024;

function git(args, cap = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', VAULT, ...args], {
      maxBuffer: cap, windowsHide: true, timeout: 8000,
    }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

// Autor amigavel a partir da mensagem de commit (convencoes do vault).
function whoOf(msg) {
  if (/^vault-state/i.test(msg)) return 'esteira';
  if (/^claude-session/i.test(msg)) return 'sessao';
  if (/^vault-sync/i.test(msg)) return 'esteira';
  return 'vault';
}

// Rename do numstat: `a/{old => new}/b` ou `old => new` -> path final + origem.
// Exportado (junto com parseLog) pro check rodavel em scripts/checks.
export function parseRename(p) {
  const braced = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) {
    const [, pre, from, to, post] = braced;
    return { path: `${pre}${to}${post}`, renamedFrom: `${pre}${from}${post}` };
  }
  const flat = p.match(/^(.+) => (.+)$/);
  if (flat) return { path: flat[2], renamedFrom: flat[1] };
  return { path: p, renamedFrom: null };
}

export function parseLog(raw) {
  const rows = [];
  let cur = null;
  let filesInCommit = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, ts, ...msgParts] = line.slice(2).split('|');
      cur = { sha, ts, msg: msgParts.join('|') };
      filesInCommit = 0;
      continue;
    }
    if (!cur || !line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    filesInCommit += 1;
    if (filesInCommit > MAX_FILES_PER_COMMIT) {
      const last = rows[rows.length - 1];
      if (last && last.sha === cur.sha) last.moreFiles = (last.moreFiles || 0) + 1;
      continue;
    }
    if (rows.length >= MAX_ROWS) break;
    const binary = m[1] === '-';
    const { path: p, renamedFrom } = parseRename(m[3]);
    rows.push({
      sha: cur.sha, ts: cur.ts, msg: cur.msg, who: whoOf(cur.msg),
      path: p, renamedFrom,
      adds: binary ? null : Number(m[1]),
      dels: binary ? null : Number(m[2]),
      binary,
    });
  }
  return rows;
}

// Cache do listing: valido enquanto HEAD nao anda (TTL curto pro rev-parse).
let cache = { head: null, at: 0, rows: null };

async function getFluxo() {
  const now = Date.now();
  if (cache.rows && now - cache.at < LIST_TTL_MS) return { head: cache.head, rows: cache.rows };
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  if (cache.rows && cache.head === head) {
    cache.at = now;
    return { head, rows: cache.rows };
  }
  const raw = await git([
    'log', '--no-merges', '--numstat', '-n', String(MAX_COMMITS),
    '--date=iso-strict', '--pretty=format:@@%h|%ad|%s',
  ]);
  const rows = parseLog(raw);
  cache = { head, at: now, rows };
  return { head, rows };
}

async function getDiff(sha, file) {
  // sha existe E e commit? (rev-parse --verify falha em blob/tag/typo)
  await git(['rev-parse', '--verify', `${sha}^{commit}`]);
  const out = await git(['show', sha, '--patch', '--no-color', '--', file], DIFF_CAP + 65536);
  // `git show <sha> -- <file>` inclui o header do commit; corta ate o 1o 'diff --git'
  const idx = out.indexOf('diff --git');
  const body = idx >= 0 ? out.slice(idx) : '';
  const truncated = body.length > DIFF_CAP;
  return { sha, file, diff: truncated ? body.slice(0, DIFF_CAP) : body, truncated };
}

export function register(app) {
  app.get('/api/fluxo', async (req, res) => {
    try {
      res.json(await getFluxo());
    } catch (err) {
      res.status(500).json({ error: 'fluxo indisponivel', detail: String(err.message || err).slice(0, 200) });
    }
  });

  app.get('/api/fluxo/diff', async (req, res) => {
    const sha = String(req.query.c || '');
    const file = String(req.query.f || '');
    if (!SHA_RE.test(sha)) return res.status(400).json({ error: 'sha invalido' });
    if (!file || file.includes('\0') || file.startsWith('-')) {
      return res.status(400).json({ error: 'path invalido' });
    }
    try {
      res.json(await getDiff(sha, file));
    } catch {
      res.status(404).json({ error: 'commit ou arquivo nao encontrado' });
    }
  });
}
