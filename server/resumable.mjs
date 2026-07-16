// FAROL - lista de sessoes Claude RETOMAVEIS pro picker "retomar" da Shell mobile.
// Reusa o mesmo listador do comando CLI `resume` (~/.claude/scripts/session-list.mjs)
// via spawn — fonte unica: CLI e UI mostram a MESMA lista. Read-only, cache 15s.
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'session-list.mjs');
const CACHE_MS = 15 * 1000;
const cache = { ts: 0, data: null };

function runList() {
  return new Promise((resolve) => {
    execFile(
      'node',
      [SCRIPT],
      { timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { console.error('[resumable]', err.message); return resolve([]); }
        try { resolve(JSON.parse(stdout || '[]')); } catch { resolve([]); }
      },
    );
  });
}

export function register(app) {
  app.get('/api/resumable', async (req, res) => {
    try {
      const now = Date.now();
      if (cache.data && now - cache.ts < CACHE_MS) return res.json(cache.data);
      const data = await runList();
      cache.data = data;
      cache.ts = now;
      res.json(data);
    } catch (err) {
      console.error('[resumable]', err.message);
      if (!res.headersSent) res.status(500).json([]);
    }
  });
}
