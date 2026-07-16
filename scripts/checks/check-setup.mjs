// Check: helpers do wizard + E2E com stdin pipado num sandbox (TORRE_SETUP_OUT).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizePath, countNotes, buildTopics, escapeRegex, renderEnv, writeFileAtomic, claudeStatus,
} from '../setup.mjs';

const HOME = 'C:/fake/home';

// --- sanitizePath
assert.equal(sanitizePath('  "C:\\meu vault\\notas"  ', HOME), 'C:/meu vault/notas', 'aspas+backslash');
assert.equal(sanitizePath('~/vault/', HOME), 'C:/fake/home/vault', 'til + trailing slash');
assert.equal(sanitizePath("'/x/y'", HOME), '/x/y', 'aspas simples');

// --- escapeRegex / buildTopics
assert.equal(escapeRegex('a+b.c'), 'a\\+b\\.c', 'regex escapado');
const topics = buildTopics([
  { name: 'Client: Alpha', keywords: ['foo', 'a+b'] },
  { name: '', keywords: ['x'] },
]);
assert.equal(topics[0].topic, 'client-alpha', 'slug sem char especial');
assert.equal(topics[0].pattern, 'foo|a\\+b', 'pattern escapado');
assert.equal(topics.length, 3, 'so validos + 2 defaults');
assert.equal(topics[1].topic, 'torre', 'defaults preservados');
for (const t of topics) assert.doesNotThrow(() => new RegExp(t.pattern, 'i'), 'pattern compila');

// --- renderEnv (vazio some, presente entra)
assert.equal(renderEnv({ A: 'x', B: '', C: undefined }), 'A=x\n', 'so chaves com valor');

// --- sandbox: vault fake + claude fake
const sand = fs.mkdtempSync(path.join(os.tmpdir(), 'torre-setup-'));
const vault = path.join(sand, 'vault');
fs.mkdirSync(path.join(vault, 'sub'), { recursive: true });
fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
fs.writeFileSync(path.join(vault, 'a.md'), '# a');
fs.writeFileSync(path.join(vault, 'sub', 'b.md'), '# b');
fs.writeFileSync(path.join(vault, '.obsidian', 'ignorada.md'), 'x');
const claude = path.join(sand, 'claude');
fs.mkdirSync(path.join(claude, 'projects', 'proj-x'), { recursive: true });
fs.writeFileSync(path.join(claude, 'projects', 'proj-x', 's1.jsonl'), '{}');

const counted = countNotes(vault);
assert.equal(counted.notes, 2, 'conta .md e ignora .obsidian');
assert.equal(claudeStatus(claude).ok, true, 'claude fake ok');
assert.equal(claudeStatus(claude).transcripts, 1, '1 transcript');
assert.equal(claudeStatus(path.join(sand, 'nao-existe')).ok, false, 'claude ausente = not ok');

// --- writeFileAtomic
const af = path.join(sand, 'atomic.txt');
writeFileAtomic(af, 'conteudo');
assert.equal(fs.readFileSync(af, 'utf8'), 'conteudo', 'atomic escreveu');
assert.equal(fs.readdirSync(sand).filter((f) => f.includes('.tmp-')).length, 0, 'sem tmp sobrando');

// --- E2E: wizard completo com stdin pipado (out isolado)
const outDir = path.join(sand, 'out');
fs.mkdirSync(outDir, { recursive: true });
const answers = [
  vault, // path do vault (nao e candidato conhecido)
  '', // confirma contagem (default Y)
  'sk-or-teste-nao-e-chave-real', // openrouter key
  'Meu App', // projeto 1
  'meuapp, loja', // keywords
  '', // fim dos projetos
].join('\n');
const run = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '..', 'setup.mjs')], {
  input: `${answers}\n`,
  encoding: 'utf8',
  env: { ...process.env, TORRE_SETUP_OUT: outDir, TORRE_CLAUDE: claude },
  timeout: 30000,
});
assert.equal(run.status, 0, `wizard saiu 0 (stdout: ${run.stdout}\nstderr: ${run.stderr})`);
assert.ok(run.stdout.includes('Found 2'), 'mostrou contagem do vault');
assert.ok(run.stdout.includes('sk-o***real'), 'chave mascarada no output');
assert.ok(!run.stdout.includes('sk-or-teste-nao-e-chave-real'), 'chave crua NUNCA ecoada');
const env = fs.readFileSync(path.join(outDir, '.env'), 'utf8');
assert.ok(env.includes(`TORRE_VAULT=${vault.replace(/\\/g, '/')}`), '.env com vault');
assert.ok(env.includes('OPENROUTER_API_KEY=sk-or-teste'), '.env com a chave');
const tj = JSON.parse(fs.readFileSync(path.join(outDir, '.data', 'topics.json'), 'utf8'));
assert.equal(tj[0].topic, 'meu-app', 'topics.json do projeto');
assert.equal(tj[0].pattern, 'meuapp|loja', 'keywords viram pattern');

fs.rmSync(sand, { recursive: true, force: true });
console.log('check-setup: 22/22 ok');
