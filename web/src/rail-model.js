// FAROL - rail-model: classificador PURO do rail de sessoes do Cockpit v2
// (sem React) — extraido de Cockpit.jsx (Task 4.3 Parte 3 fix round) para
// virar testavel em node puro. scripts/checks/check-rail-model.mjs roda
// direto contra este modulo (sem bundler/JSX).
// Ordenacao do rail: esperando -> pronto -> trabalhando -> ociosa -> dormindo.

import { fmtAge } from './cockpit-model.js';

export const STATE_RANK = { esperando: 0, pronto: 1, ativa: 2, ociosa: 3, dormindo: 4 };

// PRONTO (client-side, Task 4.3 Parte 3): dormindo ha < READY_WINDOW_MS E com
// narrative (resumo do resultado). Sem estado novo no server — so leitura do
// payload; distingue "acabou de entregar" de "dormindo puro" e de "esperando".
export const READY_WINDOW_MS = 30 * 60 * 1000;

// Gate obrigatorio do payload: sessao encerrada chega com awaiting=true.
// Equivalente a isAwaiting(s) (roomData.js) + gate !dormindo — inline aqui
// (nao importado) pra manter este modulo livre de qualquer cadeia que
// eventualmente puxe React (roomData.js re-exporta useSessions de api.js).
export function isWaiting(s) {
  return Boolean(s && s.awaitingInput) && s.state !== 'dormindo';
}

// PRONTO: dormindo recente COM narrative — "acabou de entregar", distinto de
// dormindo puro (sem prosa) e de esperando (rosa, precisa de decisao humana).
export function isPronto(s, now) {
  if (!s || s.state !== 'dormindo' || !s.narrative) return false;
  const ts = Date.parse(s.lastActivityTs || '');
  return Number.isFinite(ts) && (now - ts) < READY_WINDOW_MS;
}

// Estado visual do chip no rail (4 tratamentos; ociosa colapsa com dormindo).
export function classify(s, now) {
  if (isWaiting(s)) return 'esperando';
  if (isPronto(s, now)) return 'pronto';
  if (s.state === 'ativa') return 'trabalhando';
  if (s.state === 'ociosa') return 'ociosa';
  return 'dormindo';
}

export function rankOf(s, now) {
  if (isWaiting(s)) return STATE_RANK.esperando;
  if (isPronto(s, now)) return STATE_RANK.pronto;
  return STATE_RANK[s.state] ?? STATE_RANK.dormindo;
}

// esperando = maior espera primeiro (mais antigo no topo); demais = mais
// recente primeiro. Rank decide o balde; lastActivityTs desempata dentro dele.
export function compareRail(a, b, now) {
  const ra = rankOf(a, now);
  const rb = rankOf(b, now);
  if (ra !== rb) return ra - rb;
  const ta = Date.parse(a.lastActivityTs || '') || 0;
  const tb = Date.parse(b.lastActivityTs || '') || 0;
  return ra === STATE_RANK.esperando ? ta - tb : tb - ta;
}

// Idade (SEM prefixo "ha") desde o fim do turno: tempo GRANDE do esperando,
// tempo do badge PRONTO e da linha colapsada ociosa/dormindo. now = relogio
// local do rail (avanca sem SSE), igual ao fmtWait do banner.
export function waitAge(session, now) {
  const ts = Date.parse((session && session.lastActivityTs) || '');
  let sec;
  if (Number.isFinite(ts)) {
    sec = (now - ts) / 1000;
  } else {
    const sse = Number(session && session.secondsSinceEvent);
    if (!Number.isFinite(sse)) return '';
    sec = sse;
  }
  return fmtAge(sec);
}

// Tempo do TRABALHANDO = desde o ULTIMO prompt real do humano (lastUserTs, ms);
// fallback startedTs (ISO) quando ausente/0 (sessao sem prompt confirmado).
export function workAge(session, now) {
  const lu = Number(session && session.lastUserTs);
  const baseMs = Number.isFinite(lu) && lu > 0
    ? lu
    : Date.parse((session && session.startedTs) || '');
  if (!Number.isFinite(baseMs)) return '';
  return fmtAge((now - baseMs) / 1000);
}
