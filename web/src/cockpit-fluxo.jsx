// FAROL - Olho da IA v3: FLUXO DE AÇÕES. Substitui o screenshot (EyePane) por
// "o que a frota está fazendo": pulse agregado da sessão-em-foco + uma FAIXA
// por drone (frase do agora + fita de chips coloridos pela ferramenta). Dado
// vem do payload de /api/sessions (subagents[].recentActions), zero fetch novo.
import { laneModel, pulseCounts } from './cockpit-fluxo-model.js';
import { droneCallsign } from './callsigns.js';
import './cockpit-fluxo.css';

const PULSE = [
  ['st-read', 'lendo'], ['st-shell', 'rodando'],
  ['st-write', 'editando'], ['st-search', 'consultando'],
];

function Chip({ c, now }) {
  return (
    <span className={`flx-chip ${c.cls}${now ? ' now' : ''}`}>
      <span className="g">{c.tool}</span>{c.target}
    </span>
  );
}

function Lane({ lm }) {
  return (
    <div className={`flx-lane${lm.active ? '' : ' idle'}`}>
      <div className="flx-h">
        <span className="flx-led" />
        <span className="flx-dc">{droneCallsign(lm.id)}</span>
        <span className="flx-ty">{lm.agentType}</span>
      </div>
      {lm.say ? <div className="flx-say">{lm.say}</div> : null}
      {lm.trail.length ? (
        <div className="flx-tape">
          {lm.trail.map((c, i) => (
            <Chip key={c.ts ?? i} c={c} now={i === lm.trail.length - 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FluxoPane({ session }) {
  const subs = session && Array.isArray(session.subagents) ? session.subagents : [];
  if (subs.length === 0) {
    return <div className="flx"><div className="flx-empty">sem drones ativos nesta sessão</div></div>;
  }
  const p = pulseCounts(subs);
  const lanes = subs.map(laneModel);
  // ativos primeiro, depois ociosos (o "fez" desce)
  lanes.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  return (
    <div className="flx">
      <div className="flx-pulse">
        {PULSE.map(([cls, label]) => (
          <div key={cls}>
            <span className={`flx-pn ${cls}`}>{p[cls]}</span>
            <span className="flx-pl">{label}</span>
          </div>
        ))}
      </div>
      <div className="flx-lanes">
        {lanes.map((lm) => <Lane key={lm.id} lm={lm} />)}
      </div>
    </div>
  );
}
