// FAROL - mapa da ESTEIRA (ownership: modulo esteira).
// Verdade de dominio das automacoes agendadas do USUARIO: nome da Scheduled
// Task -> { what, src, dst, cadence, claude }. O esteira.mjs cruza este mapa
// com o Windows Task Scheduler e os logs de run (.data/esteira-runs/*.jsonl):
// SO as tasks listadas aqui aparecem na Esteira (Microsoft/Opera/etc somem).
//
// O mapa vive em .data/esteira.json (gitignored — e config pessoal):
//   { "MinhaTask": { "what": "...", "src": [...], "dst": [...],
//                    "cadence": "diario 08:00", "claude": true }, ... }
// Sem arquivo => mapa vazio => view Esteira sem automacoes (estado honesto
// de uma instalacao nova).
//
// Campos:
//   what    - frase curta do que a automacao faz (UI: coluna "o que faz")
//   src     - fontes de dado que ela le (array de labels curtos)
//   dst     - destinos onde ela escreve/avisa (array de labels curtos)
//   cadence - cadencia legivel ('diario 08:00', '10 min', 'semanal'...)
//   claude  - true se a automacao usa um modelo Claude/LLM no loop
//
// Imutavel: o esteira.mjs nunca muta este objeto; so le.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

// Exportado para teste (aceita path explicito). Fail-closed: arquivo ausente
// ou invalido => mapa vazio, com erro logado uma vez.
export function loadEsteira(file = path.join(DATA_DIR, 'esteira.json')) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (err) {
    console.error('[esteira] esteira.json invalido, usando mapa vazio:', err.message);
    return {};
  }
}

export const ESTEIRA = loadEsteira();
