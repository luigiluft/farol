// FAROL - fleet-model.js (W1, F5.1): estado puro da frota viva.
// Naves (1 por sessao Claude, cap 12 com prioridade ativa > ociosa >
// dormindo), drones (subagentes em orbita), runs (missoes sonda ate a
// estrela do vaultPath), trilhas-constelacao com TTL, ripples de energia
// pelos links reais, pool fixo de particulas e protoestrelas (Write em
// path sem node resolvido). Zero DOM, zero canvas, zero React: so dados
// e fisica leve (spring criticamente amortecida ate o alvo).
// Fase 2: ritos de passagem F5.7 (prevState/sleepAt/goneState + GONE_MS;
// warp/dissolve sao 100% draw, o model so carrega timestamps/estados) e
// F5.8 (run.variant 'ping': acao mcp__* sem vaultPath vira missao ate a
// estacao 'mcp:<id>' resolvida pelo engine; estacao nunca entra no trail).
// F7: run.variant 'skill' -- acao com tool 'Skill' e target vira missao
// ate o LIVRO da biblioteca orbital (universe.books); match por label
// normalizado dos dois lados, fallback resolveNode('skill:...'); livro
// fora do top 12 => degrade silencioso (nem flare).
// Consumidores: graph-engine.js (W3) chama syncFleet por payload SSE (nao
// por frame) e stepFleet por frame; fleet-draw.js (W2) so le o estado.
// Regra dura de hot path: stepFleet NUNCA aloca - arrivals/finished sao
// scratch arrays do fleet (length=0 no inicio, push in-place), particulas
// vivem em pool fixo, runs/ripples/protoStars decaem por compaction
// in-place e bezierPoint devolve um scratch compartilhado.
// Guards defensivos: payload v2 (sem currentAction/vaultPath/subagents)
// degrada para naves paradas no hangar; ctx parcial (resolveNode/colorOf/
// onFlare ausentes) nunca quebra. Contratos: SPEC-F5.md secao F5.1.
import { TAU, clamp, hash32 } from './graph-universe.js';

export const FLEET_CAPS = {
  SHIPS: 12, DRONES_PER_SHIP: 8, RUNS: 6, PARTICLES: 240,
  RIPPLES: 12, TRAIL_POINTS: 8, TRAIL_TTL_MS: 10 * 60 * 1000,
};
export const RUN_OUT_MS = 850;
export const RUN_SCAN_MS = 1450;
export const RUN_BACK_MS = 650;
export const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookEdit']);
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
// C: acoes de web (sem vaultPath nem MCP server) viram run 'ping' ate a
// estacao 'web' sintetica do universo -- o "aonde" da pesquisa na rede.
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);
// F5.7: duracao do rito de saida (warp/dissolve) que o draw (P2) anima a
// partir de ship.gone; o sync so limpa o ship depois de GONE_CLEAR_MS.
export const GONE_MS = 2200;

const SPRING_K = 3.2;
const SPRING_DAMP = 3.6;
// A nave ATIVA POUSA no node (alvo = centroide do node, sem lift no mundo): o
// fleet-draw aplica um pequeno lift em px de TELA (proporcional ao tamanho da
// nave) para a nave repousar logo ACIMA da estrela em qualquer zoom, em vez de
// flutuar alto (o lift antigo era 34 em mundo => 100+px no zoom-in).
// DOCA CENTRAL COMPARTILHADA: subagentes ociosos/dormindo enfileiram lado
// a lado numa fileira logo ABAIXO do nucleo (origem 0,0), empacotados por
// slot estavel (ordem por id). Nada de anel externo solitario.
// FB: raio da formacao das naves em ARCO em volta do hub da BASE (em extent);
// o fleet-draw usa o mesmo valor para o anel-doca. DOCK_ARC = abertura do arco
// no lado de FORA (radial), deixando o lado de dentro livre para o conduite.
export const DOCK_FORM_FRAC = 0.075;
const DOCK_ARC = Math.PI;
const PROTO_RING = 1.02; // protoStar sem galaxia: anel extent*1.02
const GONE_CLEAR_MS = 2400; // cleanup interno do ship (folga sobre GONE_MS)
const DRONE_GONE_FADE_MS = 1200; // fade do drone antes da remocao definitiva
const EMA_FACTOR = 0.18; // suavizacao do centroide por sync
// CENTROID_MAX=1: a nave ATIVA segue de perto o ULTIMO node do trail (o
// arquivo/pasta corrente), nao mais a media dos 4 ultimos. Movimento vivo.
const CENTROID_MAX = 1;
const RIPPLE_DUR_MS = 700;
// ripple permanece no array por 400ms ALEM de dur: o draw (W2) usa essa
// janela para o mini-halo de chegada no vizinho (fade RIPPLE_HALO_FADE_MS)
const RIPPLE_LINGER_MS = 400;
const RIPPLES_PER_ARRIVAL = 4;
const PROTO_TTL_MS = 8000;
const PARTICLES_READ = 12;
const PARTICLES_WRITE = 14;
const PARTICLE_FLOW_MS = 1400; // periodo do fluxo na bezier durante scan/back
const PARTICLE_SIZE_MIN = 1.2;
const PARTICLE_SIZE_SPAN = 1.2; // tamanho mundo 1.2-2.4 (clamp por zoom no draw)
const CTRL_BEND_MIN = 24;
const CTRL_BEND_MAX = 120;
const CTRL_BEND_FACTOR = 0.18;
const FALLBACK_COLOR = '#5d6b78';
const STATE_PRIORITY = { ativa: 0, ociosa: 1, dormindo: 2 };
const HASH_SPAN = 4294967296; // 2^32: hash32 -> fracao 0..1

// F-art: CLASSE de silhueta pela familia do modelo (FORMA = INFORMACAO).
// fable=capitania (pesada), opus=cruzador (base), sonnet=fragata (fina),
// haiku=scout (leve); desconhecido/null => cruzador. Regex local de proposito
// (nao importa shortModel de roomData: manteria este modulo PURO, sem puxar a
// cadeia api.js/React pra dentro da fisica).
const MODEL_CLASS = { fable: 'capitania', opus: 'cruzador', sonnet: 'fragata', haiku: 'scout' };
export function shipClassOf(model) {
  const fam = String(model || '').toLowerCase().match(/fable|opus|sonnet|haiku/);
  return (fam && MODEL_CLASS[fam[0]]) || 'cruzador';
}

// F-art: heading da nave (a nave APONTA pro destino). Repouso = nariz pra
// cima; em transito = direcao ao alvo, com lerp angular (sem flip brusco).
const HEADING_NEUTRAL = -Math.PI / 2;
const HEADING_LERP = 0.12; // suavizacao angular por frame
const HEADING_MOVE_EPS = 6; // (mundo) alvo mais perto que isto => nave PARADA

// Menor caminho angular de a->b, resultado em (-PI, PI]: evita o giro de
// 350deg quando atan2 cruza a fronteira +PI/-PI.
function angDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

// Atualiza heading/moving da nave a partir do alvo (tx,ty) vs posicao atual.
// moving = alvo distante > epsilon (o draw usa pra chama SO em transito).
// reduced => snap no goal (sem lerp), coerente com o snap de posicao.
function stepHeading(ship, reduced) {
  const dx = ship.tx - ship.x;
  const dy = ship.ty - ship.y;
  const moving = (dx * dx + dy * dy) > HEADING_MOVE_EPS * HEADING_MOVE_EPS;
  ship.moving = moving;
  const goal = moving ? Math.atan2(dy, dx) : HEADING_NEUTRAL;
  if (reduced) { ship.heading = goal; return; }
  ship.heading += angDelta(ship.heading, goal) * HEADING_LERP;
}

// Scratches compartilhados (zero alloc por frame). Quem consumir o retorno
// de bezierPoint deve copiar x/y antes de chamar de novo.
const BEZ_OUT = { x: 0, y: 0 };
const BEZ_P0 = { x: 0, y: 0 };
const BEZ_P1 = { x: 0, y: 0 };
const SPOT = { x: 0, y: 0 };
// Vazios CONGELADOS e distintos (sem aliasing entre arrivals/finished/
// trailPath): qualquer push acidental num deles throwa em strict mode.
const EMPTY_TRAIL = Object.freeze([]);
const EMPTY_FX = Object.freeze({
  arrivals: Object.freeze([]),
  finished: Object.freeze([]),
});
const DROP_KEYS = []; // scratch do dropShip: coletar chaves antes de deletar

// ---------------------------------------------------------------- helpers

function hashFrac(str) {
  return hash32(String(str)) / HASH_SPAN;
}

// lastActivityTs pode vir numero epoch ou string ISO (server v2/v3).
function tsOf(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function shipColor(session, ctx) {
  if (typeof ctx.colorOf !== 'function') return FALLBACK_COLOR;
  try {
    return ctx.colorOf(session.project) || FALLBACK_COLOR;
  } catch {
    return FALLBACK_COLOR;
  }
}

function fireFlare(ctx, nodeId, color) {
  if (typeof ctx.onFlare !== 'function') return;
  try {
    ctx.onFlare(nodeId, color);
  } catch {
    // flare e efeito opcional: nunca derruba o sync
  }
}

// ------------------------------------------------------------ createFleet

function makeParticlePool() {
  const pool = new Array(FLEET_CAPS.PARTICLES);
  for (let i = 0; i < pool.length; i += 1) {
    pool[i] = { active: false, x: 0, y: 0, run: null, offset: 0, size: 0 };
  }
  return pool;
}

export function createFleet() {
  const fleet = {
    ships: new Map(), // sessionId -> ship
    runs: [],
    trails: new Map(), // sessionId -> [{ node, ts }]
    ripples: [],
    particles: makeParticlePool(),
    protoStars: [],
    seeded: false,
    seenTs: new Map(), // chaves s:<id> e b:<id>/<subId> -> ultimo action.ts
    arrivals: [], // scratch: runs que chegaram na estrela neste step
    finished: [], // scratch: runs que terminaram neste step
    runSeq: 0, // id de run + alternancia do lado da bezier
  };
  // objeto de retorno estavel do stepFleet (zero alloc por frame)
  fleet.fx = { arrivals: fleet.arrivals, finished: fleet.finished };
  return fleet;
}

// ----------------------------------------------------------------- ships

// Doca central compartilhada: slot e o INDICE da nave no conjunto vivo
// ordenado (estavel por id); total e quantas naves estao ancoradas. As
// docas formam fileiras curtas (DOCK_ROW_MAX por fileira) centradas em
// x=0, logo abaixo do nucleo. Slot/total ausentes (nave fora do sync ou
// 1 nave) caem em slot 0 / total 1 => doca unica no centro da fileira.
function hangarSpot(universe, slot, total, out) {
  const extent = (universe && Number(universe.extent)) || 600;
  // FB: a BASE da frota fica no MAIOR vao angular entre as galaxias
  // (universe.dockAngle/dockR) -> fora de qualquer projeto/estacao. As naves
  // ociosas estacionam em ARCO em volta do hub da base, abrindo para FORA
  // (radial = ang) e deixando o lado de dentro livre para o conduite ate a
  // Torre. Sem dockAngle (payload velho) cai no fundo (PI/2).
  const dockR = (universe && Number(universe.dockR)) || (extent * 0.42);
  const ang = universe && Number.isFinite(Number(universe.dockAngle))
    ? Number(universe.dockAngle) : Math.PI / 2;
  const dcx = Math.cos(ang) * dockR; // hub da base
  const dcy = Math.sin(ang) * dockR;
  const idx = Number.isFinite(slot) && slot >= 0 ? slot : 0;
  const count = Number.isFinite(total) && total > 0 ? total : 1;
  const ringR = extent * DOCK_FORM_FRAC;
  const t = count > 1 ? (idx / (count - 1)) - 0.5 : 0;
  const a = ang + t * DOCK_ARC; // arco centrado no radial (lado de fora)
  out.x = dcx + Math.cos(a) * ringR;
  out.y = dcy + Math.sin(a) * ringR;
  return out;
}

function createShip(session, ctx, now, slot, total) {
  hangarSpot(ctx.universe, slot, total, SPOT);
  return {
    id: session.id,
    project: session.project || 'sessao',
    color: shipColor(session, ctx),
    state: session.state || 'ociosa',
    awaiting: session.awaitingInput === true, // F8: turno encerrado, aguarda
    variant: session.kind === 'tarefa' ? 'cargo' : 'mother',
    model: session.model || null, // F-art: modelo cru (debug) + classe derivada
    shipClass: shipClassOf(session.model),
    heading: HEADING_NEUTRAL, // F-art: nariz pra cima ate entrar em transito
    moving: false, // F-art: true so em transito real (chama do motor)
    x: SPOT.x,
    y: SPOT.y,
    vx: 0,
    vy: 0,
    tx: SPOT.x,
    ty: SPOT.y,
    hx: SPOT.x, // doca central (slot na fileira; re-derivada por sync)
    hy: SPOT.y,
    parked: true,
    // F5b: slot/total estaveis da doca -> a nave PARADA re-deriva a vaga da doca
    // VIVA por frame (stepShips/refreshDockTarget) e acompanha a revolucao.
    dockSlot: Number.isFinite(slot) ? slot : 0,
    dockTotal: Number.isFinite(total) && total > 0 ? total : 1,
    bobPhase: hashFrac(session.id) * TAU,
    session,
    drones: [],
    subCount: 0, // B: total de subagentes (mesmo alem do cap de drones)
    spawnT: now,
    gone: null, // ts do sumico; draw anima GONE_MS, sync limpa em GONE_CLEAR_MS
    // F5.7: prevState = estado do sync anterior; nave que ja NASCE dormindo
    // nao ganha rito de power-down (sleepAt so marca a TRANSICAO).
    prevState: session.state || 'ociosa',
    sleepAt: null, // ts da transicao para 'dormindo' (power-down no draw)
    goneState: null, // estado no momento do gone: decide warp vs dissolve
  };
}

function refreshShip(ship, session, ctx, now) {
  const prev = ship.state;
  ship.session = session;
  ship.project = session.project || ship.project;
  ship.state = session.state || ship.state;
  ship.awaiting = session.awaitingInput === true; // F8
  ship.color = shipColor(session, ctx);
  ship.variant = session.kind === 'tarefa' ? 'cargo' : 'mother';
  ship.model = session.model || ship.model; // F-art: modelo pode chegar tardio
  ship.shipClass = shipClassOf(session.model || ship.model);
  ship.gone = null; // sessao reapareceu durante o rito: mesmo ship, sem respawn
  ship.goneState = null;
  trackSleep(ship, prev, now);
}

// F5.7: a TRANSICAO para 'dormindo' marca sleepAt (o draw anima o
// power-down a partir dele); acordar limpa o timestamp; continuar
// dormindo preserva. prevState fica no ship para o draw/debug.
function trackSleep(ship, prev, now) {
  ship.prevState = prev;
  if (prev !== 'dormindo' && ship.state === 'dormindo') ship.sleepAt = now;
  else if (ship.state !== 'dormindo') ship.sleepAt = null;
}

function compareSessions(a, b) {
  const ra = STATE_PRIORITY[a.state] !== undefined ? STATE_PRIORITY[a.state] : 1;
  const rb = STATE_PRIORITY[b.state] !== undefined ? STATE_PRIORITY[b.state] : 1;
  if (ra !== rb) return ra - rb;
  return tsOf(b.lastActivityTs) - tsOf(a.lastActivityTs);
}

// Cap de naves: prioridade ativa > ociosa > dormindo, desempate por
// lastActivityTs desc. Sync nao e hot path: alocar aqui e permitido.
function pickSessions(sessions) {
  const list = [];
  for (const s of sessions) {
    if (s && typeof s === 'object' && s.id) list.push(s);
  }
  list.sort(compareSessions);
  return list.length > FLEET_CAPS.SHIPS ? list.slice(0, FLEET_CAPS.SHIPS) : list;
}

function hasSession(chosen, id) {
  for (const s of chosen) {
    if (s.id === id) return true;
  }
  return false;
}

function killRunsOf(fleet, ship) {
  for (let i = fleet.runs.length - 1; i >= 0; i -= 1) {
    if (fleet.runs[i].ship === ship) {
      releaseParticles(fleet, fleet.runs[i]);
      fleet.runs.splice(i, 1);
    }
  }
}

function dropShip(fleet, id) {
  // scratch zerado no INICIO (alem do fim): tolera excecao previa que
  // tenha abortado um dropShip anterior com residuo no DROP_KEYS
  DROP_KEYS.length = 0;
  const ship = fleet.ships.get(id);
  if (ship) killRunsOf(fleet, ship);
  fleet.ships.delete(id);
  fleet.trails.delete(id);
  fleet.seenTs.delete(`s:${id}`);
  // coleta no scratch e deleta DEPOIS: nada de mutar o Map durante keys()
  const prefix = `b:${id}/`;
  for (const key of fleet.seenTs.keys()) {
    if (key.startsWith(prefix)) DROP_KEYS.push(key);
  }
  for (const key of DROP_KEYS) fleet.seenTs.delete(key);
  DROP_KEYS.length = 0;
}

function expireShips(fleet, chosen, now) {
  for (const [id, ship] of fleet.ships) {
    if (hasSession(chosen, id)) continue;
    if (ship.gone === null) {
      ship.gone = now;
      // F5.7: o rito de saida depende do estado NO MOMENTO do gone
      // (ativa/ociosa => warp; dormindo => dissolve) — congelado aqui.
      ship.goneState = ship.state;
    }
    if (now - ship.gone > GONE_CLEAR_MS) dropShip(fleet, id);
  }
}

// ----------------------------------------------------------------- drones

// B: tool corrente do subagent (currentAction.tool, fallback lastTool) para
// o draw rotular o drone com o que ele esta fazendo agora.
function droneTool(sub) {
  const a = sub && sub.currentAction;
  return a && a.tool ? String(a.tool) : (sub && sub.lastTool ? String(sub.lastTool) : null);
}

// Drones nao guardam mais angle/speed: o fleet-draw os posiciona em ARCO even
// por indice (fanAngle), sem orbita a deriva que os amontoava.
function makeDrone(sub, now) {
  return {
    id: sub.id,
    label: sub.label || 'subagent',
    tool: droneTool(sub),
    active: sub.active !== false,
    born: now,
    gone: null,
  };
}

function findDrone(drones, id) {
  for (const d of drones) {
    if (d.id === id) return d;
  }
  return null;
}

// Mesma janela do sync: so os primeiros DRONES_PER_SHIP subagents validos.
function subWithinCap(subs, id) {
  let seen = 0;
  for (const sub of subs) {
    if (!sub || !sub.id) continue;
    if (sub.id === id) return true;
    seen += 1;
    if (seen >= FLEET_CAPS.DRONES_PER_SHIP) return false;
  }
  return false;
}

function expireDrones(ship, subs, now) {
  for (let i = ship.drones.length - 1; i >= 0; i -= 1) {
    const d = ship.drones[i];
    if (!subWithinCap(subs, d.id) && d.gone === null) d.gone = now;
    if (d.gone !== null && now - d.gone > DRONE_GONE_FADE_MS) ship.drones.splice(i, 1);
  }
}

// Drones sincronizados por CHAVE subagent.id (estavel por jsonl do
// subagent): novo => born agora; sumiu => gone agora; voltou => revive.
function syncDrones(ship, session, now) {
  const subs = Array.isArray(session.subagents) ? session.subagents : EMPTY_TRAIL;
  let live = 0;
  let total = 0;
  for (const sub of subs) {
    if (!sub || !sub.id) continue;
    total += 1; // conta TODOS (mesmo alem do cap) para o badge de contagem
    if (live >= FLEET_CAPS.DRONES_PER_SHIP) continue;
    live += 1;
    const drone = findDrone(ship.drones, sub.id);
    if (drone) {
      drone.active = sub.active !== false;
      drone.label = sub.label || drone.label;
      drone.tool = droneTool(sub);
      drone.gone = null;
    } else {
      ship.drones.push(makeDrone(sub, now));
    }
  }
  ship.subCount = total;
  expireDrones(ship, subs, now);
}

// ----------------------------------------------------------------- trilha

function pushTrail(fleet, sessionId, node, now) {
  let trail = fleet.trails.get(sessionId);
  if (!trail) {
    trail = [];
    fleet.trails.set(sessionId, trail);
  }
  const last = trail[trail.length - 1];
  if (last && last.node === node) {
    last.ts = now; // dedup consecutivo do mesmo node: so renova o TTL
    return;
  }
  trail.push({ node, ts: now });
  if (trail.length > FLEET_CAPS.TRAIL_POINTS) trail.shift();
}

// Centroide do ULTIMO ponto vivo (CENTROID_MAX=1): a nave POUSA exatamente no
// node corrente (sem lift no mundo; o draw repousa a nave acima da estrela em
// px de tela).
function trailCentroid(trail, out) {
  const n = Math.min(trail.length, CENTROID_MAX);
  if (n === 0) return false;
  let sx = 0;
  let sy = 0;
  for (let i = trail.length - n; i < trail.length; i += 1) {
    sx += trail[i].node.px;
    sy += trail[i].node.py;
  }
  out.x = sx / n;
  out.y = sy / n;
  return true;
}

// Nave ociosa/dormindo VOLTA PARA A BASE imediatamente (nao espera o trail
// expirar): so a nave ATIVA paira sobre o trabalho.
function isDocked(ship) {
  return ship.state === 'ociosa' || ship.state === 'dormindo';
}

// Alvo da nave por sync:
// - ociosa/dormindo => DOCA central (parked), alvo = ship.hx/hy ja resolvido.
// - ativa com trail => segue o ULTIMO node do trail (CENTROID_MAX=1), EMA
//   suave para nao teleportar entre arquivos; ativa sem trail => doca.
// Transicao parked<->voando e nave nova fazem set direto (a spring do step
// suaviza a viagem); a EMA so amortece a flutuacao entre nodes.
function retargetShip(fleet, ship, isNew) {
  const docked = isDocked(ship);
  const trail = docked ? null : fleet.trails.get(ship.id);
  const hasTarget = trail && trail.length ? trailCentroid(trail, SPOT) : false;
  if (!hasTarget) {
    SPOT.x = ship.hx;
    SPOT.y = ship.hy;
  }
  const wasParked = ship.parked;
  ship.parked = !hasTarget;
  if (isNew || wasParked !== ship.parked) {
    ship.tx = SPOT.x;
    ship.ty = SPOT.y;
    return;
  }
  ship.tx += (SPOT.x - ship.tx) * EMA_FACTOR;
  ship.ty += (SPOT.y - ship.ty) * EMA_FACTOR;
}

// ------------------------------------------------------- runs e protoStars

function bezierCtrl(x0, y0, x1, y1, side) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy) || 1;
  const bend = clamp(dist * CTRL_BEND_FACTOR, CTRL_BEND_MIN, CTRL_BEND_MAX) * side;
  return {
    x: (x0 + x1) / 2 + (-dy / dist) * bend,
    y: (y0 + y1) / 2 + (dx / dist) * bend,
  };
}

function spawnRun(fleet, ship, node, action, now, variant) {
  fleet.runSeq += 1;
  fleet.runs.push({
    id: fleet.runSeq,
    ship,
    node,
    color: ship.color,
    variant, // F5.8: 'file' (holo-livro) | 'ping' (radio ate estacao MCP)
    dir: WRITE_TOOLS.has(action.tool) ? 'write' : 'read',
    ctrl: bezierCtrl(ship.x, ship.y, node.px, node.py, fleet.runSeq % 2 === 0 ? 1 : -1),
    start: now,
    phase: 'out',
    arrived: false, // garante arrival unico mesmo num frame longo
  });
}

// F5.9-v2: groups voltaram a ser os nomes raiz PARA ('3-Resources'); o
// LONGEST prefix match com fronteira de segmento continua correto com 1
// nivel ('3-Resources' NAO casa '3-Resources-x/y.md') e ja cobriria um
// eventual retorno de groups compostos. Empate impossivel (groups unicos).
function matchGalaxy(universe, normPath) {
  const galaxies = universe && Array.isArray(universe.galaxies) ? universe.galaxies : EMPTY_TRAIL;
  const path = normPath.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const gal of galaxies) {
    const group = String(gal.group || '').toLowerCase();
    if (!group || group.length <= bestLen) continue;
    if (path === group || path.startsWith(`${group}/`)) {
      best = gal;
      bestLen = group.length;
    }
  }
  return best;
}

// Write em path sem node resolvido NUNCA e silencioso: nasce uma
// protoestrela na galaxia inferida pelo prefixo do path; sem match, no
// anel externo (extent*1.02, angulo deterministico por hash do path).
function spawnProtoStar(fleet, ship, vaultPath, ctx, now) {
  const norm = vaultPath.replace(/\\/g, '/');
  const angle = hashFrac(norm) * TAU;
  const gal = matchGalaxy(ctx.universe, norm);
  let x;
  let y;
  if (gal) {
    const r = (gal.minOrbit + gal.radius) / 2;
    x = gal.cx + Math.cos(angle) * r;
    y = gal.cy + Math.sin(angle) * r;
  } else {
    const extent = (ctx.universe && Number(ctx.universe.extent)) || 600;
    x = Math.cos(angle) * extent * PROTO_RING;
    y = Math.sin(angle) * extent * PROTO_RING;
  }
  fleet.protoStars.push({ x, y, color: ship.color, start: now });
}

function resolveActionNode(ctx, vaultPath) {
  if (typeof ctx.resolveNode !== 'function') return null;
  try {
    return ctx.resolveNode(vaultPath)
      || ctx.resolveNode(vaultPath.replace(/\.md$/i, ''))
      || null;
  } catch {
    return null;
  }
}

// Acao nova com node: reduced ou cap de runs estourado => so flare;
// senao nasce um run completo (out -> scan -> back). INVARIANTE
// reduced-motion: com ctx.reduced NENHUM run nasce (qualquer spawn vira
// flare imediato AQUI, no sync) — por isso o stepFleet snap que o engine
// roda fora do frame() nunca tem arrival para perder.
function fireRunOrFlare(fleet, ship, node, action, ctx, now, variant) {
  if (ctx.reduced || fleet.runs.length >= FLEET_CAPS.RUNS) {
    fireFlare(ctx, node.id, ship.color);
    return;
  }
  spawnRun(fleet, ship, node, action, now, variant);
}

// C: WebSearch/WebFetch viram run 'ping' ate a estacao 'web' (id 'mcp:web'
// para resolver pelo stationById). Estacao ausente (payload/universo antigo)
// => silencio total, igual ao firePing.
function fireWeb(fleet, ship, action, ctx, now) {
  const station = resolveStation(ctx, 'mcp:web');
  if (!station) return;
  fireRunOrFlare(fleet, ship, station, action, ctx, now, 'ping');
}

// F5.8: acao mcp__* (mcpServer extraido pelo server) sem vaultPath vira
// run 'ping' ate a estacao 'mcp:<id>'. Estacao ausente (payload velho,
// cap de stations, resolveNode parcial) => silencio total. A estacao
// NUNCA entra no trail: trail e so de arquivos.
function firePing(fleet, ship, action, ctx, now) {
  const server = typeof action.mcpServer === 'string' ? action.mcpServer : '';
  if (!server) return;
  const station = resolveStation(ctx, `mcp:${server}`);
  if (!station) return;
  fireRunOrFlare(fleet, ship, station, action, ctx, now, 'ping');
}

// F7: livro da biblioteca por LABEL normalizado (trim + lowercase nos
// dois lados). Devolve null se o livro nao for node-like (px/py).
function findBookByLabel(books, norm) {
  for (const b of books) {
    if (!b || typeof b.label !== 'string') continue;
    if (b.label.trim().toLowerCase() !== norm) continue;
    return Number.isFinite(b.px) && Number.isFinite(b.py) ? b : null;
  }
  return null;
}

// F7: acao Skill com target vira run 'skill' ate o livro correspondente.
// Primeiro match direto em universe.books (label normalizado), depois
// fallback no resolveNode('skill:<target>') do engine. Sem livro =>
// silencio total (skill fora do top 12 da biblioteca).
function fireSkill(fleet, ship, action, ctx, now) {
  const target = typeof action.target === 'string' ? action.target.trim() : '';
  if (!target) return;
  const norm = target.toLowerCase();
  const books = ctx.universe && Array.isArray(ctx.universe.books) ? ctx.universe.books : null;
  const book = (books && findBookByLabel(books, norm)) || resolveStation(ctx, `skill:${norm}`);
  if (!book) return;
  fireRunOrFlare(fleet, ship, book, action, ctx, now, 'skill');
}

// Estacao precisa ser node-like (px/py numericos) para a bezier do run.
function resolveStation(ctx, id) {
  if (typeof ctx.resolveNode !== 'function') return null;
  try {
    const station = ctx.resolveNode(id);
    if (!station) return null;
    return Number.isFinite(station.px) && Number.isFinite(station.py) ? station : null;
  } catch {
    return null;
  }
}

function handleAction(fleet, ship, action, ctx, isSeed, now) {
  const vaultPath = typeof action.vaultPath === 'string' ? action.vaultPath : '';
  if (!vaultPath) {
    // sem vaultPath: Skill vira run ate o livro (F7), mcp__* vira ping
    // na estacao; o resto a nave so segue
    if (isSeed) return;
    if (action.tool === 'Skill') fireSkill(fleet, ship, action, ctx, now);
    else if (WEB_TOOLS.has(action.tool)) fireWeb(fleet, ship, action, ctx, now);
    else firePing(fleet, ship, action, ctx, now);
    return;
  }
  const node = resolveActionNode(ctx, vaultPath);
  if (node) {
    // trail sempre (seed inclusive: nave nasce sobre a area de trabalho);
    // efeitos (run/flare) so depois da primeira leva
    pushTrail(fleet, ship.id, node, now);
    if (!isSeed) fireRunOrFlare(fleet, ship, node, action, ctx, now, 'file');
    return;
  }
  if (!isSeed && WRITE_TOOLS.has(action.tool)) {
    spawnProtoStar(fleet, ship, vaultPath, ctx, now);
  }
}

// Diff por action.ts (mesma logica do useActionDiff do TorreView F4, que
// morre no F5): chave s:<id> para a sessao, b:<id>/<subId> por subagent.
function checkAction(fleet, ship, key, action, ctx, isSeed, now) {
  if (!action || typeof action !== 'object' || !action.ts) return;
  if (fleet.seenTs.get(key) === action.ts) return;
  fleet.seenTs.set(key, action.ts);
  handleAction(fleet, ship, action, ctx, isSeed, now);
}

function diffActions(fleet, ship, session, ctx, isSeed, now) {
  checkAction(fleet, ship, `s:${session.id}`, session.currentAction, ctx, isSeed, now);
  const subs = Array.isArray(session.subagents) ? session.subagents : EMPTY_TRAIL;
  for (const sub of subs) {
    if (!sub || !sub.id) continue;
    checkAction(fleet, ship, `b:${session.id}/${sub.id}`, sub.currentAction, ctx, isSeed, now);
  }
}

// ------------------------------------------------------------- syncFleet

// Chamado quando sessions chegam do SSE (nao por frame).
// ctx = { universe, resolveNode(id)=>node|null, colorOf(project)=>hex,
//         now, reduced, onFlare(nodeId, color) }.
// sessions null/undefined (boot, SSE ainda sem payload) = no-op: nao
// consome o seed nem derruba a frota; a primeira leva REAL e o seed.
// Slot da doca central por id: ordem ESTAVEL (lexicografica por id) sobre
// o conjunto vivo escolhido. Devolve um Map id->slot e o total ancorado;
// como o conjunto muda quando naves entram/saem, isso e recalculado por
// sync e reescrito em cada ship.hx/hy (a doca compacta nunca pula buracos).
function dockSlots(chosen) {
  const ids = [];
  for (const s of chosen) ids.push(s.id);
  ids.sort();
  const slotOf = new Map();
  for (let i = 0; i < ids.length; i += 1) slotOf.set(ids[i], i);
  return { slotOf, total: ids.length };
}

// Re-deriva a doca de uma nave a partir do slot/total atuais e atualiza
// hx/hy. Nave PARADA na doca tem o alvo (tx/ty) realinhado junto, para o
// reempacotamento aparecer (a spring desliza ate o novo slot). Nave em voo
// so guarda a doca nova: ela so vale quando ela ficar ociosa/dormindo.
function applyDock(ctx, ship, slot, total) {
  ship.dockSlot = Number.isFinite(slot) ? slot : 0; // F5b: re-target VIVO por frame
  ship.dockTotal = Number.isFinite(total) && total > 0 ? total : 1;
  hangarSpot(ctx.universe, slot, total, SPOT);
  ship.hx = SPOT.x;
  ship.hy = SPOT.y;
  if (ship.parked) {
    ship.tx = SPOT.x;
    ship.ty = SPOT.y;
  }
}

export function syncFleet(fleet, sessions, ctx) {
  if (!fleet || !ctx || !Array.isArray(sessions)) return;
  const now = Number.isFinite(ctx.now) ? ctx.now : performance.now();
  const isSeed = !fleet.seeded;
  fleet.seeded = true;
  const chosen = pickSessions(sessions);
  const { slotOf, total } = dockSlots(chosen);
  for (const session of chosen) {
    let ship = fleet.ships.get(session.id);
    const isNew = !ship;
    const slot = slotOf.get(session.id);
    if (isNew) {
      ship = createShip(session, ctx, now, slot, total);
      fleet.ships.set(session.id, ship);
    } else {
      refreshShip(ship, session, ctx, now);
      applyDock(ctx, ship, slot, total);
    }
    syncDrones(ship, session, now);
    diffActions(fleet, ship, session, ctx, isSeed, now);
    retargetShip(fleet, ship, isNew);
  }
  expireShips(fleet, chosen, now);
}

// -------------------------------------------------------------- stepFleet

// Bezier quadratica compartilhada com o draw (W2). Devolve um scratch
// REUTILIZADO (zero alloc): copiar x/y antes da proxima chamada.
export function bezierPoint(p0, ctrl, p1, t) {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  BEZ_OUT.x = a * p0.x + b * ctrl.x + c * p1.x;
  BEZ_OUT.y = a * p0.y + b * ctrl.y + c * p1.y;
  return BEZ_OUT;
}

function decayTrails(fleet, now) {
  for (const trail of fleet.trails.values()) {
    while (trail.length && now - trail[0].ts > FLEET_CAPS.TRAIL_TTL_MS) trail.shift();
  }
}

function decayRipples(fleet, now) {
  let w = 0;
  for (let i = 0; i < fleet.ripples.length; i += 1) {
    const r = fleet.ripples[i];
    if (now - r.start < r.dur + RIPPLE_LINGER_MS) {
      fleet.ripples[w] = r;
      w += 1;
    }
  }
  fleet.ripples.length = w;
}

function decayProtoStars(fleet, now) {
  let w = 0;
  for (let i = 0; i < fleet.protoStars.length; i += 1) {
    const p = fleet.protoStars[i];
    if (now - p.start < PROTO_TTL_MS) {
      fleet.protoStars[w] = p;
      w += 1;
    }
  }
  fleet.protoStars.length = w;
}

// Trail expirou por TTL entre syncs => nave volta para a vaga de hangar.
function retargetIfEmptied(fleet, ship) {
  if (ship.parked) return;
  const trail = fleet.trails.get(ship.id);
  if (trail && trail.length) return;
  ship.parked = true;
  ship.tx = ship.hx;
  ship.ty = ship.hy;
}

// Alvo da spring = o alvo cru (tx,ty). A nave ATIVA POUSA e fica PARADA no
// node (sem micro-drift orbital): "não flutua". O movimento vivo vem do anel
// pulsante, dos drones orbitando e do conduite — não do corpo da nave.
// Mantido como indireção p/ o scratch SPOT (zero alloc).
function shipAim(ship, out) {
  out.x = ship.tx;
  out.y = ship.ty;
  return out;
}

// F5b: a doca REVOLVE (updatePositions gira universe.dockAngle por frame). A
// vaga (hx/hy) foi gravada no sync com a doca de ENTAO; sem re-target a nave
// ociosa ficaria PARA TRAS do giro. Aqui, por frame, a nave PARADA re-deriva a
// vaga da doca VIVA pelo seu slot estavel -> acompanha a revolucao colada. So
// global (no local sem dockAngle, hangarSpot cai no fallback estatico = sem giro).
function refreshDockTarget(ship, universe) {
  if (!universe || !ship.parked || !Number.isFinite(ship.dockSlot)) return;
  hangarSpot(universe, ship.dockSlot, ship.dockTotal, SPOT);
  ship.hx = SPOT.x;
  ship.hy = SPOT.y;
  ship.tx = SPOT.x;
  ship.ty = SPOT.y;
}

// UI: separacao anti-colisao entre naves (mundo). Sem isso, varias naves no
// MESMO no/hub/doca pousam no mesmo ponto e viram sopa ilegivel (img #4 e o
// blob do hub central). Relaxacao O(n^2) com n<=12 (barato): empurra cada par
// sobreposto pra metade do overlap. Roda DEPOIS do spring, todo frame.
const SHIP_SEP = 26; // distancia minima entre naves (mundo)
function separateShips(fleet) {
  const ships = [];
  for (const s of fleet.ships.values()) if (!s.gone) ships.push(s);
  for (let i = 0; i < ships.length; i += 1) {
    for (let j = i + 1; j < ships.length; j += 1) {
      const a = ships[i];
      const b = ships[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d > SHIP_SEP) continue;
      if (d < 0.01) { dx = i % 2 ? 1 : -1; dy = j % 2 ? 1 : -1; d = Math.hypot(dx, dy); }
      const push = (SHIP_SEP - d) * 0.5;
      const ux = dx / d;
      const uy = dy / d;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;
    }
  }
}

// Spring criticamente amortecida ate (tx, ty); reduced=true => snap.
function stepShips(fleet, dt, reduced, universe) {
  for (const ship of fleet.ships.values()) {
    retargetIfEmptied(fleet, ship);
    refreshDockTarget(ship, universe); // F5b: nave docada segue a doca revolvendo
    if (reduced) {
      ship.x = ship.tx;
      ship.y = ship.ty;
      ship.vx = 0;
      ship.vy = 0;
      stepHeading(ship, true); // F-art: snap no goal (parado => nariz pra cima)
      continue;
    }
    const aim = shipAim(ship, SPOT);
    const ax = (aim.x - ship.x) * SPRING_K - ship.vx * SPRING_DAMP;
    const ay = (aim.y - ship.y) * SPRING_K - ship.vy * SPRING_DAMP;
    ship.vx += ax * dt;
    ship.vy += ay * dt;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    stepHeading(ship, false); // F-art: gira suave pro alvo em transito
  }
  if (!reduced) separateShips(fleet);
}

// Particulas do run: claim no pool fixo quando a sonda chega (inicio da
// fase scan); 12 (read) / 14 (write), offsets espacados 0..1.
function claimParticles(fleet, run) {
  const count = run.dir === 'write' ? PARTICLES_WRITE : PARTICLES_READ;
  const pool = fleet.particles;
  let claimed = 0;
  for (let i = 0; i < pool.length && claimed < count; i += 1) {
    const p = pool[i];
    if (p.active) continue;
    p.active = true;
    p.run = run;
    p.offset = claimed / count;
    p.size = PARTICLE_SIZE_MIN + ((claimed % 6) / 5) * PARTICLE_SIZE_SPAN;
    p.x = run.ship.x;
    p.y = run.ship.y;
    claimed += 1;
  }
}

function releaseParticles(fleet, run) {
  for (const p of fleet.particles) {
    if (p.run === run) {
      p.active = false;
      p.run = null;
    }
  }
}

// Fase derivada do tempo decorrido; arrival dispara UMA vez mesmo se um
// frame longo pular a fase out inteira (tab voltando do background).
function advancePhase(fleet, run, elapsed) {
  if (!run.arrived && elapsed >= RUN_OUT_MS) {
    run.arrived = true;
    fleet.arrivals.push(run);
    claimParticles(fleet, run);
  }
  if (elapsed < RUN_OUT_MS) run.phase = 'out';
  else if (elapsed < RUN_OUT_MS + RUN_SCAN_MS) run.phase = 'scan';
  else if (elapsed < RUN_OUT_MS + RUN_SCAN_MS + RUN_BACK_MS) run.phase = 'back';
  else run.phase = 'done';
}

function stepRuns(fleet, now) {
  let w = 0;
  for (let i = 0; i < fleet.runs.length; i += 1) {
    const run = fleet.runs[i];
    advancePhase(fleet, run, now - run.start);
    if (run.phase === 'done') {
      fleet.finished.push(run);
      releaseParticles(fleet, run); // morrem no fim da fase back
    } else {
      fleet.runs[w] = run;
      w += 1;
    }
  }
  fleet.runs.length = w;
}

// reduced ligou com runs em voo: descarta sem efeitos e libera o pool.
// NUNCA empurra em arrivals/finished — o snap reduced e silencioso (o
// flare da acao ja saiu no syncFleet via fireRunOrFlare).
function drainRuns(fleet) {
  for (const run of fleet.runs) releaseParticles(fleet, run);
  fleet.runs.length = 0;
}

// Fluxo na bezier do run com offset: read = node -> ship (t invertido);
// write = ship -> node. Posicoes vivas (nave e node se movem), ctrl fixo.
function moveParticle(p, now) {
  const run = p.run;
  const raw = (now - run.start - RUN_OUT_MS) / PARTICLE_FLOW_MS + p.offset;
  const flow = ((raw % 1) + 1) % 1; // modulo sempre em [0,1), raw negativo incluso
  const t = run.dir === 'read' ? 1 - flow : flow;
  BEZ_P0.x = run.ship.x;
  BEZ_P0.y = run.ship.y;
  BEZ_P1.x = run.node.px;
  BEZ_P1.y = run.node.py;
  const pt = bezierPoint(BEZ_P0, run.ctrl, BEZ_P1, t);
  p.x = pt.x;
  p.y = pt.y;
}

function stepParticles(fleet, now, reduced) {
  if (reduced) return;
  for (const p of fleet.particles) {
    if (p.active && p.run) moveParticle(p, now);
  }
}

// Integracao por frame (mundo, dt em segundos). reduced=true => snap nos
// alvos, sem runs/particulas (acoes novas viram flare direto no syncFleet).
// universe (F5b, opcional): naves docadas re-derivam a vaga da doca VIVA
// (que revolve) por frame; ausente => doca tratada como estatica.
// Devolve { arrivals, finished }: scratch arrays do fleet, lidos in-place
// pelo engine no mesmo frame - zero alocacao aqui.
export function stepFleet(fleet, dt, now, reduced, universe) {
  if (!fleet) return EMPTY_FX;
  fleet.arrivals.length = 0;
  fleet.finished.length = 0;
  decayTrails(fleet, now);
  stepShips(fleet, dt, reduced, universe);
  if (reduced) drainRuns(fleet);
  else stepRuns(fleet, now);
  stepParticles(fleet, now, reduced);
  decayRipples(fleet, now);
  decayProtoStars(fleet, now);
  return fleet.fx;
}

// ---------------------------------------------------------------- leitura

// Ripples VIVOS (t < 1): os em linger (janela de halo RIPPLE_LINGER_MS
// pos-dur) ficam no array para o draw mas nao contam para o cap.
function countLiveRipples(fleet, now) {
  let live = 0;
  for (const r of fleet.ripples) {
    if (now - r.start < r.dur) live += 1;
  }
  return live;
}

// FONTE UNICA da propagacao de energia (o engine/P3 importa daqui, nao
// duplica): ate 4 ripples por arrival pelos links reais do node tocado.
// Cap RIPPLES conta so ripples vivos — linger nao bloqueia spawn novo.
export function spawnRipples(fleet, node, adjacency, now) {
  if (!fleet || !node || !adjacency || typeof adjacency.get !== 'function') return;
  const links = adjacency.get(node.id);
  if (!links) return;
  let live = countLiveRipples(fleet, now);
  const max = Math.min(links.length, RIPPLES_PER_ARRIVAL);
  for (let i = 0; i < max; i += 1) {
    if (live >= FLEET_CAPS.RIPPLES) return;
    const link = links[i];
    const other = link.a === node ? link.b : link.a;
    if (!other) continue;
    fleet.ripples.push({ a: node, b: other, start: now, dur: RIPPLE_DUR_MS });
    live += 1;
  }
}

// Pontos vivos do trail para o draw (W2). Devolve o array interno (nao
// mutar fora do model); sessao sem trail => array vazio compartilhado.
export function trailPath(fleet, sessionId) {
  if (!fleet) return EMPTY_TRAIL;
  return fleet.trails.get(sessionId) || EMPTY_TRAIL;
}
