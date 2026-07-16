// FAROL - modelo PURO do fluxo do Olho da IA (Cockpit). Sem React, sem DOM:
// transforma um subagente do payload em uma FAIXA (say + trail de chips) e
// agrega a distribuição de ferramentas da frota-em-foco (o "pulse").
import { subToolClass } from './tool-visual.js';

const TRAIL_MAX = 5;

export function laneModel(sub) {
  const acts = Array.isArray(sub.recentActions) ? sub.recentActions.slice(-TRAIL_MAX) : [];
  const trail = acts.map((a) => ({ tool: a.tool, target: a.target || '', cls: subToolClass(a.tool), ts: a.ts }));
  return {
    id: sub.id,
    agentType: sub.agentType || sub.label || 'agente',
    active: sub.active !== false,
    say: (sub.narrative || '').trim(),
    trail,
  };
}

export function pulseCounts(subs) {
  const c = { 'st-read': 0, 'st-write': 0, 'st-shell': 0, 'st-search': 0 };
  for (const s of (Array.isArray(subs) ? subs : [])) {
    if (!s || s.active === false) continue;
    const cls = subToolClass(s.currentAction ? s.currentAction.tool : s.lastTool);
    if (cls in c) c[cls] += 1;
  }
  return c;
}
