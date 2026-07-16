// FAROL - graph-engine.js (A2, F3+F4; W3 na F5): engine canvas do
// grafo-universo. Dono do rAF, da camera (zoom/pan), da interacao
// (hover/click/drag/wheel), do tooltip DOM, do relogio das orbitas, dos
// flares e da integracao da FROTA (F5): sessions entram por
// setEngineSessions, o estado vivo mora em eng.fleet (fleet-model.js) e o
// render nas camadas de fleet-draw.js (W2). API imperativa consumida pelo
// Graph.jsx via onReady: nodeScreenPoint/addFlare/focusNote/engineViewport
// + shipScreenPoint/listShipPoints/setFollowShip. O desenho do universo
// vive em graph-draw.js; o modelo em graph-universe.js.
// Performance: rAF pausa com document.hidden; prefers-reduced-motion
// congela o relogio (orbitas estaticas; frota snap via stepFleet 1x por
// sync, sem runs por frame); devicePixelRatio cap 2; arrivals/finished do
// fleet sao scratch arrays lidos in-place (zero alocacao no hot path).
// F5.8 (P3): estacoes MCP do universo entram no pick/tooltip e avancam em
// updatePositions; ids 'mcp:*' resolvem via universe.stationById (e o que
// liga os runs 'ping' do fleet aos satelites). Click em estacao e no-op.
// F7: livros da BIBLIOTECA (universe.books) avancam em updatePositions,
// ids 'skill:*' resolvem via bookById (com fallback por label normalizado
// para os runs 'skill' do fleet), entram no pick/tooltip, e o click no
// NUCLEO da estacao (raio 26px de tela em (0,0), quando ha beacon) anima
// a camera para o hub com k alvo 2.2 — o "mergulho na estacao".
import { clamp, cleanGroup, makeStarfield, relTime, truncate } from './graph-universe.js';
import { drawFrame } from './graph-draw.js';
import { createFleet, spawnRipples, stepFleet, syncFleet } from './fleet-model.js';

const DPR_CAP = 2;
const CLICK_SLOP_PX = 5;
const PICK_RADIUS_PX = 14;
// F5: abaixo deste zoom as notas estao ESCONDIDAS (LOD do graph-draw) e NAO
// entram no pick (senao o clique abriria uma nota invisivel em vez de mergulhar
// na galaxia). Acima, notas visiveis e clicaveis. ~ NOTE_HIDE_K do draw.
const NOTE_PICK_K = 0.4;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;
const FOCUS_MS = 650;
// Frota (F5): tamanhos-base em px de tela por variante (mesma constante
// visual do fleet-draw; F7 subiu mother 26 / cargo 18 em tandem com o
// redesenho HD); hit minimo de 14px; lerp do follow. Ripples de chegada
// vivem no fleet-model (spawnRipples e a fonte unica do cap).
const SHIP_BASE_PX = { mother: 26, cargo: 18 };
const SHIP_HIT_MIN_PX = 14;
const FOLLOW_LERP = 0.12;
const FLEET_FLARE_TTL_MS = 1600;
const FALLBACK_SHIP_COLOR = '#5d6b78';
// F7: hit do nucleo da estacao (px de tela) e zoom alvo do mergulho.
const HUB_HIT_PX = 26;
const HUB_FOCUS_K = 2.2;
// 2.5D (cam3): inclinacao base do plano + balanco idle do yaw (universo
// vivo). O balanco usa sin(eng.time*speed)*amp; congela com reduced-motion
// (eng.time para) e pausa em drag. cos(yaw) e cos(tilt) nunca chegam perto
// de 0 com esses valores, entao screenToWorld (que divide por eles) e estavel.
const TILT_BASE = 0.55;
const YAW_AMP = 0.32;
const YAW_SPEED = 0.14;

// ------------------------------------------------------------ ciclo de vida

export function createEngine(opts) {
  const eng = {
    canvas: opts.canvas,
    container: opts.container,
    tooltipEl: opts.tooltipEl,
    universe: opts.universe,
    onOpen: opts.onOpen,
    ctx: opts.canvas.getContext('2d'),
    cam: { k: 1, tx: 0, ty: 0 },
    // cam3 (2.5D): profundidade pseudo-3D sobre a camera afim. yaw gira o
    // universo (rotacao Y), tilt inclina o plano, flatten (0..1) achata no
    // mergulho numa galaxia. Tudo 0 = render afim identico ao legado.
    cam3: { yaw: 0, tilt: TILT_BASE, flatten: 0, manual: false },
    w: 0,
    h: 0,
    dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
    time: 0,
    lastNow: performance.now(),
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    running: true,
    destroyed: false,
    raf: 0,
    dirty: true,
    fitted: false,
    hover: null,
    dragging: false,
    downAt: null,
    camStart: null,
    pointers: new Map(), // pointerId -> [clientX, clientY] (touch multi-dedo)
    pinch: null, // { dist, k } durante gesto de pinca
    pinchedRecently: false, // suprime o click residual pos-pinca
    search: { q: '', set: null },
    showLinks: opts.showLinks !== false,
    focusAnim: null,
    flashNode: null,
    flashUntil: 0,
    flares: [],
    // Q5 foco: nós sendo TRABALHADOS agora (vaultPath ativo) + focusSet
    // (ativos + vizinhos via adjacency). Vazio => universo normal, sem dim.
    activeNodes: new Set(),
    focusSet: null,
    lowerIds: null,
    // 2.5D: scratch reusado por frame para o depth-sort das notas em
    // drawNotes (painter's algorithm). Reusar evita alocar um array novo
    // por frame no hot path do render.
    _zsort: [],
    stars: makeStarfield(),
    sessions: null,
    fleet: createFleet(),
    followShipId: null,
    hoverShipId: null, // FB: nave em HOVER (abre o leque de drones rotulado no draw)
    onShipSelect: opts.onShipSelect,
    colorOf: typeof opts.colorOf === 'function' ? opts.colorOf : () => FALLBACK_SHIP_COLOR,
    // fitZoom: multiplicador do zoom-to-fit. >1 e um VIEWPORT (janela da
    // estacao): em vez de caber o universo inteiro num strip baixo (que
    // deixa as galaxias minusculas no centro com bordas vazias), aproxima
    // pra elas PREENCHEREM o vidro -- cortar topo/base e desejado (uma
    // janela mostra um pedaco enquadrado, nao tudo encolhido). 1 = fit
    // normal (view Grafo/TORRE inteira).
    fitZoom: Number.isFinite(opts.fitZoom) && opts.fitZoom > 0 ? opts.fitZoom : 1,
  };
  attachTooltipRefs(eng);
  attachResize(eng);
  attachPointer(eng);
  attachKeyboard(eng);
  attachVisibility(eng);
  eng.raf = requestAnimationFrame((n) => frame(eng, n));
  return eng;
}

export function destroyEngine(eng) {
  eng.destroyed = true;
  eng.running = false;
  cancelAnimationFrame(eng.raf);
  eng.observer.disconnect();
  eng.removeInput();
  if (eng.removeKeys) eng.removeKeys();
  document.removeEventListener('visibilitychange', eng.onVis);
}

// Atalho de teclado: 'f' ou '0' reenquadra todo o universo (zoom-to-fit).
// Ignora quando o foco esta num input/textarea (a busca do HUD) para nao
// roubar a tecla enquanto o usuario digita. Listener no window porque o
// canvas nao recebe foco de teclado por padrao.
function attachKeyboard(eng) {
  const onKey = (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (ev.key === 'f' || ev.key === 'F' || ev.key === '0') {
      ev.preventDefault();
      fitView(eng);
    } else if (ev.key === 'Escape' && eng.followGalaxy) {
      // F5: Esc sai do mergulho (solta o follow e reenquadra o universo).
      eng.followGalaxy = null;
      fitView(eng);
    }
  };
  window.addEventListener('keydown', onKey);
  eng.removeKeys = () => window.removeEventListener('keydown', onKey);
}

function attachTooltipRefs(eng) {
  if (!eng.tooltipEl) return;
  eng.ttTitle = eng.tooltipEl.querySelector('.graph-tt-title');
  eng.ttMeta = eng.tooltipEl.querySelector('.graph-tt-meta');
  eng.ttSub = eng.tooltipEl.querySelector('.graph-tt-sub');
}

function attachResize(eng) {
  eng.observer = new ResizeObserver((entries) => {
    const rect = entries[0] && entries[0].contentRect;
    if (!rect || rect.width < 16 || rect.height < 16) return;
    eng.w = rect.width;
    eng.h = rect.height;
    eng.canvas.width = Math.round(rect.width * eng.dpr);
    eng.canvas.height = Math.round(rect.height * eng.dpr);
    if (!eng.fitted) {
      eng.fitted = true;
      fitCamera(eng);
    }
    eng.dirty = true;
  });
  eng.observer.observe(eng.container);
}

// rAF pausa quando a tab some; ao voltar, re-ancora o relogio para a
// orbita nao saltar (time so avanca com a tab visivel).
function attachVisibility(eng) {
  eng.onVis = () => {
    if (document.hidden) {
      eng.running = false;
      cancelAnimationFrame(eng.raf);
      return;
    }
    if (!eng.destroyed && !eng.running) {
      eng.running = true;
      eng.lastNow = performance.now();
      eng.dirty = true;
      eng.raf = requestAnimationFrame((n) => frame(eng, n));
    }
  };
  document.addEventListener('visibilitychange', eng.onVis);
}

function attachPointer(eng) {
  const c = eng.canvas;
  const down = (ev) => onPointerDown(eng, ev);
  const move = (ev) => onPointerMove(eng, ev);
  const up = (ev) => onPointerUp(eng, ev);
  const cancel = (ev) => onPointerCancel(eng, ev);
  const leave = () => { setHover(eng, null); setHoverShip(eng, null); };
  const wheel = (ev) => onWheel(eng, ev);
  c.addEventListener('pointerdown', down);
  c.addEventListener('pointermove', move);
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', cancel);
  c.addEventListener('pointerleave', leave);
  c.addEventListener('wheel', wheel, { passive: false });
  eng.removeInput = () => {
    c.removeEventListener('pointerdown', down);
    c.removeEventListener('pointermove', move);
    c.removeEventListener('pointerup', up);
    c.removeEventListener('pointercancel', cancel);
    c.removeEventListener('pointerleave', leave);
    c.removeEventListener('wheel', wheel);
  };
}

// ------------------------------------------------------------------- camera

// Inverso de project() no plano z=0. A projecao 2.5D em z=0 e a matriz
// afim [a,0 ; b,d] (a=k·cosYaw, b=-k·sinYaw·sinTilt, d=k·cosTilt) + translado
// (tx,ty); aqui invertemos para mapear tela->mundo (hit-test/pan/wheel).
// Sem rotacao cai no afim puro antigo (fast path).
function screenToWorld(eng, sx, sy) {
  const { k, tx, ty } = eng.cam;
  const c3 = eng.cam3;
  if (!c3 || (c3.yaw === 0 && c3.tilt === 0)) {
    return [(sx - tx) / k, (sy - ty) / k];
  }
  const a = k * Math.cos(c3.yaw);
  const b = -k * Math.sin(c3.yaw) * Math.sin(c3.tilt);
  const d = k * Math.cos(c3.tilt);
  const wx = Math.abs(a) > 1e-6 ? (sx - tx) / a : 0;
  const wy = Math.abs(d) > 1e-6 ? (sy - ty - b * wx) / d : 0;
  return [wx, wy];
}

// Projecao 2.5D: FONTE UNICA de world->screen. cam3 (yaw/tilt) adiciona
// profundidade pseudo-3D sobre a camera afim (cam.k/tx/ty), que continua
// sendo zoom + translado em screen-space, aplicado POS-rotacao (por isso o
// pan permanece natural sob tilt). Retorna {sx,sy,scale,depth}: scale para
// dimensionar sprites/labels por profundidade, depth para depth-sort.
// Com yaw=tilt=0 e z=0 reduz EXATAMENTE ao afim antigo (wx*k+tx, wy*k+ty),
// scale=k, depth=0 — contrato preservado para hit-test/tooltip/frota/API.
// Consumidores que so querem [sx,sy] usam o wrapper worldToScreen.
// 2.5D-real (W3): apos a rotacao, aplica perspectiva (persp = FOV/(FOV+z2))
// dobrada em scale E posicao — nota proxima fica maior e na frente, rotacao
// gera parallax. O denominador e clampado para nunca inverter/explodir.
const FOV = 2000;
export function project(eng, wx, wy, wz) {
  const { k, tx, ty } = eng.cam;
  const c3 = eng.cam3;
  const z = wz ?? 0;
  // fast path / identidade: sem rotacao nao paga trig nem perspectiva
  // (persp=1) -> hot path de overlays e contrato afim preservado.
  if (!c3 || (c3.yaw === 0 && c3.tilt === 0)) {
    return { sx: wx * k + tx, sy: wy * k + ty, scale: k, depth: z };
  }
  const cy = Math.cos(c3.yaw);
  const sy = Math.sin(c3.yaw);
  const x1 = wx * cy - z * sy; // yaw em torno do eixo Y (mistura x,z)
  const z1 = wx * sy + z * cy;
  const ct = Math.cos(c3.tilt);
  const st = Math.sin(c3.tilt);
  const y1 = wy * ct - z1 * st; // tilt em torno do eixo X (mistura y,z)
  const z2 = wy * st + z1 * ct;
  const persp = FOV / Math.max(FOV * 0.35, FOV + z2);
  return { sx: x1 * k * persp + tx, sy: y1 * k * persp + ty, scale: k * persp, depth: z2 };
}

// Wrapper fino: mantem o contrato [sx,sy] dos consumidores legados.
function worldToScreen(eng, wx, wy) {
  const p = project(eng, wx, wy, 0);
  return [p.sx, p.sy];
}

// Re-ancora a camera ciente da matriz 2.5D: devolve {tx,ty} que poem o
// ponto-mundo (wx,wy) sob o ponto-tela (sx,sy) com zoom k, considerando
// yaw/tilt. Sem isso o zoom/foco usaria a formula afim antiga e o mundo
// deslizaria sob o cursor quando yaw!=0 (review fix). Inverte a projecao
// em z=0: sx=k·cosΨ·wx+tx ; sy=(-k·sinΨ·sinΦ)·wx + k·cosΦ·wy + ty.
function camTargetFor(eng, sx, sy, wx, wy, k) {
  const { yaw, tilt } = eng.cam3;
  return {
    tx: sx - k * Math.cos(yaw) * wx,
    ty: sy + k * Math.sin(yaw) * Math.sin(tilt) * wx - k * Math.cos(tilt) * wy,
  };
}

function fitCamera(eng) {
  const extent = eng.universe.extent || 600;
  const base = clamp(Math.min(eng.w, eng.h) / (extent * 2), MIN_ZOOM, 1.4);
  // fitZoom (viewport, F-janela): aproxima alem do fit pra as galaxias
  // PREENCHEREM o vidro. Cap maior pra o over-zoom nao ser cortado.
  const k = clamp(base * eng.fitZoom, MIN_ZOOM, 3.2);
  eng.cam = { k, tx: eng.w / 2, ty: eng.h / 2 };
  eng.dirty = true;
}

// Reenquadra todo o universo (zoom-to-fit). Reutilizavel: alem do 1o fit
// automatico no attachResize, alimenta a tecla 'f'/'0' e a api imperativa
// (api.fitView). Anima a camera quando ha viewport e nao esta em reduced
// (animCamTo ja faz snap com reduced); solta o follow para o reenquadre
// nao ser sequestrado pela nave. Sem viewport ainda, e no-op seguro.
export function fitView(eng) {
  if (!eng || !eng.w) return false;
  const extent = eng.universe.extent || 600;
  const base = clamp(Math.min(eng.w, eng.h) / (extent * 2), MIN_ZOOM, 1.4);
  const k = clamp(base * eng.fitZoom, MIN_ZOOM, 3.2);
  eng.followShipId = null;
  eng.followGalaxy = null; // F5: reenquadrar sai do mergulho
  // Reenquadrar e a acao explicita de "resetar a vista": devolve o controle
  // ao balanco idle (review fix: cam3.manual nao tinha caminho de reset).
  eng.cam3.manual = false;
  animCamTo(eng, eng.w / 2, eng.h / 2, k);
  eng.dirty = true;
  return true;
}

function animCamTo(eng, tx, ty, k) {
  if (eng.reduced) {
    eng.cam = { tx, ty, k };
    eng.dirty = true;
    return;
  }
  eng.focusAnim = { from: { ...eng.cam }, to: { tx, ty, k }, start: performance.now() };
}

function stepFocus(eng, now) {
  const a = eng.focusAnim;
  const t = Math.min((now - a.start) / FOCUS_MS, 1);
  const e = 1 - Math.pow(1 - t, 3);
  eng.cam.tx = a.from.tx + (a.to.tx - a.from.tx) * e;
  eng.cam.ty = a.from.ty + (a.to.ty - a.from.ty) * e;
  eng.cam.k = a.from.k + (a.to.k - a.from.k) * e;
  eng.dirty = true;
  if (t >= 1) eng.focusAnim = null;
}

function focusGalaxy(eng, gal) {
  // F5 mergulho: zoom o bastante p/ as notas REVELAREM (k >= ~1.1, acima do
  // NOTE_SHOW_K do draw) e SEGUE a galaxia enquanto ela revolve.
  const fitK = Math.min(eng.w, eng.h) / (gal.radius * 2.4);
  const k = clamp(Math.max(1.1, fitK), MIN_ZOOM, 2.6);
  const t = camTargetFor(eng, eng.w / 2, eng.h / 2, gal.cx, gal.cy, k);
  animCamTo(eng, t.tx, t.ty, k);
  eng.followGalaxy = gal;
}

// ------------------------------------------------- API imperativa (F4)
// Helpers consumidos pelo objeto api que o Graph.jsx entrega no onReady.
// Os ids aceitam path do vault com \ ou /, e caem para match
// case-insensitive (vaultPath do server pode divergir em caixa).
// Ids 'mcp:*' (F5.8) resolvem pelo stationById ANTES do nodeById; estacao
// ausente devolve null (o run 'ping' simplesmente nao nasce). Ids
// 'skill:*' (F7) resolvem pelo bookById com fallback por label
// normalizado (trim+lowercase, p/ runs 'skill' do fleet cujo target e o
// nome da skill); livro fora do top 12 devolve null (degrade silencioso).

function resolveBook(eng, key) {
  const books = eng.universe.bookById;
  if (books && books.has(key)) return books.get(key);
  const list = eng.universe.books;
  if (!Array.isArray(list) || !list.length) return null;
  const want = key.slice('skill:'.length).trim().toLowerCase();
  if (!want) return null;
  for (const b of list) {
    if (String(b.label).trim().toLowerCase() === want) return b;
    if (b.id.slice('skill:'.length).trim().toLowerCase() === want) return b;
  }
  return null;
}

function resolveNode(eng, id) {
  const key = String(id || '');
  if (key.startsWith('mcp:')) {
    const stations = eng.universe.stationById;
    return (stations && stations.get(key)) || null;
  }
  if (key.startsWith('skill:')) return resolveBook(eng, key);
  const map = eng.universe.nodeById;
  if (map.has(key)) return map.get(key);
  const norm = key.replace(/\\/g, '/');
  if (map.has(norm)) return map.get(norm);
  if (!eng.lowerIds) {
    eng.lowerIds = new Map();
    for (const n of eng.universe.nodes) eng.lowerIds.set(n.id.toLowerCase(), n);
  }
  return eng.lowerIds.get(norm.toLowerCase()) || null;
}

export function hasEngineNode(eng, id) {
  return Boolean(resolveNode(eng, id));
}

function insideViewport(eng, x, y) {
  return x >= -24 && y >= -24 && x <= eng.w + 24 && y <= eng.h + 24;
}

// worldToScreen(nodeId): posicao atual do no em px do container.
export function nodeScreenPoint(eng, id) {
  const node = resolveNode(eng, id);
  if (!node || !eng.w) return null;
  const [x, y] = worldToScreen(eng, node.px, node.py);
  return { x, y, onScreen: insideViewport(eng, x, y) };
}

// highlight(nodeId): flare (halo expandindo + anel) por ttlMs, desenhado
// dentro do rAF existente (graph-draw.drawFlares). Cap de 12 flares.
export function addFlare(eng, id, opts = {}) {
  const node = resolveNode(eng, id);
  if (!node) return false;
  const flare = {
    node,
    color: (opts && opts.color) || node.color,
    start: performance.now(),
    ttl: Math.max(300, Number(opts && opts.ttlMs) || 2200),
  };
  eng.flares = [...eng.flares.slice(-11), flare];
  eng.dirty = true;
  return true;
}

export function engineViewport(eng) {
  return { x: eng.cam.tx, y: eng.cam.ty, scale: eng.cam.k };
}

// focus(nodeId, {zoom}) e botao "localizar nota": centra a camera na
// estrela (anima 650ms) e acende um farol nela.
export function focusNote(eng, id, opts = {}) {
  const node = resolveNode(eng, id);
  if (!node || !eng.w) return false;
  const wanted = Number(opts && opts.zoom) || Math.max(eng.cam.k, 1.5);
  const k = clamp(wanted, MIN_ZOOM, MAX_ZOOM);
  const t = camTargetFor(eng, eng.w / 2, eng.h / 2, node.px, node.py, k);
  animCamTo(eng, t.tx, t.ty, k);
  eng.flashNode = node;
  eng.flashUntil = eng.time + 3;
  eng.dirty = true;
  return true;
}

// ------------------------------------------------------------- frota (F5)
// Sessions entram aqui (via Graph.jsx) e viram naves no fleet-model. O ctx
// injeta resolveNode/colorOf/onFlare para o model nao conhecer o engine.
// Guards: sessions nao-array (payload em carga/erro) nao sincroniza nada.

export function setEngineSessions(eng, sessions) {
  eng.sessions = sessions;
  if (!Array.isArray(sessions)) return;
  syncFleet(eng.fleet, sessions, {
    universe: eng.universe,
    resolveNode: (id) => resolveNode(eng, id),
    colorOf: eng.colorOf,
    now: performance.now(),
    reduced: eng.reduced,
    onFlare: (nodeId, color) => addFlare(eng, nodeId, { color, ttlMs: FLEET_FLARE_TTL_MS }),
  });
  // Com reduced-motion a frota nao anima: um step unico faz snap nos alvos.
  if (eng.reduced) stepFleet(eng.fleet, 0, performance.now(), true, eng.universe);
  eng.dirty = true;
}

// Q5 foco: marca os nós que agentes trabalham AGORA (vaultPath ativo). Monta
// o focusSet = ativos + vizinhos (adjacency) p/ o draw escurecer o resto e
// acender as arestas incidentes. Vazio => universo normal (guard: 0 ativos =
// aparência idêntica à de hoje). Barato: poucos nós ativos (≤ frota).
export function setEngineActiveNodes(eng, ids) {
  const set = ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : []);
  const active = new Set();
  for (const id of set) if (eng.universe.nodeById.has(id)) active.add(id);
  eng.activeNodes = active;
  if (active.size === 0) {
    eng.focusSet = null;
  } else {
    const fs = new Set(active);
    const adj = eng.universe.adjacency;
    for (const id of active) {
      for (const l of (adj.get(id) || [])) { fs.add(l.a.id); fs.add(l.b.id); }
    }
    eng.focusSet = fs;
  }
  eng.dirty = true;
}

// Igual nodeScreenPoint, mas para nave; inclui k para o overlay escalar.
export function shipScreenPoint(eng, id) {
  const ships = eng.fleet && eng.fleet.ships;
  const ship = ships ? ships.get(id) : null;
  if (!ship || !eng.w) return null;
  const [x, y] = worldToScreen(eng, ship.x, ship.y);
  return { x, y, k: eng.cam.k, onScreen: insideViewport(eng, x, y) };
}

// UMA chamada por frame do overlay DOM (fora do hot path do engine): pode
// alocar o array de saida. null = engine sem viewport (morto/sem medida).
export function listShipPoints(eng) {
  const ships = eng.fleet && eng.fleet.ships;
  if (!ships || !eng.w) return null;
  const out = [];
  for (const ship of ships.values()) {
    if (ship.gone) continue;
    const [x, y] = worldToScreen(eng, ship.x, ship.y);
    out.push({
      id: ship.id,
      x,
      y,
      k: eng.cam.k,
      onScreen: insideViewport(eng, x, y),
      state: ship.state,
      color: ship.color,
    });
  }
  return out;
}

export function setFollowShip(eng, id) {
  eng.followShipId = id || null;
  // Seguir nave assume a camera: cancela qualquer focusAnim em curso para
  // o follow nunca ficar bloqueado atras da animacao de foco (review fix).
  if (eng.followShipId) eng.focusAnim = null;
  eng.dirty = true;
}

// FB: nave em HOVER no overlay -> o fleet-draw abre os drones dela em leque
// rotulado. So marca o id e pede redraw; sem efeito de camera. Click abre o
// cartao (DOM, via selectedShip do TorreView), independente deste hover.
export function setHoverShip(eng, id) {
  eng.hoverShipId = id || null;
  eng.dirty = true;
}

// Efeitos de chegada (fase 'out' terminou): flare no node + ripples pelos
// links reais via spawnRipples do fleet-model (fonte unica do cap). now
// vem do frame(): nenhuma chamada extra de performance.now() aqui.
// arrivals e scratch array do fleet, lido in-place: zero alocacao.
function applyFleetFx(eng, now) {
  const arrivals = eng.fleet && eng.fleet.arrivals;
  if (!arrivals || !arrivals.length) return;
  for (const run of arrivals) {
    if (!run || !run.node) continue;
    addFlare(eng, run.node.id, { color: run.color, ttlMs: FLEET_FLARE_TTL_MS });
    spawnRipples(eng.fleet, run.node, eng.universe.adjacency, now);
  }
}

// Camera segue a nave (lerp 0.12 por frame); com reduced, snap. Solta SO
// em drag real ou wheel (onPointerMove/onWheel); click simples nao solta.
function stepFollowShip(eng) {
  if (!eng.followShipId) return;
  const ships = eng.fleet && eng.fleet.ships;
  const ship = ships ? ships.get(eng.followShipId) : null;
  if (!ship) return;
  const follow = camTargetFor(eng, eng.w / 2, eng.h / 2, ship.x, ship.y, eng.cam.k);
  const wtx = follow.tx;
  const wty = follow.ty;
  if (eng.reduced) {
    if (Math.abs(wtx - eng.cam.tx) < 0.5 && Math.abs(wty - eng.cam.ty) < 0.5) return;
    eng.cam.tx = wtx;
    eng.cam.ty = wty;
  } else {
    eng.cam.tx += (wtx - eng.cam.tx) * FOLLOW_LERP;
    eng.cam.ty += (wty - eng.cam.ty) * FOLLOW_LERP;
  }
  eng.dirty = true;
}

// F5: camera SEGUE a galaxia em foco enquanto ela revolve (so apos a animacao
// de mergulho terminar, p/ nao brigar com o stepFocus). Mantem o k (zoom do
// mergulho), so re-centra tx/ty. Solta em drag/wheel/Esc/fitView.
function stepFollowGalaxy(eng) {
  if (!eng.followGalaxy || eng.focusAnim) return;
  const gal = eng.followGalaxy;
  const follow = camTargetFor(eng, eng.w / 2, eng.h / 2, gal.cx, gal.cy, eng.cam.k);
  if (eng.reduced) {
    eng.cam.tx = follow.tx;
    eng.cam.ty = follow.ty;
  } else {
    eng.cam.tx += (follow.tx - eng.cam.tx) * FOLLOW_LERP;
    eng.cam.ty += (follow.ty - eng.cam.ty) * FOLLOW_LERP;
  }
  eng.dirty = true;
}

// Hit-test da nave: raio em mundo = max(14px, metade do tamanho em tela)/k.
// O tamanho em tela espelha o clamp do fleet-draw (sw = clamp(BASE/k, 8, 44)
// em mundo), sem importar o modulo de render.
function shipHitRadius(eng, ship) {
  const base = SHIP_BASE_PX[ship.variant] || SHIP_BASE_PX.mother;
  const k = eng.cam.k;
  const swWorld = clamp(base / k, 8, 44);
  return Math.max(SHIP_HIT_MIN_PX, (swWorld * k) / 2) / k;
}

// Naves tem prioridade sobre nodes no pick (maiores e interativas).
function pickShipAt(eng, wx, wy) {
  const ships = eng.fleet && eng.fleet.ships;
  if (!ships || !ships.size) return null;
  let best = null;
  let bestD = Infinity;
  for (const ship of ships.values()) {
    if (ship.gone) continue;
    const d = Math.hypot(ship.x - wx, ship.y - wy);
    if (d <= shipHitRadius(eng, ship) && d < bestD) {
      bestD = d;
      best = ship;
    }
  }
  return best ? { type: 'ship', ship: best } : null;
}

// 4 primeiros alfanum do id em caixa alta (duplicata trivial de
// roomData.flightCode: o engine nao importa modulos de UI).
function shipFlightCode(id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
  return (s.slice(0, 4) || '----').toUpperCase();
}

// Tooltip da nave: VOO + projeto / acao corrente / preview do prompt.
// Guards: payload v2 (sem currentAction) cai para lastTool/estado;
// engine sem tooltipEl (qualquer ref ausente) e no-op, nunca quebra.
function fillShipTooltip(eng, ship) {
  if (!eng.ttTitle || !eng.ttMeta || !eng.ttSub) return;
  const s = ship.session || null;
  const a = s && s.currentAction;
  const action = a && a.tool
    ? (a.target ? `${a.tool} > ${a.target}` : a.tool)
    : (s && s.lastTool) || null;
  eng.ttTitle.textContent = `AGENTE ${shipFlightCode(ship.id)} · ${ship.project || 'sessao'}`;
  eng.ttMeta.textContent = action || ship.state || 'ativo';
  eng.ttSub.textContent = s && s.promptPreview ? truncate(String(s.promptPreview), 60) : '';
}

// Tooltip da estacao MCP (F5.8): chamadas acumuladas + ultimo uso; sem
// dado ainda a estacao se anuncia como aguardando sinal.
function fillStationTooltip(eng, st) {
  if (!eng.ttTitle || !eng.ttMeta || !eng.ttSub) return;
  eng.ttTitle.textContent = st.label;
  eng.ttMeta.textContent = st.count > 0 ? `${st.count} chamadas` : 'sem chamadas ainda';
  eng.ttSub.textContent = st.lastUsedTs ? `última ${relTime(st.lastUsedTs)}` : 'aguardando sinal';
}

// Tooltip do livro da biblioteca (F7): usos acumulados + ultimo uso.
function fillBookTooltip(eng, book) {
  if (!eng.ttTitle || !eng.ttMeta || !eng.ttSub) return;
  eng.ttTitle.textContent = book.label;
  eng.ttMeta.textContent = `skill · ${book.usedCount || 0} usos`;
  eng.ttSub.textContent = book.lastUsedTs ? `última ${relTime(book.lastUsedTs)}` : 'nunca usada';
}

// Tooltip do nucleo da estacao (F7): convida ao mergulho.
function fillHubTooltip(eng) {
  if (!eng.ttTitle || !eng.ttMeta || !eng.ttSub) return;
  eng.ttTitle.textContent = 'FAROL';
  eng.ttMeta.textContent = 'estação central';
  eng.ttSub.textContent = 'click mergulha na estação';
}

// ---------------------------------------------------------------- interacao

// Pinca (touch, 2 dedos): zoom ancorado no ponto medio entre os dedos.
// Mesmo principio do onWheel — o ponto do mundo sob o gesto nao foge.
function beginPinch(eng) {
  const [a, b] = [...eng.pointers.values()];
  eng.pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), k: eng.cam.k };
  eng.downAt = null;
  eng.camStart = null;
  eng.dragging = false;
  eng.focusAnim = null;
  eng.followShipId = null;
  setHover(eng, null);
}

function applyPinch(eng) {
  const [a, b] = [...eng.pointers.values()];
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (!eng.pinch || eng.pinch.dist <= 0 || dist <= 0) return;
  const rect = eng.canvas.getBoundingClientRect();
  const mx = (a[0] + b[0]) / 2 - rect.left;
  const my = (a[1] + b[1]) / 2 - rect.top;
  const k = clamp(eng.pinch.k * (dist / eng.pinch.dist), MIN_ZOOM, MAX_ZOOM);
  const [wx, wy] = screenToWorld(eng, mx, my);
  const t = camTargetFor(eng, mx, my, wx, wy, k);
  eng.cam.k = k;
  eng.cam.tx = t.tx;
  eng.cam.ty = t.ty;
  eng.dirty = true;
}

function resetPointerState(eng) {
  eng.dragging = false;
  eng.downAt = null;
  eng.camStart = null;
  eng.canvas.classList.remove('dragging');
}

function onPointerCancel(eng, ev) {
  eng.pointers.delete(ev.pointerId);
  if (eng.pointers.size < 2) eng.pinch = null;
  if (eng.pointers.size === 0) eng.pinchedRecently = false;
  resetPointerState(eng);
}

function onPointerDown(eng, ev) {
  eng.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  try {
    eng.canvas.setPointerCapture(ev.pointerId);
  } catch {
    // pointer ja liberado (ou sintetico): capture e otimizacao, nao requisito
  }
  if (eng.pointers.size === 2) {
    beginPinch(eng);
    return;
  }
  if (eng.pointers.size > 2 || eng.pinch) return; // 3+ dedos: ignora
  eng.downAt = [ev.clientX, ev.clientY];
  eng.camStart = { ...eng.cam };
  eng.cam3Start = { ...eng.cam3 };
  // Shift+arraste = orbita (gira yaw/tilt do universo). Sem Shift = pan.
  eng.orbitMode = ev.shiftKey === true;
  eng.dragging = false;
  eng.focusAnim = null;
}

function onPointerMove(eng, ev) {
  if (eng.pointers.has(ev.pointerId)) {
    eng.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  }
  if (eng.pinch) {
    if (eng.pointers.size >= 2) applyPinch(eng);
    return;
  }
  const rect = eng.canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  if (eng.downAt && eng.camStart) {
    const dx = ev.clientX - eng.downAt[0];
    const dy = ev.clientY - eng.downAt[1];
    if (eng.dragging || Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      eng.dragging = true;
      // Drag real (slop excedido) solta o follow; click simples nao solta.
      eng.followShipId = null;
      eng.followGalaxy = null; // F5: arrastar sai do mergulho-follow
      if (eng.orbitMode) {
        // Orbita 2.5D: assume o controle do yaw/tilt (cam3.manual pausa o
        // balanco idle). tilt clamp p/ nunca achatar de vez nem virar do avesso.
        eng.cam3.manual = true;
        eng.cam3.yaw = eng.cam3Start.yaw + dx * 0.006;
        eng.cam3.tilt = clamp(eng.cam3Start.tilt - dy * 0.005, 0.05, 1.2);
      } else {
        eng.cam.tx = eng.camStart.tx + dx;
        eng.cam.ty = eng.camStart.ty + dy;
      }
      eng.canvas.classList.add('dragging');
      setHover(eng, null);
      setHoverShip(eng, null);
      eng.dirty = true;
      return;
    }
  }
  const hit = pickAt(eng, sx, sy);
  setHover(eng, hit);
  // FB: hover na NAVE no canvas tambem abre o leque de drones (igual ao chip)
  setHoverShip(eng, hit && hit.type === 'ship' ? hit.ship.id : null);
}

function onPointerUp(eng, ev) {
  eng.pointers.delete(ev.pointerId);
  // Fim (parcial) de pinca: nenhum click residual ate TODOS os dedos sairem.
  if (eng.pinch || eng.pinchedRecently) {
    if (eng.pointers.size < 2) eng.pinch = null;
    eng.pinchedRecently = eng.pointers.size > 0;
    resetPointerState(eng);
    return;
  }
  const wasDrag = eng.dragging;
  resetPointerState(eng);
  if (wasDrag) return;
  const rect = eng.canvas.getBoundingClientRect();
  const hit = pickAt(eng, ev.clientX - rect.left, ev.clientY - rect.top);
  if (!hit) return;
  if (hit.ship) {
    if (typeof eng.onShipSelect === 'function') eng.onShipSelect(hit.ship.id);
    return;
  }
  // Estacao MCP (F5.8) e livro (F7): hover informa; click e no-op.
  if (hit.station || hit.book) return;
  // Nucleo da estacao (F7): mergulho suave no hub.
  if (hit.hub) {
    focusHub(eng);
    return;
  }
  if (hit.node && typeof eng.onOpen === 'function') eng.onOpen(hit.node.id);
  else if (hit.galaxy) focusGalaxy(eng, hit.galaxy);
}

// Mergulho na estacao (F7): centra a camera em (0,0) com k alvo 2.2.
function focusHub(eng) {
  const k = clamp(HUB_FOCUS_K, MIN_ZOOM, MAX_ZOOM);
  animCamTo(eng, eng.w / 2, eng.h / 2, k);
}

function onWheel(eng, ev) {
  ev.preventDefault();
  const rect = eng.canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  const k = clamp(eng.cam.k * Math.exp(-ev.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
  const [wx, wy] = screenToWorld(eng, sx, sy);
  const t = camTargetFor(eng, sx, sy, wx, wy, k);
  eng.cam.k = k;
  eng.cam.tx = t.tx;
  eng.cam.ty = t.ty;
  eng.focusAnim = null;
  // Wheel tambem solta o follow (usuario retomou o controle da camera).
  eng.followShipId = null;
  eng.followGalaxy = null; // F5: wheel sai do mergulho-follow
  // Re-pick no cursor (review fix F7): a camera mudou sob o mouse e o
  // hover capturado antes do zoom ficava stale -- tooltip preso a
  // centenas de px do cursor. pointermove nao dispara durante o wheel.
  setHover(eng, pickAt(eng, sx, sy));
  eng.dirty = true;
}

// Estacoes MCP (F5.8): mesmo slack dos nodes; hover/tooltip apenas.
// Universo sem stations (local ou /api/mcp ausente) devolve null direto.
function pickStationAt(eng, wx, wy, slack) {
  const stations = eng.universe.stations;
  if (!stations || !stations.length) return null;
  let best = null;
  let bestD = slack;
  for (const st of stations) {
    const d = Math.hypot(st.px - wx, st.py - wy) - st.r;
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best ? { type: 'mcp', station: best } : null;
}

// Livros da biblioteca (F7): mesmo slack; hover/tooltip apenas.
function pickBookAt(eng, wx, wy, slack) {
  const books = eng.universe.books;
  if (!books || !books.length) return null;
  let best = null;
  let bestD = slack;
  for (const b of books) {
    const d = Math.hypot(b.px - wx, b.py - wy) - b.r;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best ? { type: 'skill', book: best } : null;
}

// Nucleo da estacao (F7): hit em raio 26px de tela do (0,0), so com beacon.
function pickHubAt(eng, wx, wy) {
  if (!eng.universe.beacon) return null;
  return Math.hypot(wx, wy) <= HUB_HIT_PX / eng.cam.k
    ? { type: 'hub', hub: eng.universe.beacon }
    : null;
}

function pickAt(eng, sx, sy) {
  const [wx, wy] = screenToWorld(eng, sx, sy);
  const shipHit = pickShipAt(eng, wx, wy);
  if (shipHit) return shipHit;
  const slack = PICK_RADIUS_PX / eng.cam.k;
  // 2.5D: notas renderizam com perspectiva, entao o hit-test das NOTAS roda
  // em SCREEN-space pela MESMA project() do render (near = maior/na frente).
  // Os demais alvos (estacao/livro/galaxia/hub) ficam no plano ortografico
  // e seguem em world-space com slack. Vence a nota mais perto em px de tela.
  let best = null;
  let bestD = Infinity;
  // F5: notas so entram no pick quando VISIVEIS (zoom-in >= NOTE_PICK_K). Afastado
  // o clique vai pra galaxia (mergulho), nao pra uma nota invisivel.
  if (eng.cam.k >= NOTE_PICK_K) {
    for (const n of eng.universe.nodes) {
      const p = project(eng, n.px, n.py, n.pz);
      const reach = PICK_RADIUS_PX + n.r * p.scale;
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = n;
      }
    }
  }
  if (best) return { type: best.kind, node: best };
  const stationHit = pickStationAt(eng, wx, wy, slack);
  if (stationHit) return stationHit;
  const bookHit = pickBookAt(eng, wx, wy, slack);
  if (bookHit) return bookHit;
  const hubHit = pickHubAt(eng, wx, wy);
  if (hubHit) return hubHit;
  if (eng.universe.mode !== 'global') return null;
  // F5: o planeta cresce no zoom-out (boost do drawSuns) -> alvo de clique MAIOR,
  // pra TODO o disco visivel mergulhar (nao so o nucleo do sol).
  const galBoost = 1 + (1 - (eng._noteLOD ?? 1)) * 1.5;
  for (const gal of eng.universe.galaxies) {
    if (Math.hypot(gal.cx - wx, gal.cy - wy) <= gal.sunR * galBoost * 1.2 + slack) {
      return { type: 'sun', galaxy: gal };
    }
    if (galaxyLabelHit(eng, gal, wx, wy)) return { type: 'sun', galaxy: gal };
  }
  return null;
}

// Label da galaxia clicavel: caixa em mundo logo abaixo do sol (onde o
// drawGalaxyLabel desenha nome + barra + contagem) — click ali tambem
// centra a camera via focusGalaxy. Altura/largura fixas em px de tela
// (dividir por k da o tamanho em mundo) para o alvo nao crescer com o zoom.
// Hit em screen-space (o label billboarda via project() em z=0 no draw, e a
// galaxia e coplanar em z=0): projeta o sol e o ponto clicado e compara em px
// de tela — robusto sob yaw/tilt (review fix: a caixa em world-space
// desincronizava do label com tilt alto).
function galaxyLabelHit(eng, gal, wx, wy) {
  const c = project(eng, gal.cx, gal.cy, 0);
  const p = project(eng, wx, wy, 0);
  const sun = gal.sunR * c.scale;
  const top = c.sy + sun + 4;
  const bottom = c.sy + sun + 34; // nome + barra + contagem
  const halfW = Math.max(sun, 60); // alvo generoso, min 60px de tela
  return p.sy >= top && p.sy <= bottom && Math.abs(p.sx - c.sx) <= halfW;
}

function setHover(eng, hit) {
  const prev = eng.hover;
  const sameTarget =
    (!hit && !prev) ||
    (hit && prev &&
      (hit.node || hit.galaxy || hit.ship || hit.station || hit.book || hit.hub) ===
        (prev.node || prev.galaxy || prev.ship || prev.station || prev.book || prev.hub));
  if (sameTarget) return;
  eng.hover = hit;
  eng.canvas.style.cursor = hit ? 'pointer' : 'grab';
  fillTooltip(eng, hit);
  eng.dirty = true;
}

function fillTooltip(eng, hit) {
  if (!hit || !eng.ttTitle || !eng.ttMeta || !eng.ttSub) return;
  if (hit.ship) {
    fillShipTooltip(eng, hit.ship);
    return;
  }
  if (hit.station) {
    fillStationTooltip(eng, hit.station);
    return;
  }
  if (hit.book) {
    fillBookTooltip(eng, hit.book);
    return;
  }
  if (hit.hub) {
    fillHubTooltip(eng);
    return;
  }
  if (hit.galaxy) {
    const gal = hit.galaxy;
    eng.ttTitle.textContent = gal.label;
    eng.ttMeta.textContent = `galáxia · ${gal.count} nota${gal.count === 1 ? '' : 's'}`;
    eng.ttSub.textContent = 'click centra a câmera';
    return;
  }
  const n = hit.node;
  const deg = (eng.universe.adjacency.get(n.id) || []).length;
  // F5.9-v2: nota de grupo denso anuncia o subgrupo no meta
  // ('resources / claude code · N links').
  const where = n.subgroup
    ? `${cleanGroup(n.group)} / ${String(n.subgroup).toLowerCase()}`
    : cleanGroup(n.group);
  eng.ttTitle.textContent = n.label;
  eng.ttMeta.textContent = `${where} · ${deg} ${deg === 1 ? 'link' : 'links'}`;
  eng.ttSub.textContent = n.mtimeMs ? `editada ${relTime(n.mtimeMs)}` : 'sem data de edição';
}

// Ponto-ancora do tooltip em mundo: nave, estacao, livro, hub, sol ou nota.
function hoverWorldPoint(h) {
  if (h.ship) return [h.ship.x, h.ship.y];
  if (h.station) return [h.station.px, h.station.py];
  if (h.book) return [h.book.px, h.book.py];
  if (h.hub) return [0, 0];
  if (h.galaxy) return [h.galaxy.cx, h.galaxy.cy];
  return [h.node.px, h.node.py];
}

// Tooltip DOM segue o no em orbita: so transform + opacity (regra web-morph).
function updateTooltip(eng) {
  const el = eng.tooltipEl;
  if (!el) return;
  const h = eng.hover;
  if (!h) {
    el.classList.remove('show');
    return;
  }
  const [wx, wy] = hoverWorldPoint(h);
  const [sx, sy] = worldToScreen(eng, wx, wy);
  if (sx < -40 || sy < -40 || sx > eng.w + 40 || sy > eng.h + 40) {
    el.classList.remove('show');
    return;
  }
  el.style.transform = `translate(${Math.round(sx + 16)}px, ${Math.round(sy + 14)}px)`;
  el.classList.add('show');
}

export function setEngineSearch(eng, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) {
    eng.search = { q: '', set: null };
  } else {
    const set = new Set();
    for (const n of eng.universe.nodes) {
      if (n.kind === 'center') continue;
      if (n.label.toLowerCase().includes(query) || n.id.toLowerCase().includes(query)) {
        set.add(n.id);
      }
    }
    eng.search = { q: query, set };
  }
  eng.dirty = true;
}

// ----------------------------------------------------------------- rAF loop

function frame(eng, now) {
  if (eng.destroyed || !eng.running) return;
  const dt = Math.min((now - eng.lastNow) / 1000, 0.1);
  eng.lastNow = now;
  if (!eng.reduced) {
    eng.time += dt;
    eng.dirty = true;
  }
  // 2.5D: balanco idle do yaw (universo vivo). Pausa em drag e quando o
  // usuario assume a orbita (cam3.manual). Com reduced o relogio congela,
  // entao o yaw fica estatico (sem movimento, so a inclinacao base).
  if (!eng.reduced && !eng.dragging && !eng.cam3.manual) {
    eng.cam3.yaw *= 0.9; // sem balanço idle: yaw volta suave pro frontal (fix do "wobble")
  }
  if (eng.focusAnim) stepFocus(eng, now);
  // Frota: fisica + fx so sem reduced (com reduced o snap roda no sync).
  // applyFleetFx recebe o now do frame: zero performance.now() extra.
  if (!eng.reduced) {
    stepFleet(eng.fleet, dt, now, false, eng.universe);
    applyFleetFx(eng, now);
  }
  // Follow roda independente do focusAnim (setFollowShip ja cancela a
  // animacao de foco; focusNote durante follow apenas disputa um frame).
  stepFollowShip(eng);
  if (eng.flares.length) {
    eng.flares = eng.flares.filter((f) => now - f.start < f.ttl);
    eng.dirty = true;
  }
  if (eng.dirty && eng.w > 0) {
    updatePositions(eng);
    stepFollowGalaxy(eng); // re-centra na galaxia em foco (apos ela revolver neste frame)
    drawFrame(eng);
    updateTooltip(eng);
    eng.dirty = false;
  }
  eng.raf = requestAnimationFrame((n) => frame(eng, n));
}

// Posicao = f(t): elipse rotacionada por no, zero fisica por frame.
// Com prefers-reduced-motion o relogio congela e as posicoes ficam estaticas.
function updatePositions(eng) {
  const t = eng.time;
  // Heliocêntrico: revolve os centros das galáxias ao redor da Torre (0,0) ANTES
  // das notas (que orbitam gal.cx/cy). omega uniforme => anel sempre equidistante.
  // Galáxia sem orbitR (modo local) fica parada.
  for (const gal of eng.universe.galaxies) {
    if (!gal.orbitR) continue;
    const ga = gal.baseAngle + gal.omega * t;
    gal.cx = gal.orbitR * Math.cos(ga);
    gal.cy = gal.orbitR * Math.sin(ga);
  }
  // F5b: a DOCA revolve com o anel (mesma omega das galaxias) -> fica travada no
  // vao angular. So no global; modo local nao tem dockBaseAngle (doca fica parada).
  const u = eng.universe;
  if (u.mode === 'global' && Number.isFinite(u.dockBaseAngle)) {
    u.dockAngle = u.dockBaseAngle + (u.dockOmega || 0) * t;
  }
  for (const n of eng.universe.nodes) {
    if (n.kind === 'center') {
      n.px = n.galaxy.cx;
      n.py = n.galaxy.cy;
      n.pz = n.galaxy.cz || 0;
      continue;
    }
    const th = n.phase + n.omega * t;
    const ex = Math.cos(th) * n.a;
    const ey = Math.sin(th) * n.b;
    n.px = n.galaxy.cx + ex * n.cosO - ey * n.sinO;
    n.py = n.galaxy.cy + ex * n.sinO + ey * n.cosO;
    // 2.5D: profundidade efetiva = plano da galaxia + offset por nota.
    n.pz = (n.galaxy.cz || 0) + (n.zoff || 0);
  }
  updateStations(eng);
  updateBooks(eng);
}

// Estacoes MCP (F5.8): orbita circular ao redor da estacao (0,0),
// mesma f(t) das notas. Universo sem stations (local/legado) e no-op.
function updateStations(eng) {
  const stations = eng.universe.stations;
  if (!stations || !stations.length) return;
  const t = eng.time;
  for (const st of stations) {
    const th = st.phase + st.omega * t;
    st.px = Math.cos(th) * st.a;
    st.py = Math.sin(th) * st.a;
  }
}

// Livros da biblioteca (F7): mesma f(t) circular das stations.
function updateBooks(eng) {
  const books = eng.universe.books;
  if (!books || !books.length) return;
  const t = eng.time;
  for (const b of books) {
    const th = b.phase + b.omega * t;
    b.px = Math.cos(th) * b.a;
    b.py = Math.sin(th) * b.a;
  }
}
