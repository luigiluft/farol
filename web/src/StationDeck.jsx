// FAROL - StationDeck.jsx (v5 salas temáticas por empresa).
// O diorama fullscreen da Sala, reorganizado conforme a simulação v5
// validada com o dono (2026-06-23): HUD com chips de tripulação ->
// COMANDO (war-room de decisões) -> deck de 3 SALAS TEMÁTICAS por empresa
// (cada projeto vira uma sala com props do seu ramo) -> HANGAR e CAFÉ nas
// laterais -> ESTEIRA embaixo. Dados 100% reais (Sessions v3, prop sessions):
// agrupa por projeto (groupBays), estado decide tela/balão/beacon, cargo =
// tarefas one-shot. Mobília vem dos sprites HD do app (StationDeskSprite
// turbo, GamerChair, Avatar, Ship, CoffeeBar, HangarBreach); o tema (cor +
// props) vem de roomThemes.js. Stage de design fixo 1500x900 escalado por
// --sd-scale -> proporções pixel-fiéis ao mock em qualquer container.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  projectColor, shortModel, actionLabel, isAwaiting, agentCounts, tokenPct, workspaceOf,
} from './roomData.js';
import { callsign } from './callsigns.js';
import { AvatarSprite, MinionSprite } from './sprites.jsx';
import { StationDeskSprite, GamerChairSprite, CoffeeBarSprite, CouchSprite } from './station-sprites.jsx';
import { ShipSprite, ServerRackSprite } from './sprites-props.jsx';
import Graph from './Graph.jsx';
import WorkParticles from './WorkParticles.jsx';
import { themeFor } from './roomThemes.js';
import { WallClock, CrateProp, RadarScope } from './theme-props.jsx';
import './deck.css';

const STAGE_W = 1500;
const STAGE_H = 900;
const BAY_CAP = 4;       // salas visiveis no deck (resto vira "+N salas")
const AGENTS_PER_BAY = 4; // mesas visíveis por sala (resto vira "+N")
const MINION_CAP = 4;    // subagentes empoleirados por mesa
const CAFE_CAP = 5;      // ociosos visíveis no café
const FLY_MS = 1300;     // duração da decolagem pela brecha
const RESET_MS = 260;    // respiro antes da nave parada nova entrar
const PALETTE = ['#3ddc84', '#4dd0e1', '#ffb454', '#93a8c7', '#b48cfa', '#5ea2ff', '#c8e64c', '#ff8a5c'];

// ------------------------------------------------------------------
// hooks
// ------------------------------------------------------------------

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Escala o stage de design (1500x900) pra caber no container sem distorcer.
function useStageScale(ref) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) {
        setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H, 1.35));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

// HANGAR vivo: subagente NOVO entre snapshots => a nave parada igniza e
// DECOLA pela brecha (sobe e some "pro espaço/grafo"), depois reseta pra
// nave parada nova. Fila pra eventos no mesmo tick; seed não decola.
// reduced-motion: sem decolagem (snap). Porte do ciclo do RoomScene pro
// hangar de pad único da v5.
function useHangarLaunch(list, reduced) {
  const [ship, setShip] = useState({ phase: 'idle', key: 0, accent: '#4dd0e1', boardedId: null });
  const prevRef = useRef(null);
  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const timersRef = useRef(new Set());
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => () => { for (const t of timersRef.current) clearTimeout(t); }, []);

  const after = (ms, fn) => {
    const t = setTimeout(() => { timersRef.current.delete(t); fn(); }, ms);
    timersRef.current.add(t);
  };

  const pump = () => {
    if (busyRef.current || !queueRef.current.length) return;
    if (reducedRef.current) { queueRef.current.length = 0; return; }
    busyRef.current = true;
    const ev = queueRef.current.shift();
    seqRef.current += 1;
    setShip({ phase: 'launching', key: seqRef.current, accent: ev.accent, boardedId: ev.boardedId });
    after(FLY_MS, () => {
      seqRef.current += 1;
      setShip({ phase: 'idle', key: seqRef.current, accent: '#4dd0e1', boardedId: null });
      after(RESET_MS, () => { busyRef.current = false; pump(); });
    });
  };

  useEffect(() => {
    const cur = new Map();
    for (const s of list || []) {
      const subs = Array.isArray(s.subagents) ? s.subagents : [];
      const accent = projectColor(s.project);
      for (const sub of subs) {
        if (!sub || sub.active === false) continue;
        cur.set(`${s.id}:${sub.id}`, { accent, boardedId: String(sub.id) });
      }
    }
    const prev = prevRef.current;
    prevRef.current = cur;
    if (prev === null) return; // seed: não decola do estado inicial
    for (const [k, info] of cur) if (!prev.has(k)) queueRef.current.push(info);
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return ship;
}

// PRNG determinístico (mulberry32): cenografia estável entre renders, sem
// Math.random (mesma janela/holo/breach sempre, igual ao app).
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------
// cenografia estática (estrelas / holo / breach / bunting)
// ------------------------------------------------------------------

function useStarfield() {
  return useMemo(() => {
    const rng = makeRng(0x7e11a);
    const stars = [];
    for (let i = 0; i < 150; i += 1) {
      const big = rng() < 0.12;
      const sz = big ? 4 + rng() * 7 : 1 + rng() * 1.6;
      const c = big ? PALETTE[(rng() * PALETTE.length) | 0] : '#cfe6ff';
      stars.push({
        id: i, sz, x: rng() * 100, y: rng() * 100, c,
        op: big ? 0.85 : 0.3 + rng() * 0.5, glow: big ? sz * 2 : 0,
      });
    }
    const holo = [];
    for (let i = 0; i < 16; i += 1) {
      holo.push({ id: i, c: PALETTE[i % PALETTE.length], sz: 2 + rng() * 4, x: 20 + rng() * 60, y: 5 + rng() * 80 });
    }
    const breach = [];
    for (let i = 0; i < 22; i += 1) {
      breach.push({ id: i, sz: 1 + rng() * 1.5, x: rng() * 100, y: rng() * 70, op: 0.3 + rng() * 0.5 });
    }
    return { stars, holo, breach };
  }, []);
}

function Starfield({ stars }) {
  return (
    <span className="sd-stars" aria-hidden="true">
      {stars.map((s) => (
        <span
          key={s.id}
          className="sd-gx"
          style={{
            width: `${s.sz}px`, height: `${s.sz}px`, left: `${s.x}%`, top: `${s.y}%`,
            background: s.c, opacity: s.op, boxShadow: s.glow ? `0 0 ${s.glow}px ${s.c}` : undefined,
          }}
        />
      ))}
    </span>
  );
}

// ------------------------------------------------------------------
// agrupamento por projeto -> salas temáticas
// ------------------------------------------------------------------

// v5 segmentacao: agrupa por WORKSPACE (workspaceOf) — empresa real vira sala
// tematica; sessoes genericas se separam pela pasta/repo do trabalho atual.
function groupBays(seatable) {
  const map = new Map();
  for (const s of seatable) {
    const key = workspaceOf(s);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()]
    .map(([room, sessions]) => ({ room, sessions }))
    .sort((a, b) => b.sessions.length - a.sessions.length);
}

// Última ação real entre os agentes ATIVOS da sala (pro telão da sala).
function bayLastAction(sessions) {
  let best = null;
  for (const s of sessions) {
    if (s.state !== 'ativa') continue;
    const t = Date.parse(s.lastActivityTs || '') || 0;
    if (!best || t > best.t) best = { t, s };
  }
  const src = best ? best.s : sessions[0];
  return (src && actionLabel(src)) || (src && src.lastTool) || '—';
}

// Carga da sala (0..1): maior tokenPct entre os agentes -> barra do telão.
function bayLoad(sessions) {
  let max = 0;
  for (const s of sessions) max = Math.max(max, tokenPct(s.tokensOut));
  return max;
}

function modelRole(s) {
  if (s.state === 'dormindo') return 'dormindo';
  if (isAwaiting(s)) return shortModel(s.model).split('-')[0] || 'opus';
  if (s.state === 'ociosa') return 'ocioso';
  return shortModel(s.model).split('-')[0] || 'opus';
}

// Variante de design da Sala. Default 'a' (modulos fechados) desde 02/07 —
// escolhido pelo dono vendo A/B. Rollback = localStorage
// torre.salaVariant='off' (escape hatch, remover apos uma semana de uso);
// 'b' segue disponivel pra comparacao.
function readSalaVariant() {
  try {
    const v = window.localStorage.getItem('torre.salaVariant');
    if (v === 'off') return null;
    return v === 'b' ? 'b' : 'a';
  } catch {
    return 'a';
  }
}

// Apelido amigavel da pasta de trabalho quando a variante esta ativa: basename
// minusculo, com remap das pastas de sistema (temp/tmp => scratch, .claude =>
// config). Sem variante mantem o comportamento atual (pasta em CAPS).
function friendlyRoom(room) {
  const base = String(room || 'sessao').split(/[/\\]/).pop().toLowerCase();
  if (/^te?mp$/.test(base)) return 'scratch';
  if (base === '.claude') return 'config';
  return base;
}

function roomLabel(room, variant) {
  if (variant !== 'a' && variant !== 'b') return String(room || 'sessao').toUpperCase();
  return friendlyRoom(room);
}

// ------------------------------------------------------------------
// peças
// ------------------------------------------------------------------

function Chip({ kind, label, value }) {
  return (
    <div className={`sd-chip ${kind}`}>
      <span className="sd-chip-k"><span className="sd-chip-dot" />{label}</span>
      <span className="sd-chip-v">{value}</span>
    </div>
  );
}

// Subagentes-minions trabalhando pro agente: empoleirados acima da mesa.
function Minions({ subs, accent }) {
  const live = (subs || []).filter((x) => x && x.active !== false);
  if (live.length === 0) return null;
  const shown = live.slice(0, MINION_CAP);
  const extra = live.length - shown.length;
  return (
    <span className="sd-minions" style={{ '--c': accent }} aria-hidden="true">
      {shown.map((sub) => (
        <span key={sub.id} className="sd-minion" title={`${sub.label || sub.id}: ${actionLabel(sub) || 'pensando...'}`}>
          <MinionSprite tone={accent} />
        </span>
      ))}
      {extra > 0 ? <span className="sd-minion-more">+{extra}</span> : null}
    </span>
  );
}

// Workstation: mesa turbo + cadeira na cor do tema + avatar sentado +
// badge (callsign + papel) + minions dos subagentes. Acima: balão da ação
// (ativo) ou selo "esperando você" + beacon (encerrou o turno — fica na sala).
function Workstation({ session: s, accent, onSelect }) {
  const awaiting = isAwaiting(s);
  const screen = awaiting || s.state === 'ativa' ? 'on' : s.state === 'ociosa' ? 'dim' : 'off';
  const pose = s.state === 'ativa' || awaiting ? 'typing' : s.state === 'ociosa' ? 'idle' : 'sleep';
  const monitors = 2 + (Math.abs(hashId(s.id)) % 2);
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: s.id }) : null;
  const action = actionLabel(s) || 'pensando...';
  const subs = Array.isArray(s.subagents) ? s.subagents : [];
  return (
    <div
      className={`sd-ws${awaiting ? ' waiting' : ''}`}
      role={select ? 'button' : undefined}
      tabIndex={select ? 0 : undefined}
      title={`${s.project || 'sessao'} · ${callsign(s.id)} · ${s.state}`}
      onClick={select || undefined}
      onKeyDown={select ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
      style={select ? { cursor: 'pointer' } : undefined}
    >
      {awaiting ? (
        <>
          <span className="sd-beacon">!</span>
          <span className="sd-wait">ESPERANDO VOCÊ</span>
        </>
      ) : (
        <span className="sd-bubble">{action}</span>
      )}
      <div className="sd-figs">
        <span className="sd-floorline" />
        <span className="sd-chair"><GamerChairSprite color={accent} /></span>
        <span className="sd-av"><AvatarSprite id={s.id} uniform={accent} pose={pose} /></span>
        <span className="sd-deskwrap"><StationDeskSprite color={accent} monitors={monitors} screen={screen} /></span>
        <Minions subs={subs} accent={accent} />
      </div>
      <div className="sd-badge">
        <span className="sd-badge-nm">{callsign(s.id)}</span>
        <span className={`sd-badge-rl${s.state === 'ociosa' || s.state === 'dormindo' ? ' idle' : ''}`}>{modelRole(s)}</span>
      </div>
    </div>
  );
}

function hashId(id) {
  const s = String(id || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Sala temática: placa (nome + selo + contador) + parede (prop temático +
// telão de última ação + relógio) + chão (props temáticos + workstations).
function ThemedBay({ bay, onSelect, variant }) {
  const theme = themeFor(bay.room);
  const accent = theme.accent || projectColor(bay.room);
  const shown = bay.sessions.slice(0, AGENTS_PER_BAY);
  const hidden = bay.sessions.length - shown.length;
  const working = bay.sessions.filter((s) => s.state === 'ativa' && !isAwaiting(s)).length;
  const total = bay.sessions.length;
  const idleMod = working === 0 && total > 0;
  const Wall = theme.wall;
  const FloorL = theme.floorL;
  const FloorR = theme.floorR;
  const Brand = theme.brand;
  const variantClass = variant === 'a' ? ' sd-bay--a' : variant === 'b' ? ' sd-bay--b' : '';
  const roomName = roomLabel(bay.room, variant);
  return (
    <div className={`sd-bay${variantClass}`} style={{ '--c': accent }}>
      <div className="sd-ceil" />
      <div className="sd-fixture" />
      <div className="sd-plate">
        <span className="sd-plate-name">{roomName}</span>
        {Brand ? <span className="sd-plate-brand"><Brand accent={accent} /></span> : null}
        <span className={`sd-count${idleMod ? ' idle' : ''}`}>{working}/{total}</span>
      </div>
      <div className="sd-wallzone">
        <span className="sd-wallprop">{Wall ? <Wall accent={accent} /> : null}</span>
        <span className="sd-wallclock"><WallClock accent={accent} /></span>
        <div className="sd-modscreen">
          <span className="sd-modscreen-ttl">ÚLTIMA AÇÃO</span>
          <span className="sd-modscreen-act">{bayLastAction(bay.sessions)}</span>
          <div className="sd-modscreen-bar"><i style={{ width: `${Math.round(bayLoad(bay.sessions) * 100)}%` }} /></div>
        </div>
      </div>
      <div className="sd-modfloor">
        {variant === 'a' ? <span className="sd-door" aria-hidden="true" /> : null}
        {variant === 'b' ? <span className="sd-zone-label" aria-hidden="true">{roomName}</span> : null}
        <span className="sd-rug" />
        {FloorL ? <span className="sd-fll"><FloorL accent={accent} /></span> : null}
        {FloorR ? <span className="sd-flr"><FloorR accent={accent} /></span> : null}
        {shown.map((s) => <Workstation key={s.id} session={s} accent={accent} onSelect={onSelect} />)}
        {hidden > 0 ? <span className="sd-overflow-pill">+{hidden} na fila</span> : null}
      </div>
    </div>
  );
}

// COMANDO (war-room): mesa de decisões com o operador (coroa). Status =
// decisão pendente quando há agentes "esperando você"; senão, calmo.
function WarRoom({ waiting }) {
  const seats = [20, 80, 150, 210];
  return (
    <div className="sd-warroom">
      <div className="sd-warplate">COMANDO · DECISÕES</div>
      <div className="sd-holo" />
      <div className="sd-wartable"><div className="sd-wartable-glow" /></div>
      <div style={{ position: 'relative', height: 0 }}>
        {seats.map((x) => (
          <span key={x} className="sd-warchair" style={{ left: `${x}px`, bottom: '-2px' }} />
        ))}
        <div className="sd-warop">
          <span className="sd-crown">👑</span>
          <AvatarSprite id="operator-torre" uniform="#ffb454" pose="idle" />
        </div>
      </div>
      <div className={`sd-warstat ${waiting > 0 ? 'pend' : 'calm'}`}>
        {waiting > 0 ? `DECISÃO PENDENTE · ${waiting}` : 'sem decisão pendente'}
      </div>
    </div>
  );
}

function HangarBay({ breach, ship }) {
  const launching = ship.phase === 'launching';
  return (
    <div className="sd-sidebay left">
      <div className="sd-baylabel h">HANGAR</div>
      <div className="sd-hangar-inner">
        <div className="sd-breach">
          {breach.map((b) => (
            <span key={b.id} className="sd-bstar" style={{ width: `${b.sz}px`, height: `${b.sz}px`, left: `${b.x}%`, top: `${b.y}%`, opacity: b.op }} />
          ))}
        </div>
        <div className="sd-hangar-floor">
          <span className="sd-pad" />
          <span className="sd-pad-stripe" />
          <span className="sd-crate"><CrateProp accent="#4dd0e1" /></span>
          {/* a MESMA nave fica parada (bob) e decola (sobe e some pela
              brecha) — só muda a classe; key remonta no reset. */}
          <span key={ship.key} className={`sd-ship ${launching ? 'launching' : 'idle'}`}>
            <ShipSprite color={ship.accent} boardedId={launching ? ship.boardedId : null} flame={launching} width={60} />
          </span>
          <span className="sd-ship-shadow" />
        </div>
      </div>
    </div>
  );
}

function CafeBay({ idle }) {
  const buntColors = ['#3ddc84', '#ffb454', '#4dd0e1', '#93a8c7', '#b48cfa', '#c8e64c'];
  const shown = idle.slice(0, CAFE_CAP);
  const extra = idle.length - shown.length;
  return (
    <div className="sd-sidebay right">
      <div className="sd-baylabel c">CAFÉ</div>
      <div className="sd-cafe-inner">
        <div className="sd-bunting">{buntColors.map((c, i) => <i key={i} style={{ borderTopColor: c }} />)}</div>
        <div className="sd-cafe-wall">
          <div className="sd-coffee-bar"><CoffeeBarSprite /></div>
        </div>
        <div className="sd-cafe-floor">
          <span className="sd-sofa"><CouchSprite /></span>
          {shown.map((s) => (
            <span key={s.id} className="sd-cafe-agent" title={`${s.project || 'sessao'} · ${callsign(s.id)} · ${s.state}`}>
              <AvatarSprite id={s.id} uniform={projectColor(s.project)} pose={s.state === 'dormindo' ? 'sleep' : 'idle'} />
            </span>
          ))}
          {extra > 0 ? <span className="sd-overflow-pill" style={{ '--c': '#ffb454' }}>+{extra}</span> : null}
        </div>
      </div>
    </div>
  );
}

function CargoBelt({ cargo }) {
  const shown = cargo.slice(0, 8);
  return (
    <div className="sd-cargo">
      <span className="sd-cargo-lab">ESTEIRA</span>
      <div className="sd-belt">
        {shown.map((s, i) => {
          const done = isAwaiting(s);
          const left = done ? 84 : s.state === 'ativa' ? 45 : 12;
          return (
            <span
              key={s.id}
              className="sd-box"
              style={{ left: `${Math.min(84, left + i * 2)}%`, background: done ? '#c8e64c' : projectColor(s.project) }}
              title={`${s.project || 'tarefa'} · ${actionLabel(s) || ''}`}
            >
              {done ? '✓' : ''}
            </span>
          );
        })}
      </div>
      <span className="sd-cargo-lab">{cargo.length} {cargo.length === 1 ? 'tarefa' : 'tarefas'}</span>
    </div>
  );
}

// ------------------------------------------------------------------
// cena
// ------------------------------------------------------------------

export default function StationDeck({ sessions, error, onSelect }) {
  const reduced = useReducedMotion();
  const [salaVariant] = useState(readSalaVariant);
  const hostRef = useRef(null);
  const graphApiRef = useRef(null); // api do grafo da JANELA (foco/partículas)
  const scale = useStageScale(hostRef);
  const { stars, holo, breach } = useStarfield();
  const list = sessions || [];
  const ship = useHangarLaunch(list, reduced);
  const loaded = sessions !== null && sessions !== undefined;

  const seatable = useMemo(() => list.filter((s) => s.kind !== 'tarefa'), [list]);
  const cargo = useMemo(() => list.filter((s) => s.kind === 'tarefa'), [list]);
  // Estado -> local (faithful ao mock + RoomScene): ativo/esperando senta na
  // SALA (mesa); ocioso/dormindo vai pro CAFÉ. Sem duplicar agente.
  const deskAgents = useMemo(
    () => seatable.filter((s) => s.state === 'ativa' || isAwaiting(s)),
    [seatable],
  );
  const paused = useMemo(
    () => seatable.filter((s) => (s.state === 'ociosa' || s.state === 'dormindo') && !isAwaiting(s)),
    [seatable],
  );
  const bays = useMemo(() => groupBays(deskAgents), [deskAgents]);
  const shownBays = bays.slice(0, BAY_CAP);
  const counts = agentCounts(list);
  const idleForCafe = paused;

  return (
    <section ref={hostRef} className="panel station-deck" aria-label="Sala da Torre">
      <div className="sd-stage" style={{ '--sd-scale': scale }}>
        {/* HUD */}
        <div className="sd-hud">
          <div className="sd-brand"><span className="sd-mark" />FAROL · SALA</div>
          <div className="sd-live"><span className="sd-live-led" />AO VIVO · DECK 07</div>
          <div className="sd-chips">
            <Chip kind="crew" label="TRIPULAÇÃO" value={seatable.length} />
            <Chip kind="work" label="TRABALHANDO" value={counts.working} />
            <Chip kind="wait" label="ESPERANDO VOCÊ" value={counts.waiting} />
            <Chip kind="done" label="EM PAUSA" value={paused.length} />
          </div>
        </div>

        <div className="sd-ledstrip" style={{ left: '7%', width: '30%' }} />
        <div className="sd-ledstrip" style={{ left: '60%', width: '30%' }} />

        {/* janela: o UNIVERSO REAL do vault (grafo vivo embutido) atrás do
            starfield e da moldura — a "animação do espaço/grafo" de volta. */}
        <div className="sd-window">
          <Starfield stars={stars} />
          <div className="sd-window-graph">
            <Graph
              scope="global"
              embedded
              fitZoom={1.7}
              sessions={sessions}
              onReady={(api) => { graphApiRef.current = api; }}
            />
          </div>
          {/* foco + partículas no grafo da JANELA: o nó que os agentes
              trabalham acende + partículas nave->nó, dentro da própria Sala. */}
          <WorkParticles sessions={sessions} apiRef={graphApiRef} follow />
          <div className="sd-frame" />
          <div className="sd-mull" style={{ left: '33%' }} />
          <div className="sd-mull" style={{ left: '66%' }} />
        </div>
        <div className="sd-wall" />
        <div className="sd-floor" />

        {/* cenário "Torre de Controle": radar de controle + rack de servidores
            flanqueando o COMANDO (padrão da sala, segue o tema). */}
        <span className="sd-scenery sd-radar"><RadarScope accent="#4dd0e1" /></span>
        <span className="sd-scenery sd-rack"><ServerRackSprite /></span>

        {/* COMANDO + holo dots */}
        <WarRoom waiting={counts.waiting} />
        <span aria-hidden="true">
          {holo.map((d) => (
            <span
              key={d.id}
              className="sd-gxh"
              style={{
                position: 'absolute', left: `calc(50% - 115px + ${d.x * 2.3}px)`, top: `${214 + d.y * 0.42}px`,
                width: `${d.sz}px`, height: `${d.sz}px`, background: d.c, boxShadow: `0 0 6px ${d.c}`, opacity: 0.85, zIndex: 8,
              }}
            />
          ))}
        </span>

        {/* deck de salas (tematicas por empresa + por pasta de trabalho) */}
        <div className="sd-deck">
          {shownBays.map((bay) => <ThemedBay key={bay.room} bay={bay} onSelect={onSelect} variant={salaVariant} />)}
          {bays.length > shownBays.length ? (
            <div className="sd-bay-more" title={`mais ${bays.length - shownBays.length} sala(s) de trabalho`}>
              +{bays.length - shownBays.length}
              <span>salas</span>
            </div>
          ) : null}
        </div>

        {/* laterais */}
        <HangarBay breach={breach} ship={ship} />
        <CafeBay idle={idleForCafe} />

        {/* esteira */}
        {cargo.length > 0 ? <CargoBelt cargo={cargo} /> : (
          <div className="sd-cargo">
            <span className="sd-cargo-lab">ESTEIRA</span>
            <div className="sd-belt" />
            <span className="sd-cargo-lab">sem tarefa</span>
          </div>
        )}

        {/* atmosfera */}
        <div className="sd-vignette" />
        {!reduced ? <div className="sd-scan" /> : null}

        {!loaded ? <div className="sd-empty">sincronizando radar…</div> : null}
        {loaded && list.length === 0 ? <div className="sd-empty">deck vazio — aguardando tripulação</div> : null}
        {error ? <div className="sd-empty" style={{ color: '#ff5f56' }}>radar offline: {String(error)}</div> : null}
      </div>
    </section>
  );
}
