// FAROL - limites do plano (aba USO): marca no grafico QUANDO o credito
// reseta. Os horarios de reset do plano Max NAO vivem em arquivo local — o
// /usage do Claude Code puxa de endpoint da Anthropic. Entao o usuario ancora
// UM reset em .data/limits.json e a Torre projeta o ciclo semanal (7d) dele.
//
// .data/limits.json:
//   { "weekly": { "anchor": "2026-07-09T04:00:00-03:00" } }
// anchor = qualquer instante de reset semanal (roda /usage, ve o proximo reset
// do limite SEMANAL). O resto do ciclo sai daqui de 7 em 7 dias.
//
// Nota honesta: o token somado aqui NAO e a metrica de limite da Anthropic
// (a conta dela e ponderada, nao soma crua). Isto marca TIMING do reset e
// mostra tokens-por-ciclo do proprio dashboard — nao "% do limite".
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

const WEEK_MS = 7 * 86400000;

// Le .data/limits.json. Fail-closed: ausente/quebrado/anchor invalida => null
// (a UI mostra estado "configure"), com erro logado uma vez.
export function loadLimits(file = path.join(DATA_DIR, 'limits.json')) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const anchor = raw && raw.weekly && raw.weekly.anchor;
    if (typeof anchor === 'string') {
      const ms = Date.parse(anchor);
      if (Number.isFinite(ms)) return { weekly: { anchorMs: ms } };
    }
    return null;
  } catch (err) {
    console.error('[limits] limits.json invalido:', err.message);
    return null;
  }
}

// Todos os instantes de reset semanal em [sinceMs, untilMs], projetando o
// anchor de 7 em 7 dias (pra frente e pra tras). PURO.
export function weeklyResetsInRange(anchorMs, sinceMs, untilMs) {
  if (!Number.isFinite(anchorMs) || untilMs < sinceMs) return [];
  const first = anchorMs + Math.ceil((sinceMs - anchorMs) / WEEK_MS) * WEEK_MS;
  const out = [];
  for (let t = first; t <= untilMs; t += WEEK_MS) out.push(t);
  return out;
}

// Proximo instante de reset >= nowMs. PURO.
export function nextWeeklyReset(anchorMs, nowMs) {
  if (!Number.isFinite(anchorMs)) return null;
  return anchorMs + Math.ceil((nowMs - anchorMs) / WEEK_MS) * WEEK_MS;
}

// Ultimo instante de reset <= nowMs (inicio do ciclo atual). PURO.
export function lastWeeklyReset(anchorMs, nowMs) {
  if (!Number.isFinite(anchorMs)) return null;
  return anchorMs + Math.floor((nowMs - anchorMs) / WEEK_MS) * WEEK_MS;
}
