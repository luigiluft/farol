// FAROL - shell MOBILE: fila "esperando voce" (Onda mobile v2). Strip rosa
// COMPACTA no topo da aba Torre quando ha sessao aguardando input: resume
// "N esperando · mais antiga Xmin" e expande pra lista (callsign + ha quanto +
// acao; tap = dossie). Gate por isAwaiting de roomData (NUNCA awaitingInput cru:
// sessao encerrada vem com awaiting=true). fmtAgo e exportado e reusado pelo
// cockpit/hoje mobile (mesma frase "ha X" do Cockpit desktop, sem importa-lo).
import { useState } from 'react';
import { isAwaiting, projectColor } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import './mobile-fila.css';

// "ha X" desde o fim do turno da sessao: lastActivityTs (ISO) e, sem ele,
// secondsSinceEvent do payload. now e passado de fora (relogio que avanca sem
// SSE — o payload de uma sessao aguardando nao muda enquanto ela espera).
export function fmtAgo(session, now) {
  const ts = Date.parse((session && session.lastActivityTs) || '');
  let sec;
  if (Number.isFinite(ts)) {
    sec = (now - ts) / 1000;
  } else {
    const sse = Number(session && session.secondsSinceEvent);
    if (!Number.isFinite(sse)) return '';
    sec = sse;
  }
  const v = Math.max(0, Math.round(sec));
  if (v < 60) return v + 's';
  if (v < 3600) return Math.floor(v / 60) + 'min';
  if (v < 86400) return Math.floor(v / 3600) + 'h';
  return Math.floor(v / 86400) + 'd';
}

// Segundos "esperando" de UMA sessao, para achar a mais antiga da fila.
function waitSeconds(session, now) {
  const ts = Date.parse((session && session.lastActivityTs) || '');
  if (Number.isFinite(ts)) return Math.max(0, (now - ts) / 1000);
  const sse = Number(session && session.secondsSinceEvent);
  return Number.isFinite(sse) ? Math.max(0, sse) : 0;
}

export default function AwaitingStrip({ sessions, now, onSelect }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(sessions) ? sessions.filter(isAwaiting) : [];
  if (list.length === 0) return null;

  // Mais antiga = maior tempo de espera; rotulo curto no resumo.
  const oldest = list.reduce((a, b) => (waitSeconds(b, now) > waitSeconds(a, now) ? b : a), list[0]);
  const oldestAgo = fmtAgo(oldest, now);

  return (
    <section className={'mb-fila' + (open ? ' open' : '')} aria-label="Sessões esperando você">
      <button
        type="button"
        className="mb-fila-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mb-fila-dot" aria-hidden="true" />
        <span className="mb-fila-count">{list.length} esperando</span>
        {oldestAgo ? <span className="mb-fila-oldest">· mais antiga {oldestAgo}</span> : null}
        <span className="mb-fila-chev" aria-hidden="true">{open ? '⌄' : '›'}</span>
      </button>
      {open ? (
        <ul className="mb-fila-list">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="mb-fila-row"
                style={{ '--mb-accent': projectColor(s.project) }}
                onClick={() => onSelect({ type: 'session', sessionId: s.id })}
              >
                <span className="mb-fila-call">{callsign(s.id)}</span>
                <span className="mb-fila-ago">há {fmtAgo(s, now)}</span>
                <span className="mb-fila-act">{actionPhrase(s) || 'aguardando resposta'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
