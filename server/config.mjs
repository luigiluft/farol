// FAROL - configuracao central (scaffold).
// Consts canonicas do SPEC. Modulos importam daqui; nunca re-declarar paths.
// O vault e READ-ONLY em todo o MVP: nenhuma rota de escrita.
// F7: DATA_DIR = torre/.data (estado persistido do server, ex: seen.json).

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env na raiz do repo (gitignored) — env real do processo tem precedencia
// (provado: loadEnvFile nao sobrescreve variavel ja definida). Ausencia e
// normal (defaults resolvem); MALFORMADO e erro de config e precisa aparecer.
try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch (err) {
  if (err?.code !== 'ENOENT') {
    console.error('[config] .env invalido (ignorado, usando defaults):', err.message);
  }
}

// Consumidores comparam prefixos como string (guards de traversal) — manter
// forward slashes garante o mesmo formato do valor literal anterior.
function fwd(p) {
  return p.replace(/\\/g, '/');
}

// Overrides por env (TORRE_VAULT / TORRE_CLAUDE); default deriva do homedir,
// sem username hardcoded. CLAUDE segue a convencao do Claude Code (~/.claude).
export const VAULT = fwd(
  process.env.TORRE_VAULT
    || path.join(os.homedir(), 'OneDrive', 'Documentos', 'Obsidian Vault'),
);
export const CLAUDE = fwd(process.env.TORRE_CLAUDE || path.join(os.homedir(), '.claude'));

// Slug do homedir em ~/.claude/projects (ex: C--Users-Fulano): mesmo algoritmo
// do Claude Code (todo char nao-alfanumerico vira '-'). Consumidores usam pra
// remover o prefixo do nome de projeto "home".
const HOME_SLUG = os.homedir().replace(/[^a-zA-Z0-9]/g, '-');
export const PROJECT_PREFIX_RE = new RegExp(`^${HOME_SLUG}-?`);
// TORRE_PORT so para instancias efemeras de dev/teste (agentes); prod = 7777.
export const PORT = Number(process.env.TORRE_PORT) || 7777;
// TORRE_DATA p/ stacks isolados (demo, testes); default = <repo>/.data
export const DATA_DIR = process.env.TORRE_DATA
  ? fwd(path.resolve(process.env.TORRE_DATA))
  : path.resolve(__dirname, '..', '.data');
