// FAROL - Sala 3.0 (A3, F4) + re-skin MODULO DE ESTACAO (S3, F5.10).
// Dois niveis com os MESMOS dados:
// - painel compacto (tambem vira o deck de comando do modo TORRE):
//   baias como modulos de estacao (janelinha de estrelas com drift,
//   parede com ribs, porta de modulo com vigia circular, nameplate
//   metalico, faixa de piso na cor), AVATAR UNICO deterministico por
//   sessao (gerarAvatar) sentado em cadeira gamer side-view, caneca
//   com vapor, ticker da currentAction completa com marquee, anel de
//   estado, relogio mm:ss vivo, mini-barra de tokens e minions
//   clicaveis; cargas com container na cor do projeto.
// - tab Sala full-screen: diorama isometrico (RoomScene.jsx, F3).
// F5.10 muda SO o visual: contratos, props e caps intactos.
//
// CONTRATOS NOVOS (para o integrador / A4):
// - <Room/> aceita props opcionais:
//   onSelect({type:'session'|'subagent', sessionId, subagentId?})
//     clique/Enter em mesa ou carga (type session) e em minion
//     (type subagent). Sem a prop, nada e clicavel (compat F3).
//   onDeskMount(sessionId, el)
//     ancora DOM da mesa para as sondas do modo TORRE: chamado com o
//     elemento no mount e com null no unmount. Passar callback ESTAVEL
//     (useCallback/useRef) para nao ciclar mount/unmount.
//   sessions / error
//     override de dados (SessionsProvider do A4): quando sessions !==
//     undefined o hook interno useSessions NAO roda (zero SSE extra).
//     fullscreen segue delegando ao RoomScene (props repassadas).
// - getDeskAnchorRegistry(): Map sessionId -> elemento DOM da mesa
//   (global, last-mounted-wins; com 2 salas montadas prefira o
//   onDeskMount da instancia que interessa).
// Compat preservada: re-exports de roomData e FlightBoard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useSessions, projectColor, plateName, flightCode,
  shortModel, fmtTokens, tokenPct, actionLabel, flightTime, isAwaiting, activityLabel,
} from './roomData.js';
import { callsign } from './callsigns.js';
import {
  DeskSprite, AvatarSprite, MinionAvatarSprite, LedSprite, ZzzSprite, CargoDroneSprite,
} from './sprites.jsx';
import { GamerChairSprite, SteamPuffs, WarnPlate } from './station-sprites.jsx';
import StationDeck from './StationDeck.jsx';
import './room.css';

export {
  PROJECT_PALETTE, projectColor, extractSessions, normalizeSession,
  useSessions, shortModel, fmtTokens,
} from './roomData.js';
export { FlightBoard } from './FlightBoard.jsx';

const MAX_DESKS = 8;
const MAX_DOCK_MINIONS = 4;
const MAX_CARGO = 10;
const BURST_MS = 3000;
const DOOR_MS = 1500;
const SEED_ARM_MS = 800;

// ------------------------------------------------------------------
// registro global de ancoras de mesa (modo TORRE ancora sondas aqui
// quando nao quer passar onDeskMount). Map sessionId -> elemento.
// ------------------------------------------------------------------

const deskAnchors = new Map();

export function getDeskAnchorRegistry() {
  return deskAnchors;
}

function useDeskAnchor(sessionId, onDeskMount) {
  const lastElRef = useRef(null);
  return useCallback((el) => {
    if (el) {
      lastElRef.current = el;
      deskAnchors.set(sessionId, el);
    } else {
      if (deskAnchors.get(sessionId) === lastElRef.current) deskAnchors.delete(sessionId);
      lastElRef.current = null;
    }
    if (onDeskMount) onDeskMount(sessionId, el);
  }, [sessionId, onDeskMount]);
}

// Handlers de clique+teclado para superficies selecionaveis.
function pressProps(fn) {
  if (!fn) return {};
  return {
    role: 'button',
    onClick: fn,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    },
  };
}

// ------------------------------------------------------------------
// F5.10: janelinha de estrelas da baia (faixa fina de janela do
// modulo). Estrelas = rects estaticos deterministas pelo projeto;
// o grupo e duplicado e ganha UMA classe de drift lento (transform).
// Zero aleatorio por render: mesmo projeto = mesma janela sempre.
// ------------------------------------------------------------------

const BAY_WIN_W = 96;
const BAY_WIN_H = 7;
const BAY_WIN_STARS = 14;

function hash32(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function starTone(t) {
  if (t > 0.86) return '#4dd0e1';
  if (t > 0.5) return '#c9d4dd';
  return '#5d6b78';
}

function buildBayStars(seed) {
  let h = hash32(seed);
  const next = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const out = [];
  for (let i = 0; i < BAY_WIN_STARS; i += 1) {
    out.push({
      x: Math.floor(next() * BAY_WIN_W),
      y: 1 + Math.floor(next() * (BAY_WIN_H - 2)),
      tone: starTone(next()),
    });
  }
  return out;
}

function BayWindow({ seed }) {
  const stars = useMemo(() => buildBayStars(seed), [seed]);
  const cells = (dx) => stars.map((s, i) => (
    <rect key={`${dx}-${i}`} x={s.x + dx} y={s.y} width={1} height={1} fill={s.tone} />
  ));
  return (
    <span className="bay-window" aria-hidden="true">
      <svg
        viewBox={`0 0 ${BAY_WIN_W} ${BAY_WIN_H}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        focusable="false"
      >
        <g className="bw-drift">
          {cells(0)}
          {cells(BAY_WIN_W)}
        </g>
      </svg>
    </span>
  );
}

// ------------------------------------------------------------------
// pulso de atividade: registra timestamp de burst por sessao quando o
// lastTool muda (ignora o seed inicial e sessoes recem-chegadas)
// ------------------------------------------------------------------

function useBursts(sessions) {
  const toolsRef = useRef(new Map());
  const seededRef = useRef(false);
  const [bursts, setBursts] = useState({});

  useEffect(() => {
    if (!sessions) return;
    const fresh = {};
    for (const s of sessions) {
      const prev = toolsRef.current.get(s.id);
      toolsRef.current.set(s.id, s.lastTool || null);
      if (seededRef.current && prev !== undefined && s.lastTool && prev !== s.lastTool) {
        fresh[s.id] = Date.now();
      }
    }
    seededRef.current = true;
    if (Object.keys(fresh).length > 0) setBursts((b) => ({ ...b, ...fresh }));
  }, [sessions]);

  return bursts;
}

// Cada mesa gerencia sua propria janela de 3s a partir do timestamp.
function useBurstWindow(burstTs) {
  const [bursting, setBursting] = useState(false);
  useEffect(() => {
    if (!burstTs) return undefined;
    setBursting(true);
    const timer = setTimeout(() => setBursting(false), BURST_MS);
    return () => clearTimeout(timer);
  }, [burstTs]);
  return bursting;
}

// Relogio de 1s para o contador mm:ss; pausa com a aba oculta.
function useNowTicker(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

// Arma as animacoes de porta DEPOIS do seed inicial (senao toda baia
// abriria porta no primeiro load).
function useSeedArmed(sessions) {
  const loaded = sessions !== null;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!loaded || armed) return undefined;
    const t = setTimeout(() => setArmed(true), SEED_ARM_MS);
    return () => clearTimeout(t);
  }, [loaded, armed]);
  return armed;
}

// Porta da baia: abre por DOOR_MS quando o conjunto de sessoes da baia
// muda (entrada OU saida de agente). idsKey = ids ordenados.
function useBayDoor(idsKey, armed) {
  const prevRef = useRef(null);
  const [pulse, setPulse] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = idsKey;
    if (prev === idsKey) return;
    if (prev === null && !armed) return;
    setPulse(Date.now());
  }, [idsKey, armed]);

  useEffect(() => {
    if (!pulse) return undefined;
    setOpen(true);
    const t = setTimeout(() => setOpen(false), DOOR_MS);
    return () => clearTimeout(t);
  }, [pulse]);

  return open;
}

// ------------------------------------------------------------------
// agrupamento em baias + alocacao de mesas (cap global de 8;
// excedente vive so no painel de voos, nada e ignorado)
// ------------------------------------------------------------------

function groupBays(list) {
  const map = new Map();
  for (const s of list) {
    const key = s.project || 'sessao';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()].map(([project, group]) => ({ project, sessions: group }));
}

function allocateDesks(bays, cap) {
  let used = 0;
  const out = [];
  for (const bay of bays) {
    const take = Math.min(bay.sessions.length, Math.max(0, cap - used));
    used += take;
    if (take > 0) {
      out.push({
        project: bay.project,
        desks: bay.sessions.slice(0, take),
        hidden: bay.sessions.length - take,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------
// dados por mesa: ticker da acao completa, tooltip, tokens, minions
// ------------------------------------------------------------------

// Acao COMPLETA: tool > detail (caminho/comando inteiro) com fallback.
function fullActionText(s) {
  const a = s.currentAction;
  if (a && a.tool) {
    const target = a.detail || a.target;
    return target ? `${a.tool} > ${target}` : a.tool;
  }
  return s.lastTool || 'sem acao';
}

// Linha-ticker sob a mesa: mede overflow e vira marquee (transform).
function ActionTicker({ session }) {
  const text = fullActionText(session);
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = textRef.current;
    if (!wrap || !inner) return;
    const over = inner.scrollWidth - wrap.clientWidth;
    setShift(over > 4 ? over : 0);
  }, [text]);

  const style = shift > 0
    ? { '--tk-shift': `-${shift}px`, '--tk-dur': `${Math.max(4, shift / 16).toFixed(1)}s` }
    : undefined;
  return (
    <div ref={wrapRef} className="desk-ticker" title={text}>
      <span ref={textRef} className={`tk-text${shift > 0 ? ' tk-scroll' : ''}`} style={style}>
        {text}
      </span>
    </div>
  );
}

function DeskTooltip({ session, subCount }) {
  return (
    <div className="desk-tooltip" role="tooltip">
      <div className="tt-title">{session.project || 'sessao'}</div>
      <div className="tt-row"><span className="tt-key">estado</span><span>{session.state}</span></div>
      <div className="tt-row"><span className="tt-key">modelo</span><span>{shortModel(session.model)}</span></div>
      <div className="tt-row"><span className="tt-key">acao</span><span>{actionLabel(session) || 'n/d'}</span></div>
      <div className="tt-row"><span className="tt-key">tokens out</span><span>{fmtTokens(session.tokensOut)}</span></div>
      <div className="tt-row"><span className="tt-key">subagentes</span><span>{subCount}</span></div>
      {session.promptPreview ? <div className="tt-preview">{session.promptPreview}</div> : null}
    </div>
  );
}

function TokenMeter({ tokens, accent }) {
  const label = tokens === null || tokens === undefined
    ? 'tokens out: n/d'
    : `tokens out: ${Math.round(tokens).toLocaleString('pt-BR')}`;
  return (
    <span className="token-meter" title={label}>
      <span
        className="token-fill"
        style={{ transform: `scaleX(${tokenPct(tokens).toFixed(3)})`, background: accent }}
      />
    </span>
  );
}

// Minions unicos pousados no topo do monitor; cada um clicavel.
function MinionDock({ session, onSelect }) {
  const subs = Array.isArray(session.subagents)
    ? session.subagents.filter((x) => x && x.active)
    : [];
  if (subs.length === 0) return null;
  const shown = subs.slice(0, MAX_DOCK_MINIONS);
  const extra = subs.length - shown.length;
  return (
    <span className="mdock">
      {shown.map((sub) => (
        <button
          key={sub.id}
          type="button"
          className="mdock-bot"
          title={`${sub.label || sub.id}: ${actionLabel(sub) || 'pensando...'}`}
          aria-label={`Subagente ${sub.label || sub.id}`}
          onClick={(e) => {
            e.stopPropagation();
            if (onSelect) onSelect({ type: 'subagent', sessionId: session.id, subagentId: sub.id });
          }}
        >
          <MinionAvatarSprite label={sub.label || sub.id} className="mdock-sprite" width={14} />
        </button>
      ))}
      {extra > 0 ? <span className="drone-badge mdock-badge">+{extra}</span> : null}
    </span>
  );
}

function deskPose(state) {
  if (state === 'ativa') return 'typing';
  if (state === 'dormindo') return 'sleep';
  return 'idle';
}

function Desk({ session, accent, burstTs, now, onSelect, onDeskMount }) {
  const bursting = useBurstWindow(burstTs);
  const anchorRef = useDeskAnchor(session.id, onDeskMount);
  const subs = Array.isArray(session.subagents)
    ? session.subagents.filter((x) => x && x.active)
    : [];
  const { state } = session;
  const awaiting = isAwaiting(session);
  const screen = awaiting || state === 'ativa' ? 'on' : state === 'ociosa' ? 'dim' : 'off';
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: session.id }) : null;
  return (
    <div
      ref={anchorRef}
      className={`desk-cell desk-${state}${awaiting ? ' desk-espera' : ''}${bursting ? ' desk-burst' : ''}${select ? ' desk-sel' : ''}`}
      tabIndex={0}
      {...pressProps(select)}
    >
      {awaiting ? (
        <div className="desk-wait" title="terminou o turno — esperando sua resposta">
          <span className="desk-wait-dot" aria-hidden="true" />
          {session.kind === 'tarefa' ? 'concluído' : 'esperando você'}
        </div>
      ) : null}
      <div className="desk-stage" key={bursting ? `burst-${burstTs}` : 'base'}>
        <DeskSprite screen={screen} accent={accent} />
        <span className="desk-chair" aria-hidden="true">
          <GamerChairSprite color={accent} side />
        </span>
        <LedSprite className="desk-led" state={state} />
        <span className={`desk-ring desk-ring-${state}`} aria-hidden="true" />
        <AvatarSprite id={session.id} uniform={accent} pose={deskPose(state)} className="desk-operator" />
        <span className="desk-steam" aria-hidden="true">
          <SteamPuffs delay={0} />
        </span>
        {state === 'dormindo' ? <ZzzSprite className="desk-zzz" /> : null}
        <MinionDock session={session} onSelect={onSelect} />
      </div>
      <ActionTicker session={session} />
      <div className="desk-meta">
        <TokenMeter tokens={session.tokensOut} accent={accent} />
        <span className={`desk-clock${state === 'ativa' ? ' on' : ''}`}>
          {flightTime(session.startedTs, now)}
        </span>
      </div>
      <div className="desk-plate" title={`${session.project || 'sessao'} · ${flightCode(session.id)}`}>
        {callsign(session.id)}
      </div>
      <DeskTooltip session={session} subCount={subs.length} />
    </div>
  );
}

// ------------------------------------------------------------------
// baia = modulo de estacao (F5.10): trim neon, janelinha de estrelas,
// porta de modulo com vigia circular (mesma animacao DOOR_MS),
// nameplate metalico, faixa de piso na cor do projeto
// ------------------------------------------------------------------

function Bay({ bay, bursts, now, armed, onSelect, onDeskMount }) {
  const accent = projectColor(bay.project);
  const idsKey = bay.desks.map((s) => s.id).sort().join('|');
  const doorOpen = useBayDoor(idsKey, armed);
  const live = bay.desks.some((s) => s.state === 'ativa');
  const total = bay.desks.length + bay.hidden;
  return (
    <section
      className={`bay bay-sci${live ? ' bay-live' : ''}`}
      style={{ '--bay-accent': accent }}
    >
      <span className="bay-trim" aria-hidden="true" />
      <span className={`bay-door${doorOpen ? ' is-open' : ''}`} aria-hidden="true">
        <span className="bay-door-glow" />
        <span className="bay-door-leaf bd-l" />
        <span className="bay-door-leaf bd-r" />
      </span>
      <header className="bay-plate">
        <span className="bay-name bay-metal" title={bay.project}>{plateName(bay.project)}</span>
        <span className="bay-count">{bay.hidden > 0 ? `${bay.desks.length}/${total}` : total}</span>
      </header>
      <BayWindow seed={bay.project} />
      <div className="bay-desks">
        {bay.desks.map((s) => (
          <Desk
            key={s.id}
            session={s}
            accent={accent}
            burstTs={bursts[s.id]}
            now={now}
            onSelect={onSelect}
            onDeskMount={onDeskMount}
          />
        ))}
      </div>
      <span className="bay-floor" aria-hidden="true"><span className="bay-floor-flow" /></span>
    </section>
  );
}

// ------------------------------------------------------------------
// esteira de cargas: sessoes kind=tarefa nao ocupam mesa
// ------------------------------------------------------------------

// Drone de carga + container na cor do projeto (F5.10): o conjunto
// inteiro faz o bob; clique/teclado e tooltip continuam identicos.
function CargoItem({ session, onSelect }) {
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: session.id }) : null;
  const accent = projectColor(session.project);
  return (
    <span
      className={`cargo-item cargo-${session.state}${select ? ' desk-sel' : ''}`}
      tabIndex={0}
      {...pressProps(select)}
    >
      <span className="cargo-lift" aria-hidden="true">
        <CargoDroneSprite className="cargo-drone" />
        <span className="cargo-box" style={{ background: accent }} />
      </span>
      <span className="desk-tooltip cargo-tooltip" role="tooltip">
        <span className="tt-title">{session.project || 'sessao'}</span>
        <span className="tt-row"><span className="tt-key">acao</span><span>{actionLabel(session) || 'n/d'}</span></span>
        <span className="tt-row"><span className="tt-key">tokens out</span><span>{fmtTokens(session.tokensOut)}</span></span>
        {session.promptPreview ? <span className="tt-preview">{session.promptPreview}</span> : null}
      </span>
    </span>
  );
}

function CargoBelt({ cargo, onSelect }) {
  if (!cargo || cargo.length === 0) return null;
  const shown = cargo.slice(0, MAX_CARGO);
  const extra = cargo.length - shown.length;
  return (
    <div className="cargo-belt" aria-label="Esteira de tarefas automaticas">
      <span className="cargo-label" title="execucoes automaticas one-shot (sem conversa)">tarefas</span>
      <div className="cargo-rail">
        <span className="cargo-track" aria-hidden="true" />
        {shown.map((s) => <CargoItem key={s.id} session={s} onSelect={onSelect} />)}
        {extra > 0 ? <span className="cargo-badge">+{extra}</span> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Sala: compacta no painel/deck; diorama na tab full-screen
// ------------------------------------------------------------------

function splitSessions(sessions) {
  const list = sessions || [];
  return {
    interactive: list.filter((s) => s.kind !== 'tarefa'),
    cargo: list.filter((s) => s.kind === 'tarefa'),
  };
}

// Resumo derivado do deck: overflow vai pro painel de voos, nada some.
function deckStats(sessions, split, bays) {
  const shown = bays.reduce((n, b) => n + b.desks.length, 0);
  return {
    overflow: split.interactive.length - shown,
    loaded: sessions !== null,
    isEmpty: sessions !== null && sessions.length === 0,
    activity: activityLabel(sessions),
  };
}

// Header do modulo: titulo, placa de aviso pixel (S1) e contador.
function RoomHeader({ loaded, activity, overflow }) {
  return (
    <header className="room-header">
      <span className="room-title">sala da torre</span>
      <span className="room-right">
        <span className="room-warn" aria-hidden="true"><WarnPlate text="DECK 07" /></span>
        <span className="room-meta">
          {loaded ? activity : 'sincronizando...'}
          {overflow > 0 ? ` / +${overflow} no painel` : ''}
        </span>
      </span>
    </header>
  );
}

function RoomBody({ fullscreen = false, sessions = null, error = null, onSelect, onDeskMount }) {
  const bursts = useBursts(sessions);
  const now = useNowTicker(1000);
  const armed = useSeedArmed(sessions);
  const split = useMemo(() => splitSessions(sessions), [sessions]);
  const bays = useMemo(
    () => allocateDesks(groupBays(split.interactive), MAX_DESKS),
    [split.interactive],
  );

  if (fullscreen) {
    // v5 salas temáticas por empresa (StationDeck). RoomScene.jsx fica em
    // disco como fallback/referência; onDeskMount não se aplica à v5.
    return (
      <StationDeck sessions={sessions} error={error} onSelect={onSelect} />
    );
  }

  const { overflow, loaded, isEmpty, activity } = deckStats(sessions, split, bays);

  return (
    <section
      className={`panel room${isEmpty ? ' room-dim' : ''}${onSelect ? ' room-select' : ''}`}
      aria-label="Sala da Torre"
    >
      <div className="room-inner">
        <RoomHeader loaded={loaded} activity={activity} overflow={overflow} />
        <div className="room-bays">
          {bays.map((bay) => (
            <Bay
              key={bay.project}
              bay={bay}
              bursts={bursts}
              now={now}
              armed={armed}
              onSelect={onSelect}
              onDeskMount={onDeskMount}
            />
          ))}
        </div>
        <CargoBelt cargo={split.cargo} onSelect={onSelect} />
        {isEmpty ? <div className="room-empty-msg">nenhum agente ativo agora</div> : null}
        {error ? <div className="room-error">radar offline: {error}</div> : null}
      </div>
      <div className="room-crt" aria-hidden="true" />
    </section>
  );
}

// Quando o pai NAO fornece sessions, a sala busca sozinha (compat F3).
function RoomSelf(props) {
  const { sessions, error } = useSessions();
  return <RoomBody {...props} sessions={sessions} error={error} />;
}

export default function Room(props) {
  if (props && props.sessions !== undefined) return <RoomBody {...props} />;
  return <RoomSelf {...(props || {})} />;
}
