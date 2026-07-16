// FAROL - modulo mcp (ownership: agente P4, F5.8; F7 C3.2 aditivo).
// Expoe GET /api/mcp: catalogo de MCP servers para a Estacao TORRE no
// universo. Merge de tres fontes, nesta ordem: (a) KNOWN_MCPS curado com
// labels amigaveis PT-BR — SEMPRE presente, count 0 se nunca visto; (b) keys
// de mcpServers em ~/.claude.json (configurados; cache em memoria de 60s;
// arquivo pode nao existir ou nao ter o campo -> lista vazia, nunca erro);
// (c) getMcpSeen() de sessions.mjs (vistos em uso; sobrescrevem count e
// lastUsedTs e adicionam ids fora da config; persistidos pelo proprio
// sessions em torre/.data/seen.json — restart nao zera as estacoes).
// Resposta: [{ id, label, count, lastUsedTs, known }] ordenada por count
// desc, depois label. label de id fora do catalogo = id sem prefixo
// 'claude_ai_', '_' => ' '.

import fsp from 'node:fs/promises';
import { CLAUDE } from './config.mjs';
import { getMcpSeen } from './sessions.mjs';

// ~/.claude.json mora AO LADO do diretorio ~/.claude => CLAUDE + '.json'.
const CLAUDE_JSON = `${CLAUDE}.json`;
const CONFIG_TTL_MS = 60 * 1000;
const LABEL_PREFIX_RE = /^claude_ai_/;

// F7 (C3.2): catalogo curado — mesmos labels do MCP_LABELS de callsigns.js.
const KNOWN_MCPS = new Map([
  ['claude_ai_Gmail', 'Gmail'],
  ['claude_ai_Google_Calendar', 'Agenda Google'],
  ['claude_ai_Google_Drive', 'Drive'],
  ['claude_ai_Granola', 'Granola'],
  ['claude_ai_Notion', 'Notion'],
  ['claude_ai_Supabase', 'Supabase'],
  ['claude_ai_Context7', 'Context7'],
  ['claude_ai_Figma', 'Figma'],
  ['claude_ai_Canva', 'Canva'],
  ['claude_ai_Gamma', 'Gamma'],
  ['playwright', 'Navegador'],
  ['windows-mcp', 'Windows'],
  ['apify', 'Apify'],
  ['higgsfield', 'Higgsfield'],
  ['lovable', 'Lovable'],
]);

// ----------------------------------------------------------------- config ----

let configCache = { ts: 0, ids: [] };

async function configMcpIds(now) {
  if (now - configCache.ts < CONFIG_TTL_MS) return configCache.ids;
  let ids = [];
  try {
    const cfg = JSON.parse(await fsp.readFile(CLAUDE_JSON, 'utf8'));
    if (cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object') {
      ids = Object.keys(cfg.mcpServers);
    }
  } catch {
    // arquivo ausente, JSON invalido ou sem mcpServers: segue com lista vazia
  }
  configCache = { ts: now, ids };
  return ids;
}

// ------------------------------------------------------------------ merge ----

function labelOf(id) {
  return KNOWN_MCPS.get(id) || id.replace(LABEL_PREFIX_RE, '').replace(/_/g, ' ');
}

function compareServers(a, b) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

export async function listMcpServers() {
  const byId = new Map();
  for (const [id, label] of KNOWN_MCPS) {
    byId.set(id, { id, label, count: 0, lastUsedTs: null, known: true });
  }
  for (const id of await configMcpIds(Date.now())) {
    if (typeof id !== 'string' || !id || byId.has(id)) continue;
    byId.set(id, { id, label: labelOf(id), count: 0, lastUsedTs: null, known: false });
  }
  for (const [id, seen] of getMcpSeen()) {
    if (!seen || typeof id !== 'string' || !id) continue;
    byId.set(id, {
      id,
      label: labelOf(id),
      count: Number.isFinite(seen.count) ? seen.count : 0,
      lastUsedTs: Number.isFinite(seen.lastUsedTs) ? seen.lastUsedTs : null,
      known: KNOWN_MCPS.has(id),
    });
  }
  return [...byId.values()].sort(compareServers);
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/mcp', async (req, res) => {
    try {
      res.json(await listMcpServers());
    } catch (err) {
      console.error('[mcp]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
