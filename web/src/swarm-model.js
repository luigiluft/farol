// FAROL - modelo PURO do enxame orbital (Torre). Sem React/DOM/imports: quais
// sessoes tem drones pra orbitar. isAwaiting e INJETADO (vive em roomData.js, que
// reexporta useSessions de api.js e nao roda em node) — assim este modulo e
// testavel isolado com node.
const SWARM_CAP = 48; // drones orbitando por sessao (era 6 no fluxo-vault)

export function swarmSessions(sessions, isAwaiting) {
  const out = [];
  for (const s of (Array.isArray(sessions) ? sessions : [])) {
    if (!s || s.state !== 'ativa' || isAwaiting(s)) continue;
    const subs = (Array.isArray(s.subagents) ? s.subagents : []).filter((x) => x && x.id);
    if (!subs.length) continue;
    out.push({ id: s.id, project: s.project, subs: subs.slice(0, SWARM_CAP) });
  }
  return out;
}
