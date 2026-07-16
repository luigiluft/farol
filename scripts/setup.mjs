// A TORRE - first-run setup wizard (npm run setup).
// Node only (readline/promises), zero deps. Writes .env and .data/topics.json
// atomically (tmp + rename) and never overwrites without asking.
// Helpers are exported for tests; TORRE_SETUP_OUT overrides the output root
// (test-only, so a test run never touches the real .env).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.backups']);
const NOTE_CAP = 5000;

// --------------------------------------------------------------- helpers ----

// Cleans a pasted path: trims, strips matching quotes, expands leading ~,
// normalizes to forward slashes and drops a trailing slash.
export function sanitizePath(input, home = os.homedir()) {
  let p = String(input || '').trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  if (p === '~') p = home;
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(home, p.slice(2));
  p = p.replace(/\\/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

// Recursive .md count (skips vault noise dirs); capped so a huge tree
// answers fast. Returns { notes, dirs, capped }.
export function countNotes(dir, cap = NOTE_CAP) {
  let notes = 0;
  let dirs = 0;
  let capped = false;
  const stack = [dir];
  while (stack.length) {
    if (notes >= cap) {
      capped = true;
      break;
    }
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // subarvore ilegivel nao derruba a contagem
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) {
          dirs += 1;
          stack.push(path.join(cur, e.name));
        }
      } else if (e.name.endsWith('.md')) {
        notes += 1;
      }
    }
  }
  return { notes, dirs, capped };
}

// Common vault locations per OS; only returns ones that exist and have notes.
export function vaultCandidates(home = os.homedir()) {
  const spots = [
    path.join(home, 'OneDrive', 'Documentos', 'Obsidian Vault'),
    path.join(home, 'OneDrive', 'Documents', 'Obsidian Vault'),
    path.join(home, 'Documents', 'Obsidian Vault'),
    path.join(home, 'Documents', 'Obsidian'),
    path.join(home, 'Obsidian'),
    path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents'),
  ];
  const out = [];
  for (const p of spots) {
    try {
      if (!fs.statSync(p).isDirectory()) continue;
    } catch {
      continue;
    }
    const count = countNotes(p, 500);
    if (count.notes > 0) out.push({ path: p.replace(/\\/g, '/'), ...count });
  }
  return out;
}

// Claude Code presence: ~/.claude/projects with at least one project dir;
// counts session transcripts (shallow: projects/*/*.jsonl).
export function claudeStatus(claudeDir) {
  const projects = path.join(claudeDir, 'projects');
  let transcripts = 0;
  try {
    for (const d of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        transcripts += fs
          .readdirSync(path.join(projects, d.name))
          .filter((f) => f.endsWith('.jsonl')).length;
      } catch {
        continue;
      }
    }
  } catch {
    return { ok: false, transcripts: 0 };
  }
  return { ok: true, transcripts };
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// User projects -> topics.json entries; generic defaults appended so the
// torre/setup-claude classification keeps working (file replaces the list).
export function buildTopics(projects) {
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rules = projects
    .filter((p) => p.name && p.keywords.length)
    .map((p) => ({ topic: slug(p.name), pattern: p.keywords.map(escapeRegex).join('|') }));
  rules.push({ topic: 'torre', pattern: 'torre|cockpit|7777|vault|obsidian|grafo' });
  rules.push({ topic: 'setup-claude', pattern: 'claude|skill|mcp|hook|subagent|prompt' });
  return rules;
}

export function renderEnv(vars) {
  const lines = Object.entries(vars)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return `${lines.join('\n')}\n`;
}

export function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------ interactive ----

function mask(key) {
  return key.length > 8 ? `${key.slice(0, 4)}***${key.slice(-4)}` : '***';
}

// ask() com fila propria de linhas em vez de rl.question: input pipado
// (cat answers | npm run setup) entrega todas as linhas num burst e as que
// chegam ENTRE duas questions seriam descartadas; a fila preserva. EOF
// (Ctrl+D / fim do pipe) aborta com erro controlado em vez de pendurar o
// processo em top-level await.
function makeAsk(rl) {
  const buffered = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (line) => {
    const next = waiters.shift();
    if (next) next(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const next of waiters.splice(0)) next(null);
  });
  return async function ask(prompt) {
    process.stdout.write(prompt);
    if (buffered.length) return buffered.shift();
    if (closed) throw new Error('stdin closed');
    const line = await new Promise((resolve) => waiters.push(resolve));
    if (line === null) throw new Error('stdin closed');
    return line;
  };
}

async function askVault(ask) {
  const found = vaultCandidates();
  if (found.length) {
    console.log('\nObsidian vaults found:');
    found.forEach((c, i) => console.log(`  ${i + 1}. ${c.path} (${c.notes}${c.capped ? '+' : ''} notes)`));
  }
  for (;;) {
    const hint = found.length ? `1-${found.length} or a path` : 'path to your vault (any folder of .md files)';
    const raw = await ask(`Vault [${hint}]: `);
    const pick = Number(raw.trim());
    const chosen = found[pick - 1]
      ? found[pick - 1].path
      : sanitizePath(raw);
    if (!chosen) continue;
    let stat;
    try {
      stat = fs.statSync(chosen);
    } catch {
      console.log('  Path not found, try again.');
      continue;
    }
    if (!stat.isDirectory()) {
      console.log('  Not a directory, try again.');
      continue;
    }
    const { notes, dirs, capped } = countNotes(chosen);
    if (notes === 0) {
      console.log('  No .md files in there. The Torre needs a folder with markdown notes.');
      continue;
    }
    const ok = await ask(`  Found ${notes}${capped ? '+' : ''} notes in ${dirs} folders. Use it? [Y/n] `);
    if (!/^n/i.test(ok.trim())) return chosen;
  }
}

async function askProjects(ask) {
  console.log('\nName your projects so sessions get logical fleet names (torre-1, myapp-2...).');
  console.log('Press Enter on an empty name to finish (defaults still apply).');
  const projects = [];
  for (;;) {
    const name = (await ask(`Project ${projects.length + 1} name (Enter = done): `)).trim();
    if (!name) break;
    const kw = (await ask(`  Keywords for "${name}" (comma separated): `))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (kw.length) projects.push({ name, keywords: kw });
    else console.log('  No keywords given, skipped.');
  }
  return projects;
}

async function confirmOverwrite(ask, file) {
  if (!fs.existsSync(file)) return true;
  const ans = await ask(`${path.basename(file)} already exists. Overwrite? [y/N] `);
  return /^y/i.test(ans.trim());
}

async function main() {
  // Node <22 falha depois de formas cripticas (loadEnvFile, import.meta.dirname)
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error(`Node ${process.versions.node} e antigo demais — instale Node 24+: https://nodejs.org`);
    process.exitCode = 1;
    return;
  }
  const out = process.env.TORRE_SETUP_OUT || ROOT; // test-only override
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = makeAsk(rl);
  try {
    console.log('FAROL - setup\n');

    const claudeDir = sanitizePath(process.env.TORRE_CLAUDE || path.join(os.homedir(), '.claude'));
    const claude = claudeStatus(claudeDir);
    if (!claude.ok) {
      console.log(`Claude Code not found at ${claudeDir} (no projects/ directory).`);
      console.log('Install Claude Code first: https://claude.com/claude-code');
      console.log('Already installed elsewhere? Re-run with TORRE_CLAUDE=<path> npm run setup');
      process.exitCode = 1;
      return;
    }
    console.log(`Claude Code: ok (${claude.transcripts} session transcripts at ${claudeDir})`);
    if (claude.transcripts === 0) {
      console.log('  No sessions yet - the fleet will be empty until you run Claude Code once.');
    }

    const vault = await askVault(ask);

    const key = (await ask('\nOpenRouter API key for Diario prose (Enter = skip): ')).trim();
    if (key) console.log(`  Using key ${mask(key)} (stored only in .env, gitignored).`);

    const projects = await askProjects(ask);

    const envFile = path.join(out, '.env');
    const topicsFile = path.join(out, '.data', 'topics.json');
    fs.mkdirSync(path.dirname(topicsFile), { recursive: true });

    if (await confirmOverwrite(ask, envFile)) {
      writeFileAtomic(envFile, renderEnv({ TORRE_VAULT: vault, OPENROUTER_API_KEY: key }));
      console.log(`\nWrote ${envFile}`);
    }
    if (projects.length && (await confirmOverwrite(ask, topicsFile))) {
      writeFileAtomic(topicsFile, `${JSON.stringify(buildTopics(projects), null, 2)}\n`);
      console.log(`Wrote ${topicsFile}`);
    }

    console.log('\nDone. Next steps:');
    console.log('  npm start           -> http://localhost:7777');
    if (process.platform === 'win32') {
      console.log('  optional autostart  -> see scripts/torre-autostart.mjs in the README');
    }
    console.log(`  Diario prose: ${key ? 'on' : 'off (add OPENROUTER_API_KEY to .env to enable)'}`);
  } catch (err) {
    if (err?.message === 'stdin closed') {
      console.error('\nSetup aborted (stdin closed). Nothing was written beyond what was reported above.');
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
