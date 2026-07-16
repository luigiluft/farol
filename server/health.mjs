// FAROL - diagnostico de instalacao (F3 do plano instalavel).
// GET /api/health + resumo de boot com NUMEROS reais ("li N notas, M
// transcripts"), nao "path existe" — instalacao com problema se explica
// sozinha (catch do cross-review: health cosmetico mente pro usuario).
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, CLAUDE, DATA_DIR, PORT } from './config.mjs';
import { notesSnapshot } from './vault.mjs';

const TRANSCRIPT_CAP = 5000;

// Conta transcripts raso (projects/*/*.jsonl). Duplica de proposito o helper
// do scripts/setup.mjs: o wizard e standalone (roda antes de npm install
// terminar de resolver o server) e o server nao importa de scripts/.
export function countTranscripts(claudeDir, cap = TRANSCRIPT_CAP) {
  const projects = path.join(claudeDir, 'projects');
  let transcripts = 0;
  let dirs = 0;
  try {
    for (const d of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      dirs += 1;
      try {
        transcripts += fs
          .readdirSync(path.join(projects, d.name))
          .filter((f) => f.endsWith('.jsonl')).length;
      } catch {
        continue;
      }
      if (transcripts >= cap) break;
    }
  } catch {
    return { ok: false, transcripts: 0, dirs: 0 };
  }
  return { ok: true, transcripts, dirs };
}

function userConfigState() {
  return {
    topics: fs.existsSync(path.join(DATA_DIR, 'topics.json')) ? 'user' : 'defaults',
    esteira: fs.existsSync(path.join(DATA_DIR, 'esteira.json')) ? 'user' : 'empty',
  };
}

function diaryProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'off';
}

export async function buildHealth() {
  let vault;
  try {
    const notes = await notesSnapshot();
    vault = { ok: notes.length > 0, path: VAULT, notes: notes.length };
    if (!vault.ok) vault.hint = 'nenhuma nota .md indexada — confira TORRE_VAULT (npm run setup)';
  } catch (err) {
    vault = { ok: false, path: VAULT, notes: 0, error: err.message, hint: 'rode npm run setup' };
  }
  const claude = { path: CLAUDE, ...countTranscripts(CLAUDE) };
  if (!claude.ok) claude.hint = 'Claude Code nao encontrado (sem projects/) — instale ou defina TORRE_CLAUDE';
  return { ok: vault.ok && claude.ok, vault, claude, config: userConfigState(), diario: diaryProvider(), port: PORT };
}

export function register(app) {
  app.get('/api/health', async (req, res) => {
    try {
      res.json(await buildHealth());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Resumo pos-listen (async de proposito: nao atrasa o server subir; tambem
// esquenta o indice do vault, matando o 1o request frio).
export async function printBootSummary() {
  try {
    const h = await buildHealth();
    const flag = (ok) => (ok ? 'ok' : 'FALHOU');
    console.log(`[torre] vault ${flag(h.vault.ok)}: ${h.vault.notes} notas em ${h.vault.path}`);
    console.log(`[torre] claude ${flag(h.claude.ok)}: ${h.claude.transcripts} transcripts em ${h.claude.path}`);
    console.log(`[torre] config: topics=${h.config.topics} esteira=${h.config.esteira} diario=${h.diario}`);
    if (h.vault.hint) console.log(`[torre]   -> ${h.vault.hint}`);
    if (h.claude.hint) console.log(`[torre]   -> ${h.claude.hint}`);
  } catch (err) {
    console.error('[torre] diagnostico de boot falhou:', err.message);
  }
}
