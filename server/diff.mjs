// Diff read-only do projeto de uma sessão. cwd vem do HEAD do transcript
// (sessão não expõe cwd — cada linha do .jsonl tem o campo).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getSessionFile } from './sessions.mjs';

const pexec = promisify(execFile);
const HOME = os.homedir();
const HEAD_BYTES = 64 * 1024;      // cwd aparece nas primeiras linhas
const MAX_DIFF_BYTES = 512 * 1024; // shortcut: trunca; paginação se doer
const GIT_TIMEOUT_MS = 8000;

export function extractCwd(text) {
  const m = String(text || '').match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return null; }
}

export function guardRepoDir(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const abs = path.resolve(s);
  const rel = path.relative(HOME, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return abs === HOME ? abs : null;
  return abs;
}

export function parsePorcelain(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
}

async function readHead(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally { await fh.close(); }
}

async function git(cwd, args) {
  const { stdout } = await pexec('git', ['-C', cwd, ...args], {
    timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_DIFF_BYTES * 4, windowsHide: true,
  });
  return stdout;
}

export function register(app) {
  app.get('/api/diff', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      if (!/^[a-f0-9][a-f0-9-]{7,}$/i.test(id)) return res.status(400).json({ error: 'id inválido' });
      const file = await getSessionFile(id);
      if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'sessão não encontrada' });
      const cwd = guardRepoDir(extractCwd(await readHead(file)));
      if (!cwd || !fs.existsSync(cwd)) return res.json({ ok: false, reason: 'sem-cwd' });
      let branch = null;
      try { branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); }
      catch { return res.json({ ok: false, reason: 'sem-git', cwd }); }
      let files = [];
      try {
        files = parsePorcelain(await git(cwd, ['status', '--porcelain']));
      } catch (err) {
        if (err.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER') {
          return res.json({ ok: false, reason: 'diff-grande' });
        }
        throw err;
      }
      let diff = '';
      let tooLarge = false;
      if (files.length) {
        // diff HEAD pega staged+unstaged; repo sem commit cai no diff simples
        try {
          try { diff = await git(cwd, ['diff', 'HEAD', '--no-color']); }
          catch { diff = await git(cwd, ['diff', '--no-color']); }
        } catch (err) {
          if (err.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER') {
            diff = '';
            tooLarge = true;
          } else {
            throw err;
          }
        }
      }
      let truncated = false;
      if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
        diff = diff.slice(0, MAX_DIFF_BYTES); truncated = true;
      }
      res.json({ ok: true, cwd, branch, files, diff, truncated, tooLarge, ts: Date.now() });
    } catch (err) {
      console.error('[diff]', err?.message || err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
