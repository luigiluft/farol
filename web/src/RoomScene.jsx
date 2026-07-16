// FAROL - F5.10 A ESTACAO (S2). O diorama da Sala vira o INTERIOR
// de uma estacao espacial: janela panoramica com as galaxias do vault,
// teto com ribs + strip LED, piso de chapas, workstations com cadeira
// gamer na cor do projeto, area de cafe com vapor, lounge com sofa,
// HANGAR aberto ao espaco e doca de carga (composicao em station-areas.jsx).
// Dados 100% reais via Sessions v3 (prop sessions) + /api/stats no
// telao diegetico (migrado para a parede de fundo, maquinaria intacta).
// ESTADO -> LOCAL (nucleo da fase 3): ativa => workstation (typing);
// ociosa => cafe (hash32 par, de pe com caneca) ou lounge (impar, no
// sofa); dormindo => sleep no lounge com Zzz; kind tarefa => doca de
// carga. S2.2: o dormitorio foi SUBSTITUIDO pelo HANGAR -- subagent
// novo => avatar embarca numa nave grande, igniza e DECOLA pela brecha
// (saida ao espaco). Transicao de estado reusa o walk existente entre
// ancoras fixas (vetor ancora antiga -> nova nas vars --wx/--wy);
// reduced-motion = snap (zero walk, zero particulas, zero vapor).
// Perf: toda animacao DOM e transform/opacity; ticker de 1s pausa com
// a aba oculta; nenhum scroll listener; detalhe denso = SVG estatico.
// F7 (C6): zonas com divisorias de vidro + placas + faixas (AreaZones).
// Redesign painel-de-operacao (2026-06-18, pedido do dono): BIBLIOTECA
// removida (decoracao); a parede central vira QUADRO DE CHAMADAS (CallsBoard)
// = so quem ENCERROU o turno e espera voce, em rosa; telao ganha PASTA QUENTE;
// baia que espera ganha AURA rosa gritante (su-espera); decoracao morta do
// lounge (planta/gato/luminaria/mesinha) cortada.
// Refino anti-ruido (2026-06-12): WowDecor removido; telao painel SLIM;
// HUD da mesa = callsign + projeto, relogio so na mesa ativa.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  projectColor, flightCode, shortModel, fmtTokens,
  tokenPct, actionLabel, flightTime, isAwaiting,
} from './roomData.js';
import { callsign } from './callsigns.js';
import { useStats } from './StatsBar.jsx';
import { AvatarSprite, DoorSprite, MinionSprite, ZzzSprite } from './sprites.jsx';
import { ShipSprite } from './sprites-props.jsx';
import {
  StationDeskSprite, GamerChairSprite, SippingAvatar,
} from './station-sprites.jsx';
import { GROUP_STYLES, hash32 } from './graph-universe.js';
import {
  StationShell, CoffeeArea, LoungeArea, HoloTableArea, HangarBay, CargoDock,
  AreaZones,
} from './station-areas.jsx';
import './scene.css';

// Cores das galaxias do universo: janela panoramica + holotable.
const GALAXY_COLORS = GROUP_STYLES.map((g) => g.color);

// Mesas em 3 fileiras pseudo-isometricas (fracoes da cena + escala por
// profundidade). Ordem do array = prioridade de alocacao (frente primeiro).
const SLOTS = [
  { x: 0.57, y: 0.86, s: 1.0 },
  { x: 0.50, y: 0.67, s: 0.88 },
  { x: 0.33, y: 0.86, s: 1.0 },
  { x: 0.80, y: 0.86, s: 1.0 },
  { x: 0.26, y: 0.67, s: 0.88 },
  { x: 0.74, y: 0.67, s: 0.88 },
  { x: 0.52, y: 0.51, s: 0.76 },
  { x: 0.30, y: 0.51, s: 0.76 },
  { x: 0.74, y: 0.51, s: 0.76 },
];

// Porta de modulo na parede direita (entrada/saida da tripulacao).
const DOOR_POS = { x: 0.945, y: 0.42 };

// Ancoras fixas por area (mesma convencao dos SLOTS). Cafe = de pe no
// balcao; lounge = sentado no sofa; lounge-sleep = quem dorme (sem
// dormitorio, dorme no canto do lounge com Zzz).
const CAFE_SPOTS = [
  { x: 0.862, y: 0.645, s: 0.85 },
  { x: 0.906, y: 0.655, s: 0.85 },
  { x: 0.836, y: 0.665, s: 0.86 },
];
const LOUNGE_SEATS = [
  { x: 0.885, y: 0.845, s: 1.0 },
  { x: 0.925, y: 0.85, s: 1.0 },
];
const LOUNGE_NAP = { x: 0.948, y: 0.875, s: 1.0 };
const DESK_AGENT_DY = -0.028; // avatar senta um tico acima da ancora do slot

// DOCA DE NAVES (S2.2): plataformas no HANGAR (parede esquerda). Cada
// plataforma tem SEMPRE uma nave grande parada (idle bob). Um subagent
// novo => a PROPRIA nave parada daquela plataforma roda o ciclo no
// lugar: embarca (piloto caminha pra dentro), igniza (cockpit acende +
// chama), DECOLA pela brecha (a MESMA nave grande sobe e some). Quando
// ela sai, a plataforma reseta com uma nave nova, pronta pro proximo.
// Nao existe nave pequena/secundaria. Centro de cada plataforma em
// fracoes da cena (alinhado com HANGAR_PADS de station-areas.jsx).
const LAUNCH_PADS = [
  { x: 0.078, y: 0.665 },
  { x: 0.163, y: 0.665 },
];
const PAD_COUNT = LAUNCH_PADS.length;
// Ponto de embarque do avatar: chao logo a frente/abaixo de cada pad,
// de onde o avatar caminha ate a nave (vetor walk no espaco da nave).
const BOARD_SPOTS = [
  { x: 0.078, y: 0.86, s: 0.92 },
  { x: 0.163, y: 0.86, s: 0.92 },
];
// Cor das naves PARADAS (idle) por plataforma -- so pra a doca nunca
// ficar vazia; a nave em ciclo usa a cor do projeto pai.
const PARKED_COLORS = ['#3ddc84', '#4dd0e1'];
// Brecha no casco (alvo da decolagem): canto superior-esquerdo do
// hangar. A nave sobe-e-sai por aqui (vetor scn-ship-launch).
const BREACH_SPOT = { x: 0.045, y: 0.34 };
// Largura da nave na cena (px). O foguete e ENCORPADO (18x31): com 58px
// de largura ele fica ~100px de altura -- alto mas com corpo solido
// (Falcon), sem estourar a area do hangar nem cobrir a brecha.
const SHIP_W = 58;

// Fases da decolagem (ms). board: avatar caminha ate a nave; ignite:
// avatar some no cockpit, vidro acende, chama liga; launch: a nave
// sobe e sai pela brecha + fade. Apos launch a plataforma reseta.
const BOARD_MS = 900;
const IGNITE_MS = 500;
const FLY_MS = 1200;
// Pequeno respiro pos-fade antes de a plataforma re-popular a nave
// parada (evita pisca seco; a nave nova entra com fade-in).
const RESET_MS = 240;

const WALK_MS = 1200;
const EXIT_MS = 1900; // walk 1200 + fade da mesa
const SEED_STAGGER_MS = 140;
const STALE_MS = 6000;
const MINION_CAP = 12;
const SPARK_KEEP = 8;

// Fileira/arco de minions ao redor da mesa (px no espaco da mesa).
const MINION_SPOTS = [
  [-52, 4], [52, 4], [-64, 16], [64, 16], [-40, 20], [40, 20],
  [-76, 30], [76, 30], [-28, 34], [28, 34], [-62, 42], [62, 42],
];

// ------------------------------------------------------------------
// hooks utilitarios
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

// Relogio de 1s para HH:MM:SS, tempo de voo e staleness do balao.
// Nao atualiza com a aba oculta (economia; o SSE segue chegando).
function useTicker(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function useSceneSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Incrementa seq quando o valor muda: a key nova remonta a celula e a
// animacao de flip roda. Mutacao de ref durante render e idempotente.
function useFlipSeq(value) {
  const ref = useRef({ value, seq: 0 });
  if (ref.current.value !== value) {
    ref.current = { value, seq: ref.current.seq + 1 };
  }
  return ref.current.seq;
}

// Particulas de tokens: quando tokensOut cresce entre updates, solta
// 2-4 quadradinhos subindo do monitor (transform/opacity, ~800ms).
function useTokenSparks(tokens, off) {
  const [sparks, setSparks] = useState([]);
  const prevRef = useRef(null);
  const seqRef = useRef(0);
  const timersRef = useRef(new Set());

  useEffect(() => () => {
    for (const t of timersRef.current) clearTimeout(t);
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = tokens;
    if (off || prev === null || typeof tokens !== 'number' || tokens <= prev) return;
    const count = Math.min(4, 2 + Math.floor((tokens - prev) / 500));
    const batch = [];
    for (let i = 0; i < count; i += 1) {
      seqRef.current += 1;
      batch.push({ id: seqRef.current, dx: Math.round(Math.random() * 22 - 11), delay: i * 110 });
    }
    const ids = new Set(batch.map((p) => p.id));
    setSparks((cur) => [...cur, ...batch].slice(-SPARK_KEEP));
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setSparks((cur) => cur.filter((p) => !ids.has(p.id)));
    }, 1100);
    timersRef.current.add(timer);
  }, [tokens, off]);

  return sparks;
}

// Estado inicial das plataformas: cada pad SEMPRE tem uma nave parada
// (phase 'idle') na cor de cenografia. key remonta a nave a cada reset.
function idlePads() {
  return LAUNCH_PADS.map((_, i) => ({
    key: `pad-${i}-0`,
    phase: 'idle',
    accent: PARKED_COLORS[i % PARKED_COLORS.length],
    boardedId: null,
  }));
}

// HANGAR como N plataformas persistentes. Cada plataforma e UMA nave
// grande: parada (idle, bob) ate um subagent novo chegar; ai a PROPRIA
// nave roda o ciclo no lugar -> 'board' (piloto caminha pra dentro) ->
// 'ignite' (cockpit acende + chama) -> 'launch' (a MESMA nave grande
// sobe e sai pela brecha + fade) -> reset (nave nova, pronta). Nunca ha
// nave pequena/secundaria: o mesmo elemento e parado E decolando.
// Detecta subagent NOVO entre snapshots (ignora seed). reduced: pula
// board/ignite, decola direto (snap). Eventos sem pad livre entram numa
// fila e claimam o proximo pad que resetar.
function useHangarPads(list, reduced) {
  const [pads, setPads] = useState(idlePads);
  const prevRef = useRef(null);
  const seqRef = useRef(0);
  const queueRef = useRef([]);                       // eventos sem pad livre
  const busyRef = useRef(new Array(PAD_COUNT).fill(false)); // ocupacao espelhada
  const timersRef = useRef(new Set());
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => () => {
    for (const t of timersRef.current) clearTimeout(t);
  }, []);

  const after = (ms, fn) => {
    const t = setTimeout(() => { timersRef.current.delete(t); fn(); }, ms);
    timersRef.current.add(t);
    return t;
  };

  const setPad = (i, patch) =>
    setPads((c) => c.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  // Reseta a plataforma i: nave parada nova (key fresca -> remount),
  // libera a ocupacao e tenta puxar o proximo da fila.
  const resetPad = (i) => {
    seqRef.current += 1;
    busyRef.current[i] = false;
    setPad(i, {
      key: `pad-${i}-${seqRef.current}`,
      phase: 'idle',
      accent: PARKED_COLORS[i % PARKED_COLORS.length],
      boardedId: null,
    });
    pump();
  };

  // Roda o ciclo de decolagem na plataforma i com a carga (accent+piloto).
  // A MESMA nave (mesmo elemento) e parada e decola: so o phase muda.
  const runPad = (i, ev) => {
    seqRef.current += 1;
    setPad(i, {
      key: `pad-${i}-${seqRef.current}`,
      phase: reducedRef.current ? 'launch' : 'board',
      accent: ev.accent,
      boardedId: ev.boardedId,
    });
    if (reducedRef.current) {
      after(FLY_MS, () => resetPad(i)); // snap: decola e reseta
      return;
    }
    if (ev.hold) return; // trava no embarque ate __torreClear
    after(BOARD_MS, () => {
      setPad(i, { phase: 'ignite' });
      after(IGNITE_MS, () => {
        setPad(i, { phase: 'launch' });
        after(FLY_MS + RESET_MS, () => resetPad(i));
      });
    });
  };

  // Puxa da fila e aloca nos pads livres (ocupacao via busyRef, sincrona:
  // sem corrida entre eventos no mesmo tick).
  const pump = () => {
    for (;;) {
      if (!queueRef.current.length) break;
      const free = busyRef.current.findIndex((b) => !b);
      if (free === -1) break;
      busyRef.current[free] = true;
      const ev = queueRef.current.shift();
      runPad(free, ev);
    }
  };

  const enqueue = (accent, boardedId, hold) => {
    queueRef.current.push({ accent, boardedId, hold });
    pump();
  };

  useEffect(() => {
    const prev = prevRef.current;
    const cur = new Map();
    for (const s of list || []) {
      const subs = Array.isArray(s.subagents) ? s.subagents : [];
      const accent = projectColor(s.project);
      for (const sub of subs) {
        if (!sub || sub.active === false) continue;
        cur.set(`${s.id}:${sub.id}`, { accent, boardedId: String(sub.id) });
      }
    }
    prevRef.current = cur;
    if (prev === null) return; // seed: nao decola do estado inicial
    for (const [key, info] of cur) {
      if (!prev.has(key)) enqueue(info.accent, info.boardedId, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return pads;
}

// ------------------------------------------------------------------
// estado -> local: ancoras e alocacao de mesas (diff por id)
// ------------------------------------------------------------------

// Nucleo da feature: estado da sessao decide a area da estacao.
// S2.2: o dormitorio virou HANGAR -- 'dormindo' nao tem mais capsula,
// dorme SEMPRE no lounge ('lounge-sleep') pra ninguem ficar sem casa.
// F8: quem encerrou o turno (esperando voce) FICA na mesa, pronto — nao
// vai pro cafe/lounge mesmo se ja ocioso ha alguns minutos.
function anchorKeyFor(id, s) {
  if (isAwaiting(s)) return 'desk';
  if (s.state === 'dormindo') return 'lounge-sleep';
  if (s.state === 'ociosa') return hash32(String(id)) % 2 === 0 ? 'cafe' : 'lounge';
  return 'desk';
}

// Ancora visual (fracoes da cena) da unidade conforme a area.
function anchorSpot(u) {
  const key = u.anchorKey || 'desk';
  if (key === 'cafe') return CAFE_SPOTS[hash32(String(u.id)) % CAFE_SPOTS.length];
  if (key === 'lounge') return LOUNGE_SEATS[hash32(String(u.id)) % LOUNGE_SEATS.length];
  if (key === 'lounge-sleep') return LOUNGE_NAP;
  const sl = SLOTS[u.slot] || SLOTS[0];
  return { x: sl.x, y: sl.y + DESK_AGENT_DY, s: sl.s };
}

// Atualiza unidade presente: revive de 'out', recalcula a ancora pelo
// estado e dispara a fase 'move' quando ela muda (reduced = snap).
function updatePlacement(u, s, reduced) {
  const revive = u.phase === 'out';
  const anchorKey = anchorKeyFor(u.id, s);
  let phase = revive ? 'in' : u.phase;
  let fromKey = u.fromKey || null;
  if (!reduced && phase === 'seated' && anchorKey !== u.anchorKey) {
    phase = 'move';
    fromKey = u.anchorKey || 'desk';
  }
  return { ...u, session: s, phase, anchorKey, fromKey };
}

function diffPlacements(prev, list, reduced, seeding) {
  const incoming = new Map(list.map((s) => [s.id, s]));
  const used = new Set();
  const next = [];
  for (const u of prev) {
    const s = incoming.get(u.id);
    if (s) {
      incoming.delete(u.id);
      next.push(updatePlacement(u, s, reduced));
    } else if (u.phase === 'out') {
      next.push(u);
    } else if (!reduced) {
      next.push({ ...u, phase: 'out' });
    } else {
      continue; // reduced motion: remocao instantanea, slot liberado
    }
    used.add(u.slot);
  }
  let order = 0;
  for (const [id, s] of incoming) {
    const slot = SLOTS.findIndex((_, i) => !used.has(i));
    if (slot === -1) continue;
    used.add(slot);
    next.push({
      id, slot, session: s,
      anchorKey: anchorKeyFor(id, s), fromKey: null,
      phase: reduced ? 'seated' : 'in',
      delay: seeding ? order * SEED_STAGGER_MS : 0,
    });
    order += 1;
  }
  return next;
}

// Agenda os flips de fase de TODAS as unidades transientes a cada diff.
// Idempotente: timer pendente da mesma fase nao e recriado (um update de
// SSE no meio da caminhada nao estica o passeio) e timers perdidos no
// double-mount do StrictMode sao recriados no proximo diff.
function scheduleTransitions(units, unitsRef, setUnits, timersRef) {
  const flip = (id, phase, ms, fn) => {
    const cur = timersRef.current.get(id);
    if (cur && cur.phase === phase) return;
    if (cur) clearTimeout(cur.timer);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      unitsRef.current = fn(unitsRef.current);
      setUnits(unitsRef.current);
    }, ms);
    timersRef.current.set(id, { phase, timer });
  };
  for (const u of units) {
    if (u.phase === 'in') {
      flip(u.id, 'in', WALK_MS + (u.delay || 0), (list) =>
        list.map((x) => (x.id === u.id && x.phase === 'in' ? { ...x, phase: 'seated' } : x)));
    } else if (u.phase === 'move') {
      flip(u.id, 'move', WALK_MS, (list) =>
        list.map((x) => (x.id === u.id && x.phase === 'move'
          ? { ...x, phase: 'seated', fromKey: null }
          : x)));
    } else if (u.phase === 'out') {
      flip(u.id, 'out', EXIT_MS, (list) => list.filter((x) => x.id !== u.id));
    }
  }
}

function usePlacements(list, reduced) {
  const [units, setUnits] = useState([]);
  const unitsRef = useRef([]);
  const timersRef = useRef(new Map());
  const seededRef = useRef(false);

  useEffect(() => {
    const seeding = !seededRef.current;
    seededRef.current = true;
    const next = diffPlacements(unitsRef.current, list, reduced, seeding);
    unitsRef.current = next;
    setUnits(next);
    scheduleTransitions(next, unitsRef, setUnits, timersRef);
  }, [list, reduced]);

  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t.timer);
    timersRef.current.clear();
  }, []);

  const moving = units.some((u) => u.phase === 'in' || u.phase === 'out');
  return { units, moving };
}

// Vetor origem -> destino em px (compensa a escala da area destino)
// para os keyframes de walk (vars CSS --wx/--wy). A entrada/saida usa
// a porta como origem; a troca de area usa a ancora antiga.
function walkVarsFrom(from, to, size, delay) {
  const w = size.w || 960;
  const h = size.h || 600;
  const wx = ((from.x - to.x) * w) / to.s;
  const wy = ((from.y - to.y) * h) / to.s;
  return { '--wx': `${Math.round(wx)}px`, '--wy': `${Math.round(wy)}px`, '--wd': `${delay || 0}ms` };
}

function walkVars(spot, size, delay) {
  return walkVarsFrom(DOOR_POS, spot, size, delay);
}

// ------------------------------------------------------------------
// pecas da cena
// ------------------------------------------------------------------

function Balloon({ session: s, now }) {
  const last = Date.parse(s.lastActivityTs || '');
  const stale = !Number.isFinite(last) || now - last > STALE_MS;
  const text = s.state === 'ativa' ? (stale ? 'pensando...' : actionLabel(s) || 'pensando...') : null;
  const seq = useFlipSeq(text);
  if (!text) return null;
  const detail = s.currentAction && s.currentAction.detail;
  return (
    <div className="su-balloon" title={detail || text}>
      <span key={seq} className="su-balloon-card">{text}</span>
    </div>
  );
}

// F8: selo "esperando voce" acima da mesa quando o agente encerrou o turno.
// Pulsa em rosa (--ready); o balao de acao some e da lugar a ele.
function WaitBadge() {
  return (
    <div className="su-wait" title="terminou o turno — esperando sua resposta">
      <span className="su-wait-dot" aria-hidden="true" />
      esperando você
    </div>
  );
}

function Minion({ sub, accent, index }) {
  const [mx, my] = MINION_SPOTS[index] || [0, 0];
  return (
    <span
      className={`minion-spot${sub.active ? '' : ' minion-off'}`}
      style={{ '--mx': `${mx}px`, '--my': `${my}px`, '--md': `${(index % 5) * 120}ms` }}
      tabIndex={0}
    >
      <span className="minion-pop">
        <MinionSprite className="minion-bot" tone={accent} />
      </span>
      <span className="desk-tooltip minion-tip" role="tooltip">
        <span className="tt-title">{sub.label || sub.id}</span>
        <span className="tt-row"><span className="tt-key">acao</span><span>{actionLabel(sub) || 'pensando...'}</span></span>
      </span>
    </span>
  );
}

function MinionSwarm({ subs, accent, on }) {
  if (!on || subs.length === 0) return null;
  const shown = subs.slice(0, MINION_CAP);
  const extra = subs.length - shown.length;
  return (
    <>
      {shown.map((sub, i) => <Minion key={sub.id} sub={sub} accent={accent} index={i} />)}
      {extra > 0 ? <span className="minion-badge mono">+{extra}</span> : null}
    </>
  );
}

// #2 momentos: dispara TRUE por ms quando `active` vai de false->true (o INSTANTE
// do evento, nao o estado continuo). Sem flash no mount (prev inicia = active).
function useFlash(active, ms = 1500) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(active);
  useEffect(() => {
    if (active && !prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      prev.current = active;
      return () => clearTimeout(t);
    }
    prev.current = active;
    return undefined;
  }, [active, ms]);
  return flash;
}

// #2 momentos: dispara TRUE por ms quando `num` AUMENTA (uma fase virou feita).
function useBump(num, ms = 900) {
  const [bump, setBump] = useState(false);
  const prev = useRef(num);
  useEffect(() => {
    if (num > prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), ms);
      prev.current = num;
      return () => clearTimeout(t);
    }
    prev.current = num;
    return undefined;
  }, [num, ms]);
  return bump;
}

// Barra de FASES na mesa (escopo de ~5 fases da sessao): le session.tasks
// (checklist do TodoWrite), 5 segmentos proporcionais ao progresso (done/total),
// 1 segmento "andando" pulsa. Glance de "quao longe esse agente esta". So mostra
// com 2+ tarefas (1 nao e "fases"); sessao sem TodoWrite => sem barra.
// #2: quando uma fase completa (done sobe), a barra da um BUMP (su-phases-bump).
const PHASE_SEGS = 5;
function PhaseBar({ tasks }) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && t.title) : [];
  const total = list.length;
  const done = list.filter((t) => t.status === 'completed').length;
  const bump = useBump(done);
  if (total < 2) return null;
  const filled = Math.round((done / total) * PHASE_SEGS);
  const nowSeg = done < total ? Math.min(filled, PHASE_SEGS - 1) : -1;
  const segs = [];
  for (let i = 0; i < PHASE_SEGS; i += 1) {
    const cls = i < filled ? 'done' : i === nowSeg ? 'now' : 'todo';
    segs.push(<span key={i} className={`su-phase su-phase-${cls}`} />);
  }
  return (
    <div className={`su-phases${bump ? ' su-phases-bump' : ''}`} title={`${done}/${total} fases feitas`}>
      <span className="su-phase-segs">{segs}</span>
      <span className="su-phase-count">{done}/{total}</span>
    </div>
  );
}

// Refino anti-ruido round 2: chip = SO callsign (+ relogio quando
// ativa). O nome do projeto saiu do chip -- com 8 mesas do mesmo
// projeto era "home" repetido 8x, e a font-pixel 7px embola
// minusculas; cor da mesa + tooltip ja dizem o projeto. O relogio
// vivo fica APENAS na mesa ativa; code 4ch e tempo vivem no tooltip.
function DeskHud({ session: s, accent, now }) {
  const label = `tokens out: ${fmtTokens(s.tokensOut)}`;
  return (
    <>
      <div className="su-hud">
        <span className="token-meter su-meter" title={label}>
          <span
            className="token-fill"
            style={{ transform: `scaleX(${tokenPct(s.tokensOut).toFixed(3)})`, background: accent }}
          />
        </span>
      </div>
      {s.state === 'ativa' ? <PhaseBar tasks={s.tasks} /> : null}
      <div className="su-plate" title={s.project || ''}>
        <span className="su-plate-call">{callsign(s.id)}</span>
        {s.state === 'ativa' ? <span className="su-clock on">{flightTime(s.startedTs, now)}</span> : null}
      </div>
    </>
  );
}

function SceneTooltip({ session: s, subCount, now }) {
  return (
    <div className="desk-tooltip su-tip" role="tooltip">
      <div className="tt-title">{s.project || 'sessao'}</div>
      <div className="tt-row"><span className="tt-key">agente</span><span>{`${callsign(s.id)} · ${flightCode(s.id)}`}</span></div>
      <div className="tt-row"><span className="tt-key">estado</span><span>{s.state}</span></div>
      <div className="tt-row"><span className="tt-key">tempo</span><span>{flightTime(s.startedTs, now)}</span></div>
      <div className="tt-row"><span className="tt-key">modelo</span><span>{shortModel(s.model)}</span></div>
      <div className="tt-row"><span className="tt-key">acao</span><span>{actionLabel(s) || 'n/d'}</span></div>
      <div className="tt-row">
        <span className="tt-key">tokens</span>
        <span>{fmtTokens(s.tokensIn)} in / {fmtTokens(s.tokensOut)} out</span>
      </div>
      <div className="tt-row"><span className="tt-key">subagentes</span><span>{subCount}</span></div>
      {s.promptPreview ? <div className="tt-preview">{s.promptPreview}</div> : null}
    </div>
  );
}

// Workstation: mesa da estacao + cadeira gamer na cor do projeto.
// A mobilia e FIXA no slot; quem se move entre areas e o AgentBody.
// Balao/HUD/minions/particulas continuam ancorados na mesa.
function WorkstationUnit({ unit, now, reduced, onSelect }) {
  const { session: s, slot, phase } = unit;
  const spot = SLOTS[slot] || SLOTS[0];
  const accent = projectColor(s.project);
  const subs = Array.isArray(s.subagents) ? s.subagents : [];
  const present = unit.anchorKey === 'desk';
  const awaiting = isAwaiting(s);
  // #2: o INSTANTE em que o agente vira "esperando voce" -> ping rosa unico
  // (alem da aura continua do su-espera), pra voce NOTAR o momento.
  const justAwaited = useFlash(awaiting);
  // Clique na baia abre a HISTORIA DA SESSAO (dossie): onSelect contrato do Room.
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: s.id }) : null;
  const sparks = useTokenSparks(s.tokensOut, reduced || phase !== 'seated' || s.state !== 'ativa');
  const monitors = 2 + (hash32(String(unit.id)) % 2);
  // awaiting => tela acesa (pronto, te esperando), nao 'dim'.
  const screen = awaiting || s.state === 'ativa' ? 'on' : s.state === 'ociosa' ? 'dim' : 'off';
  const style = {
    left: `${(spot.x * 100).toFixed(1)}%`,
    top: `${(spot.y * 100).toFixed(1)}%`,
    zIndex: 10 + Math.round(spot.y * 10), // fileira da frente acima, sob a vinheta (25)
    '--su-s': spot.s,
  };
  return (
    <div
      className={`su su-${s.state} su-${phase}${present ? '' : ' su-away'}${awaiting ? ' su-espera' : ''}${justAwaited ? ' su-flash' : ''}${select ? ' su-clickable' : ''}`}
      style={style}
      tabIndex={0}
      role={select ? 'button' : undefined}
      onClick={select || undefined}
      onKeyDown={select ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
    >
      <div className="su-stage">
        {phase === 'seated' && present && awaiting ? <WaitBadge /> : null}
        {phase === 'seated' && present && !awaiting ? <Balloon session={s} now={now} /> : null}
        <span className="st-chair"><GamerChairSprite color={accent} /></span>
        <span className="su-desk">
          <StationDeskSprite color={accent} monitors={monitors} screen={screen} />
        </span>
        {sparks.map((p) => (
          <span
            key={p.id}
            className="p-token"
            style={{ '--sx': `${p.dx}px`, animationDelay: `${p.delay}ms`, background: accent }}
          />
        ))}
        <MinionSwarm subs={subs} accent={accent} on={phase === 'seated'} />
      </div>
      <DeskHud session={s} accent={accent} now={now} />
      <SceneTooltip session={s} subCount={subs.filter((x) => x && x.active).length} now={now} />
    </div>
  );
}

// Avatar assentado conforme a area: typing na mesa, caneca+vapor no
// cafe, idle no sofa, sleep+Zzz no fallback do lounge.
function seatedAvatar(u, accent) {
  const key = u.anchorKey;
  if (key === 'cafe') {
    return (
      <span className="ag-pose">
        {/* vapor da caneca ja vem do SippingAvatar — sem emissor extra */}
        <SippingAvatar>
          <AvatarSprite id={u.id} uniform={accent} pose="idle" />
        </SippingAvatar>
      </span>
    );
  }
  if (key === 'lounge') {
    return <AvatarSprite id={u.id} uniform={accent} pose="idle" />;
  }
  if (key === 'lounge-sleep') {
    return (
      <span className="ag-pose">
        <AvatarSprite id={u.id} uniform={accent} pose="sleep" />
        <span className="st-pod-zzz ag-zzz"><ZzzSprite width={16} /></span>
      </span>
    );
  }
  const pose = u.session.state === 'ativa' ? 'typing' : u.session.state === 'ociosa' ? 'idle' : 'sleep';
  return <AvatarSprite id={u.id} uniform={accent} pose={pose} />;
}

// Corpo do agente: avatar posicionado na ancora do estado. Fases
// in/move/out reusam os keyframes de walk (vars --wx/--wy).
function AgentBody({ unit: u, size }) {
  const accent = projectColor(u.session.project);
  const spot = anchorSpot(u);
  const area = u.anchorKey;
  const style = {
    left: `${(spot.x * 100).toFixed(1)}%`,
    top: `${(spot.y * 100).toFixed(1)}%`,
    zIndex: 11 + Math.round(spot.y * 10),
    '--su-s': spot.s,
  };
  let vars = null;
  if (u.phase === 'in') vars = walkVars(spot, size, u.delay);
  else if (u.phase === 'out') vars = walkVars(spot, size, 0);
  else if (u.phase === 'move') {
    vars = walkVarsFrom(anchorSpot({ ...u, anchorKey: u.fromKey || 'desk' }), spot, size, 0);
  }
  const anim = u.phase === 'in' || u.phase === 'move'
    ? ' ag-walk-in'
    : u.phase === 'out' ? ' ag-walk-out' : '';
  const walking = u.phase !== 'seated';
  return (
    <div className={`ag ag-${area} ag-${u.phase}`} style={style} aria-hidden="true">
      <div key={`${u.phase}:${u.anchorKey}`} className={`ag-body${anim}`} style={vars || undefined}>
        {walking
          ? <AvatarSprite id={u.id} uniform={accent} pose="walk" />
          : seatedAvatar(u, accent)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// telao diegetico na parede -- versao SLIM (refino anti-ruido):
// relogio + contagem + ULTIMA ACAO viva (flip ao mudar) + cpu/ram/
// drift. A tabela de agentes saiu: duplicava o painel lateral.
// ------------------------------------------------------------------

// Acao mais recente entre as sessoes ATIVAS: "Procyon · Edit > x.md".
function lastActionOf(list) {
  let best = null;
  for (const s of list) {
    if (s.state !== 'ativa') continue;
    const t = Date.parse(s.lastActivityTs || '');
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.t) best = { t, s };
  }
  if (!best) return null;
  const a = actionLabel(best.s);
  return a ? { text: `${callsign(best.s.id)} · ${a}`, color: projectColor(best.s.project) } : null;
}

function TelaoBar({ label, pct }) {
  const v = pct === null || pct === undefined ? null : Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = v === null ? 0 : Math.round(v / 10);
  const level = v === null ? 'ok' : v >= 90 ? 'crit' : v >= 70 ? 'warn' : 'ok';
  const segs = [];
  for (let i = 0; i < 10; i += 1) {
    segs.push(<span key={i} className={`tl-seg${i < filled ? ` onn tl-${level}` : ''}`} />);
  }
  return (
    <div className="tl-bar">
      <span className="tl-bar-label">{label}</span>
      <span className="tl-segs">{segs}</span>
      <span className="tl-bar-val">{v === null ? '--' : `${Math.round(v)}%`}</span>
    </div>
  );
}

function WallScreen({ sessions, stats, now, loaded }) {
  const waiting = sessions.filter((s) => isAwaiting(s)).length;
  const working = sessions.filter((s) => s.state === 'ativa' && !isAwaiting(s)).length;
  const hot = hotFolder(sessions);
  const action = lastActionOf(sessions);
  const seq = useFlipSeq(action ? action.text : null);
  const d = new Date(now);
  const clock = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0')).join(':');
  const ram = stats && stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : null;
  return (
    <div className="telao mono" aria-label="Telao da torre">
      <div className="tl-main">
        <div className="tl-clock">{clock}</div>
        <div className="tl-count">
          {loaded
            ? `${working} trabalhando · ${sessions.length} ${sessions.length === 1 ? 'sessao' : 'sessoes'}`
            : 'sync...'}
          {/* a contagem de 'esperando' tem destaque proprio na linha tl-wait */}
        </div>
        {hot ? <div className="tl-hot">pasta quente: <b>{hot}</b></div> : null}
        <div className="tl-now" title={action ? action.text : ''}>
          <span
            key={seq}
            className="tl-now-text"
            style={action ? { color: action.color } : undefined}
          >
            {action ? action.text : 'sem atividade agora'}
          </span>
        </div>
        {waiting > 0 ? (
          <div className="tl-wait" title="agentes que encerraram o turno e aguardam sua resposta">
            <span className="tl-wait-dot" aria-hidden="true" />
            {waiting} {waiting === 1 ? 'esperando você' : 'esperando você'}
          </div>
        ) : null}
      </div>
      <div className="tl-side">
        <TelaoBar label="cpu" pct={stats ? stats.cpuPct : null} />
        <TelaoBar label="ram" pct={ram} />
        <div className="tl-drift">
          <span className={`tl-led tl-led-${(stats && stats.drift) || 'unknown'}`} />
          <span>drift</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// QUADRO DE CHAMADAS (vaga da antiga biblioteca): SO os agentes que
// encerraram o turno e esperam VOCE (awaitingInput) -- a fila acionavel
// em destaque rosa. NAO duplica o painel lateral (que lista todos);
// aqui e o "quem te trava agora". Vazio => estado calmo "tudo fluindo".
// ------------------------------------------------------------------

function clip(text, n) {
  const s = String(text || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Mensagem da chamada: ultima acao real, senao preview do prompt.
function callMessage(s) {
  return actionLabel(s) || s.promptPreview || 'aguardando sua resposta';
}

function CallsBoard({ sessions, onSelect }) {
  const waiting = sessions.filter((s) => isAwaiting(s));
  const working = sessions.filter((s) => s.state === 'ativa' && !isAwaiting(s)).length;
  const calm = waiting.length === 0;
  return (
    <div className={`calls-board mono${calm ? ' calls-calm' : ' calls-alert'}`} aria-label="Quadro de chamadas">
      <div className="cb-head">
        <span className="cb-dot" aria-hidden="true" />
        {calm ? 'TUDO FLUINDO' : `ESPERANDO VOCÊ · ${waiting.length}`}
      </div>
      <div className="cb-rows">
        {calm ? (
          <div className="cb-empty">{`${working} trabalhando · nenhum agente travado`}</div>
        ) : (
          waiting.slice(0, 5).map((s) => {
            // Board ACIONAVEL: clicar abre a historia daquele agente (fecha ver->agir).
            const select = onSelect ? () => onSelect({ type: 'session', sessionId: s.id }) : null;
            return (
              <div
                key={s.id}
                className={`cb-row${select ? ' cb-clickable' : ''}`}
                style={{ '--cb-accent': projectColor(s.project) }}
                role={select ? 'button' : undefined}
                tabIndex={select ? 0 : undefined}
                title={select ? 'abrir a historia desta sessao' : undefined}
                onClick={select || undefined}
                onKeyDown={select ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : undefined}
              >
                <span className="cb-call">{callsign(s.id)}</span>
                <span className="cb-msg">{clip(callMessage(s), 40)}</span>
              </div>
            );
          })
        )}
        {waiting.length > 5 ? <div className="cb-more">{`+${waiting.length - 5} na fila`}</div> : null}
      </div>
    </div>
  );
}

// Pasta (galaxia) mais quente: o grupo do vaultPath da currentAction mais
// recente. 1o segmento do path, sem prefixo de ordem (3-). Ignora paths
// ABSOLUTOS (sessao editando codigo, nao nota do vault) -> evita "pasta c".
function hotFolder(list) {
  let best = null;
  let bestT = -1;
  for (const s of list) {
    const a = s && s.currentAction;
    let vp = a && typeof a.vaultPath === 'string' ? a.vaultPath : '';
    if (!vp) continue;
    vp = vp.replace(/\\/g, '/');
    if (vp.startsWith('/') || /^[a-z]:/i.test(vp)) continue; // path absoluto = nao-vault
    const t = Date.parse(s.lastActivityTs || '') || 0;
    if (t > bestT) { bestT = t; best = vp; }
  }
  if (!best) return null;
  const seg = best.split('/')[0] || '';
  return seg.replace(/^\d+-/, '') || null;
}

// Iluminacao por dado real: mais sessoes ativas = estacao mais acesa.
function SceneLight({ active, loaded, empty }) {
  const glow = Math.min(0.5, 0.1 + active * 0.1);
  const dark = empty ? 0.55 : Math.max(0, 0.4 - active * 0.14);
  return (
    <>
      <div className="scene-light" style={{ opacity: glow }} aria-hidden="true" />
      <div className="scene-dark" style={{ opacity: loaded ? dark : 0.5 }} aria-hidden="true" />
      <div className="scene-vignette" aria-hidden="true" />
    </>
  );
}

// Avatar que caminha do chao do hangar ate o cockpit da nave parada
// (fase 'board'): reusa o keyframe scn-walk-in com o vetor BOARD->pad.
function BoardingPilot({ pad, i, size }) {
  const p = LAUNCH_PADS[i] || LAUNCH_PADS[0];
  const from = BOARD_SPOTS[i] || BOARD_SPOTS[0];
  // alvo = a porta/cockpit da nave (um tico acima do centro do pad)
  const to = { x: p.x, y: p.y, s: from.s };
  const vars = walkVarsFrom(from, to, size, 0);
  const style = {
    left: `${(to.x * 100).toFixed(1)}%`,
    top: `${(to.y * 100).toFixed(1)}%`,
    zIndex: 13,
    '--su-s': to.s,
  };
  return (
    <div className="ag ag-board" style={style} aria-hidden="true">
      <div key={`board:${pad.key}`} className="ag-body ag-walk-in" style={vars}>
        <AvatarSprite id={pad.boardedId} uniform={pad.accent} pose="walk" />
      </div>
    </div>
  );
}

// A NAVE GRANDE da plataforma i: o MESMO elemento que fica parado (idle,
// bob) E que decola. phase 'idle'/'board' = pousada; 'ignite' = aquece
// (cockpit acende, chama, piloto no windshield); 'launch' = a propria
// nave grande sobe e sai PELA BRECHA + fade. Apos o fade o hook reseta
// a plataforma (key nova => nave parada nova entra). Nao ha nave
// secundaria: parado e decolando sao o mesmo <span>.
function HangarShip({ pad, i, size }) {
  const phase = pad.phase;
  const p = LAUNCH_PADS[i] || LAUNCH_PADS[0];
  const boarded = phase === 'ignite' || phase === 'launch';
  const launching = phase === 'launch';
  const w = size.w || 960;
  const h = size.h || 600;
  // vetor pad -> brecha (saida ao espaco): sobe-e-sai pra esquerda
  const lx = Math.round((BREACH_SPOT.x - p.x) * w);
  const ly = Math.round((BREACH_SPOT.y - p.y) * h);
  const style = {
    left: `${(p.x * 100).toFixed(1)}%`,
    top: `${(p.y * 100).toFixed(1)}%`,
    width: `${SHIP_W}px`,
    marginLeft: `${-SHIP_W / 2}px`,
    '--lx': `${lx}px`,
    '--ly': `${ly}px`,
    '--lt': `${FLY_MS}ms`,
  };
  return (
    <span
      key={pad.key}
      className={`r-launch r-launch-${phase}${launching ? ' is-launching' : ''}`}
      style={style}
    >
      <ShipSprite
        color={pad.accent}
        boardedId={boarded ? pad.boardedId : null}
        flame={boarded}
        width={SHIP_W}
      />
    </span>
  );
}

// HANGAR DINAMICO: as N plataformas persistentes. Cada uma renderiza UMA
// nave grande (parada ou em ciclo) + o piloto caminhando durante 'board'.
// A cenografia fixa (brecha + label) vive no HangarBay (station-areas).
function LaunchBay({ pads, size }) {
  return (
    <>
      {pads.map((pad, i) => (
        pad.phase === 'board'
          ? <BoardingPilot key={`board-${pad.key}`} pad={pad} i={i} size={size} />
          : null
      ))}
      {pads.map((pad, i) => <HangarShip key={`ship-${i}`} pad={pad} i={i} size={size} />)}
    </>
  );
}

// ------------------------------------------------------------------
// cena
// ------------------------------------------------------------------

export default function RoomScene({ sessions, error, onSelect }) {
  const reduced = useReducedMotion();
  const now = useTicker(1000);
  const sceneRef = useRef(null);
  const size = useSceneSize(sceneRef);
  const { stats } = useStats();
  const list = sessions || [];
  const seatable = useMemo(() => list.filter((s) => s.kind !== 'tarefa'), [list]);
  const cargo = useMemo(() => list.filter((s) => s.kind === 'tarefa'), [list]);
  const { units, moving } = usePlacements(seatable, reduced);
  const pads = useHangarPads(list, reduced);
  const activeCount = list.filter((s) => s.state === 'ativa').length;
  const seated = units.filter((u) => u.phase !== 'out').length;
  const overflow = Math.max(0, seatable.length - seated);
  const loaded = sessions !== null;

  return (
    <section ref={sceneRef} className="panel room-scene" aria-label="Sala da Torre">
      <StationShell />
      <AreaZones />
      <WallScreen sessions={list} stats={stats} now={now} loaded={loaded} />
      <HoloTableArea colors={GALAXY_COLORS} />
      <div className={`scene-door${moving ? ' lit' : ''}`}>
        <DoorSprite open={moving} />
      </div>
      <HangarBay colors={GALAXY_COLORS} />
      <LaunchBay pads={pads} size={size} />
      <CoffeeArea />
      <LoungeArea />
      <CallsBoard sessions={list} onSelect={onSelect} />
      {units.map((u) => (
        <WorkstationUnit key={u.id} unit={u} now={now} reduced={reduced} onSelect={onSelect} />
      ))}
      {units.map((u) => (
        <AgentBody key={`ag:${u.id}`} unit={u} size={size} />
      ))}
      <CargoDock cargo={cargo} />
      {overflow > 0 ? <div className="scene-overflow mono">+{overflow} em espera no telao</div> : null}
      <SceneLight active={activeCount} loaded={loaded} empty={loaded && list.length === 0} />
      {!loaded ? <div className="scene-empty">sincronizando radar...</div> : null}
      {loaded && list.length === 0 ? <div className="scene-empty">deck vazio — aguardando tripulacao</div> : null}
      {error ? <div className="room-error scene-error">radar offline: {error}</div> : null}
      <div className="room-crt" aria-hidden="true" />
    </section>
  );
}
