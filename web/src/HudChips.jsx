// FAROL - HudChips: o placar da tripulacao no estilo v5 (mesmo look dos
// chips da Sala) - TRIPULACAO / TRABALHANDO / ESPERANDO VOCE / EM PAUSA.
// Componente compartilhado pra padronizar o "placar" entre a Sala e o modo
// TORRE (antes a contagem vivia dispersa em TorreFlights + KPIs).
//
// Opt-in da TORRE (props novas; ignoradas por Sala/mobile que nao as passam):
//   waitQueue + onSelect -> o chip ESPERANDO VOCE vira clicavel e abre a FILA
//     (uma linha por sessao awaiting, espera MAIS ANTIGA no topo, "ha Xmin"
//     ao vivo). Clique na linha => onSelect({type:'session', sessionId}).
//   onGoView -> renderiza o botao "explorar" (troca pra view do grafo).
// Sem essas props o chip segue estatico igual antes (zero risco fora da Torre).
import { useEffect, useMemo, useRef, useState } from 'react';
import { agentCounts, isAwaiting } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import MiniAvatar from './MiniAvatar.jsx';
import './hud-chips.css';

const QUEUE_TICK_MS = 30000; // "ha Xmin" ao vivo (re-render a cada ~30s)

// lastActivityTs pode vir epoch (number) ou ISO (string) - server v2/v3.
function tsOf(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function waitMinutes(ts, now) {
  const t = tsOf(ts);
  if (!t) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
}

// linha da fila usa prefixo ("ha 12min"); badge do chip usa so o corpo ("12min").
function waitLabel(mins, withPrefix) {
  if (mins === null) return '';
  if (mins < 1) return withPrefix ? 'agora' : '';
  const body = mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h`;
  return withPrefix ? `há ${body}` : body;
}

// esperando voce, espera MAIS ANTIGA primeiro (menor lastActivityTs no topo;
// ts ausente vai pro fim). isAwaiting ja exclui sessao dormindo (sinal velho).
function buildQueue(waitQueue) {
  const list = Array.isArray(waitQueue) ? waitQueue : [];
  return list.filter((s) => isAwaiting(s)).slice().sort(
    (a, b) => (tsOf(a.lastActivityTs) || Infinity) - (tsOf(b.lastActivityTs) || Infinity),
  );
}

// uma linha da fila: rosto + callsign + tempo de espera + acao truncada.
function WaitRow({ session, now, onSelect }) {
  const phrase = actionPhrase(session);
  const ago = waitLabel(waitMinutes(session.lastActivityTs, now), true);
  return (
    <li>
      <button
        type="button"
        className="hudc-q-row"
        title={phrase || callsign(session.id)}
        onClick={() => onSelect({ type: 'session', sessionId: session.id })}
      >
        <MiniAvatar session={session} width={14} />
        <span className="hudc-q-name">{callsign(session.id)}</span>
        <span className="hudc-q-ago">{ago}</span>
        <span className="hudc-q-act">{phrase}</span>
      </button>
    </li>
  );
}

// dropdown da FILA ancorado abaixo do chip.
function WaitQueue({ queue, now, onSelect }) {
  return (
    <div className="hudc-queue" role="menu" aria-label="Fila esperando você">
      <ul className="hudc-q-list">
        {queue.map((s) => (
          <WaitRow key={s.id} session={s} now={now} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

// chip ESPERANDO VOCE interativo: botao que abre/fecha a FILA + badge de tempo
// ("3 · 12min", a espera mais antiga). Esc / clique-fora fecham; tick ~30s.
function WaitChip({ waiting, queue, onSelect }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), QUEUE_TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const oldest = queue.length ? waitMinutes(queue[0].lastActivityTs, now) : null;
  const compact = waitLabel(oldest, false);
  const badge = compact ? `${waiting} · ${compact}` : String(waiting);

  return (
    <div className="hudc-chip wait is-btn" ref={rootRef}>
      <button
        type="button"
        className="hudc-chip-face"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Esperando você: ${waiting}. Abrir a fila.`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hudc-k"><span className="hudc-dot" />ESPERANDO VOCÊ</span>
        <span className="hudc-v">{badge}</span>
      </button>
      {open ? (
        <WaitQueue queue={queue} now={now} onSelect={(sel) => { setOpen(false); onSelect(sel); }} />
      ) : null}
    </div>
  );
}

export default function HudChips({ sessions, className = '', waitQueue = null, onSelect, onGoView }) {
  const list = Array.isArray(sessions) ? sessions : [];
  const seatable = list.filter((s) => s && s.kind !== 'tarefa');
  const { working, waiting } = agentCounts(list);
  const paused = seatable.filter(
    (s) => (s.state === 'ociosa' || s.state === 'dormindo') && !isAwaiting(s),
  ).length;

  const queue = useMemo(() => buildQueue(waitQueue), [waitQueue]);
  const interactive = queue.length > 0 && typeof onSelect === 'function';

  const chips = [
    { k: 'crew', label: 'TRIPULAÇÃO', value: seatable.length },
    { k: 'work', label: 'TRABALHANDO', value: working },
    { k: 'wait', label: 'ESPERANDO VOCÊ', value: waiting },
    { k: 'done', label: 'EM PAUSA', value: paused },
  ];

  return (
    <div className={`hudc-strip${className ? ` ${className}` : ''}`} aria-label="Placar da tripulação">
      {chips.map((c) => (
        c.k === 'wait' && interactive
          ? <WaitChip key={c.k} waiting={waiting} queue={queue} onSelect={onSelect} />
          : (
            <div key={c.k} className={`hudc-chip ${c.k}`}>
              <span className="hudc-k"><span className="hudc-dot" />{c.label}</span>
              <span className="hudc-v">{c.value}</span>
            </div>
          )
      ))}
      {typeof onGoView === 'function' ? (
        <button
          type="button"
          className="hudc-explore"
          title="Explorar o universo no grafo"
          aria-label="Explorar o universo no grafo"
          onClick={() => onGoView('grafo')}
        >
          🔭
        </button>
      ) : null}
    </div>
  );
}
