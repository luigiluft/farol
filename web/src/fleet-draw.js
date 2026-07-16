// FAROL - fleet-draw.js (W2/P2, F5->F7): render das camadas da frota.
// drawFleetUnder roda ANTES de drawSuns (trilhas-constelacao com alpha
// decaindo, rota inter-galaxia como arco dashed, ripples viajando pelos
// links reais); drawFleetOver roda DEPOIS (protoStars, runs com sonda na
// bezier + holo-livro v2 / ping de radio / runas de skill, particulas do
// pool, naves com bob/anel/spawn-fade/callsign, ritos F5.7 e drones).
// F7: drawStations MIGROU para graph-station.js (W-GRAPH) -- este arquivo
// nao desenha mais farol/satelites nem exporta drawStations. Cores de
// canvas saem do canvasTheme() (1 lookup por draw exportado, nunca por
// particula); naves maiores (BASE 26/18/9, espelhado em fleet-rites);
// run 'skill' = sonda ate o livro da biblioteca + runas violeta subindo;
// callsign(id) vira o nome no ceu, sob a nave a partir de k > 0.45.
// Performance: nenhum gradiente/canvas criado por frame; scratch reusado
// (DASH, PT); bezierPoint e o util compartilhado do model; reduced-motion
// desenha tudo estatico (sem bob, sem pulso; runs/ripples nem existem).
import {
  TAU, clamp, hash32, haloSprite, planetSprite, PLANET_LIGHT_BASE,
} from './graph-universe.js';
import {
  bezierPoint, trailPath, RUN_OUT_MS, RUN_SCAN_MS, RUN_BACK_MS, DOCK_FORM_FRAC,
} from './fleet-model.js';
import {
  shipSprite, shipSleepSprite, droneSprite, probeSprite, holoGlyphs,
  runeSprite, blitSprite, blitSpriteRegion, shipClassScale,
} from './fleet-sprites.js';
import {
  sleepRiteActive, sleepDim, drawSleepRite, drawZzz, drawAnchor, drawGoneRite,
} from './fleet-rites.js';
import { canvasTheme, getTheme, onThemeChange } from './theme.js';
import { callsign, droneCallsign } from './callsigns.js';

const BASE_MOTHER_PX = 26;
const BASE_CARGO_PX = 18;
const BASE_DRONE_PX = 9;
const BASE_PROBE_PX = 8;
const SIZE_MIN = 8;
const SIZE_MAX = 44;
const TRAIL_ALPHA_MAX = 0.5;
const TRAIL_ALPHA_MIN = 0.06;
const RIPPLE_DUR_FALLBACK_MS = 700;
const RIPPLE_HALO_FADE_MS = 400;
const BOOK_OPEN_MS = 180;
const PROTO_GROW_MS = 600;
const PROTO_LABEL = 'nova estrela';
const SHIP_SPAWN_MS = 300;
const SHIP_GONE_MS = 1200;
const PING_RING_ALPHA = 0.55;
const CALLSIGN_MIN_K = 0.45;
const BADGE_MIN_K = 0.3; // B: badge de contagem de subagentes some no zoom-out total
const SHIP_FLAME_HZ = 5; // alternancia dos 2 frames de flame por segundo
// A nave ATIVA pousada repousa logo ACIMA da estrela: lift em px de TELA
// (fracao do tamanho da nave, constante em qualquer zoom). Substitui o antigo
// HOVER_LIFT do model (34 em mundo => flutuava 100+px no zoom-in).
const SHIP_LAND_LIFT = 0.62;
// Drones idle: arco limpo (mesmos angulos do leque, raio menor) + sway suave
// compartilhado; nada de orbita a deriva que amontoa. Leque (hover) so abre o raio.
const DRONE_IDLE_ORBIT = 1.5; // raio do arco idle (x tamanho da nave)
const DRONE_FAN_ORBIT = 2.7; // raio do leque aberto (hover)
const DRONE_SWAY_HZ = 0.5; // balanco lento do arco inteiro (rad ~0.12)
const DRONE_SWAY_RAD = 0.12;
// F8 - fluxo de informacao: conduite vivo agente->alvo (persiste entre runs)
// e subgrafo ativo (links do node-alvo acendem na cor do projeto). Pacotes
// fluem na cor da nave; reduced => tether/links estaticos, sem pacotes.
const CONDUIT_PACKETS = 4;
const CONDUIT_FLOW_MS = 1000; // periodo do pacote percorrendo o conduite
const CONDUIT_ALPHA = 0.32; // tether base (respira +0.12 sem reduced)
const CONDUIT_DASH_PXMS = 0.045; // velocidade do dash em px de tela/ms
const ACTIVE_LINK_CAP = 8; // links iluminados por node-alvo
const ACTIVE_LINK_ALPHA = 0.36;
const ACTIVE_LINK_DASH_PXMS = 0.03;

// Violeta das runas de skill por tema (--violet dos tokens; canvasTheme
// nao carrega violet, entao o par fica local e troca com o tema).
const SKILL_VIOLET = { dark: '#b48cfa', light: '#7a58c9' };
// F8: rosa do "esperando voce" (--ready dos tokens CSS); par local por tema.
const READY = { dark: '#ff6ea8', light: '#c43b7e' };

// -------------------------------------------- SHIP-HERO (default desde 02/07)
// As naves sao o dado mais importante e sumiam no fit-zoom. Modo hero: sprite
// 1.5x, chip de callsign persistente nas naves ATIVAS/esperando e halo
// pulsante na ativa. Escolhido pelo dono vendo A/B; rollback = setar
// localStorage torre.shipHero='0' (escape hatch, remover apos uma semana de uso).
function readFlag(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null; // localStorage bloqueado (modo privacidade): cai no default
  }
}
const SHIP_HERO = readFlag('torre.shipHero') !== '0';
const SHIP_HERO_SCALE = 1.5;

// F-art (default LIGADO desde 02/07): (1) CLASSES de silhueta por modelo e
// (2) a nave APONTA pro destino + chama do motor SO em transito. Kill-switch
// unico: localStorage torre.fleetArt='off' desliga os DOIS (silhueta cruzador,
// sem rotacao, chama sempre) -> render identico ao comportamento anterior.
const FLEET_ART = readFlag('torre.fleetArt') !== 'off';

// Scratch reusado por frame: zero alocacao nos hot paths.
const DASH = [6, 8];
const NO_DASH = [];
const PT = { x: 0, y: 0 }; // adapta node (px/py) para bezierPoint ({x,y})

// Paleta do tema corrente: capturada UMA vez no topo de cada draw
// exportado (drawFleetUnder/drawFleetOver) e lida pelos helpers.
let T = null;
let violetHex = SKILL_VIOLET.dark;
let violetTag = '';
// Module-level singleton in prod; under Vite HMR each hot reload would
// stack a new listener, so the unsubscribe is released on dispose.
const offThemeViolet = onThemeChange(() => {
  violetTag = '';
});
if (import.meta.hot) import.meta.hot.dispose(offThemeViolet);

function skillViolet() {
  if (!violetTag) {
    violetTag = getTheme() || 'dark';
    violetHex = SKILL_VIOLET[violetTag] || SKILL_VIOLET.dark;
  }
  return violetHex;
}

// Rosa do beacon "esperando voce" (mesmo tag de tema cacheado do violet).
function readyHex() {
  if (!violetTag) skillViolet();
  return READY[violetTag] || READY.dark;
}

function fleetSize(base, k) {
  return clamp(base / k, SIZE_MIN, SIZE_MAX);
}

// SHIP-HERO: nave 1.5x com o clamp tambem escalado -- senao no fit-zoom o
// SIZE_MAX ja engoliria o ganho e a nave nao cresceria onde mais importa.
// Sem a flag devolve o fleetSize original (baseline intocado). F-art: a escala
// da CLASSE (capitania 1.25x ... scout 0.7x) entra aqui -> "quem e pesado" le
// pelo tamanho mesmo no fit-zoom; cls='cruzador' (OFF) => escala 1 = baseline.
function shipSize(isCargo, k, cls) {
  const base = (isCargo ? BASE_CARGO_PX : BASE_MOTHER_PX) * shipClassScale(cls);
  if (!SHIP_HERO) return fleetSize(base, k);
  return clamp((base * SHIP_HERO_SCALE) / k, SIZE_MIN, SIZE_MAX * SHIP_HERO_SCALE);
}

function finiteXY(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function hasShips(fleet) {
  return Boolean(fleet.ships && typeof fleet.ships.values === 'function' && fleet.ships.size > 0);
}

// Cor do run: skill = violeta do tema; demais = cor do projeto.
function runColor(run) {
  if (run.variant === 'skill') return skillViolet();
  return run.color || T.fallbackShip;
}

// Ponto na bezier do run reusando o util do model; PT adapta o node.
function runPoint(run, t) {
  PT.x = run.node.px;
  PT.y = run.node.py;
  return bezierPoint(run.ship, run.ctrl, PT, t);
}

// ------------------------------------------------------------ camada UNDER

// now: timestamp capturado UMA vez pelo drawFrame; opcional por compat.
export function drawFleetUnder(eng, now) {
  const fleet = eng.fleet;
  if (!fleet) return;
  T = canvasTheme();
  const ripples = Array.isArray(fleet.ripples) ? fleet.ripples : null;
  if (!hasShips(fleet) && (!ripples || !ripples.length)) return;
  const ts = Number.isFinite(now) ? now : performance.now();
  if (hasShips(fleet)) drawFleetBase(eng);
  if (hasShips(fleet)) drawTrails(eng, fleet);
  if (hasShips(fleet)) drawActiveLinks(eng, fleet, ts);
  if (!eng.reduced && ripples && ripples.length) drawRipples(eng, fleet, ts);
  eng.ctx.globalAlpha = 1;
}

// FB: a BASE da frota -- estacao-doca propria das naves ociosas, ancorada no
// MAIOR vao entre galaxias (universe.dockAngle/dockR) e ligada a Torre central
// (0,0) por um conduite tracejado. As naves ociosas estacionam em arco em
// volta dela (hangarSpot do model). Desenhada na camada UNDER, sob as naves.
function drawFleetBase(eng) {
  const u = eng.universe;
  if (!u) return;
  const ang = Number(u.dockAngle);
  const r = Number(u.dockR);
  const extent = Number(u.extent) || 600;
  if (!Number.isFinite(ang) || !Number.isFinite(r)) return;
  const { ctx, cam } = eng;
  const bx = Math.cos(ang) * r;
  const by = Math.sin(ang) * r;
  const col = T.fallbackShip;
  const formR = extent * DOCK_FORM_FRAC;
  // 1) conduite base -> Torre central (0,0): tracejado fino fluindo para dentro
  ctx.strokeStyle = col;
  ctx.lineWidth = 1 / cam.k;
  ctx.globalAlpha = 0.22;
  if (!eng.reduced) {
    DASH[0] = 5 / cam.k;
    DASH[1] = 9 / cam.k;
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = (eng.time * 24) / cam.k;
  } else {
    ctx.setLineDash(NO_DASH);
  }
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  // 2) anel-doca em volta da formacao das naves
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.arc(bx, by, formR * 1.3, 0, TAU);
  ctx.stroke();
  // 3) hub: halo suave (mundo) + ESTRELA-DOCA iluminada (F5b: billboard lit,
  // 1a classe como as galaxias-planeta; revolve junto pois bx/by saem da doca viva).
  const hs = formR * 0.7;
  ctx.globalAlpha = 0.3;
  ctx.drawImage(haloSprite(DOCK_PLANET), bx - hs, by - hs, hs * 2, hs * 2);
  ctx.globalAlpha = 1;
  drawDockPlanet(eng, bx, by, formR);
  // 4) label 'DOCA' sob o anel
  if (cam.k > 0.22) drawBaseLabel(eng, bx, by + formR * 1.3 + 5 / cam.k);
  ctx.globalAlpha = 1;
}

// F5b: estrela-doca aco-azul, esfera ILUMINADA (mesma planetSprite das galaxias
// no modo planeta) billboardada como circulo reto, com a luz apontando a Torre.
// Compacta (formR*0.6): as naves ociosas docam em arco ao redor (raio formR) e o
// anel (formR*1.3) envolve as duas. dockScreen() posiciona pela MESMA matriz
// AFIM (sem perspectiva) que a frota usa -> coincide com o anel/naves/label; o
// project() do graph-draw (com perspectiva) desalinharia (puxa pro centro).
const DOCK_PLANET = '#9fb3c8';
function dockScreen(eng, wx, wy) {
  const { k, tx, ty } = eng.cam;
  const { yaw, tilt } = eng.cam3;
  return {
    sx: k * Math.cos(yaw) * wx + tx,
    sy: -k * Math.sin(yaw) * Math.sin(tilt) * wx + k * Math.cos(tilt) * wy + ty,
  };
}
function drawDockPlanet(eng, bx, by, formR) {
  const { ctx, dpr, cam } = eng;
  const p = dockScreen(eng, bx, by);
  const center = dockScreen(eng, 0, 0); // luz aponta pra Torre central
  const rad = formR * 0.6 * cam.k;
  const rot = Math.atan2(center.sy - p.sy, center.sx - p.sx) - PLANET_LIGHT_BASE;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(p.sx, p.sy);
  ctx.rotate(rot);
  ctx.globalAlpha = 1;
  ctx.drawImage(planetSprite(DOCK_PLANET), -rad, -rad, rad * 2, rad * 2);
  ctx.restore();
}

function drawBaseLabel(eng, x, y) {
  const { ctx, cam } = eng;
  ctx.font = `${9 / cam.k}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 3 / cam.k;
  ctx.strokeStyle = T.labelStroke;
  ctx.strokeText('DOCA', x, y);
  ctx.fillStyle = T.labelDim || T.fallbackShip;
  ctx.fillText('DOCA', x, y);
}

// No-alvo atual do agente: run em voo (file/ping/skill) tem prioridade —
// cobre MCP e skill ao vivo; senao o ultimo node do trail (arquivo atual).
// Null quando a nave esta no hangar sem nada tocado (sem conduite pendurado).
function shipTargetNode(fleet, ship) {
  const runs = fleet.runs;
  if (Array.isArray(runs)) {
    for (const run of runs) {
      if (run && run.ship === ship && run.node && finiteXY(run.node.px, run.node.py)) {
        return run.node;
      }
    }
  }
  const trail = trailPath(fleet, ship.id);
  const last = trail && trail.length ? trail[trail.length - 1].node : null;
  return last && finiteXY(last.px, last.py) ? last : null;
}

// Subgrafo ativo: os links do node-alvo de cada nave ATIVA acendem na cor
// do projeto com dash fluindo pra fora — a informacao irradiando do arquivo
// tocado pela rede. Cap por node; reduced => brilho estatico (sem fluxo).
function drawActiveLinks(eng, fleet, now) {
  const adj = eng.universe.adjacency;
  if (!adj || typeof adj.get !== 'function') return;
  for (const ship of fleet.ships.values()) {
    if (!ship || ship.gone || ship.state !== 'ativa') continue;
    const node = shipTargetNode(fleet, ship);
    if (!node) continue;
    const links = adj.get(node.id);
    if (links && links.length) strokeActiveLinks(eng, ship, node, links, now);
  }
  eng.ctx.setLineDash(NO_DASH);
  eng.ctx.lineDashOffset = 0;
}

function strokeActiveLinks(eng, ship, node, links, now) {
  const { ctx, cam } = eng;
  ctx.strokeStyle = ship.color || T.fallbackShip;
  ctx.lineWidth = 1.4 / cam.k;
  ctx.globalAlpha = ACTIVE_LINK_ALPHA;
  if (!eng.reduced) {
    DASH[0] = 4 / cam.k;
    DASH[1] = 6 / cam.k;
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = -(now * ACTIVE_LINK_DASH_PXMS) / cam.k;
  } else {
    ctx.setLineDash(NO_DASH);
  }
  const max = Math.min(links.length, ACTIVE_LINK_CAP);
  for (let i = 0; i < max; i += 1) {
    const l = links[i];
    const other = l.a === node ? l.b : l.a;
    if (!other || !finiteXY(other.px, other.py)) continue;
    ctx.beginPath();
    ctx.moveTo(node.px, node.py);
    ctx.lineTo(other.px, other.py);
    ctx.stroke();
  }
}

function drawTrails(eng, fleet) {
  for (const ship of fleet.ships.values()) {
    if (!ship || !ship.id) continue;
    const pts = trailPath(fleet, ship.id);
    if (!pts || pts.length < 2) continue;
    drawShipTrail(eng, ship, pts);
  }
}

// Trilha-constelacao: polyline dos nodes visitados, segmento mais novo
// alpha 0.5 decaindo ate 0.06; entre galaxias vira arco quadratico dashed.
function drawShipTrail(eng, ship, pts) {
  const { ctx, cam } = eng;
  const segs = pts.length - 1;
  ctx.lineWidth = 1.2 / cam.k;
  ctx.strokeStyle = ship.color || T.fallbackShip;
  for (let i = 0; i < segs; i += 1) {
    const a = pts[i] && pts[i].node;
    const b = pts[i + 1] && pts[i + 1].node;
    if (!a || !b || !finiteXY(a.px, a.py) || !finiteXY(b.px, b.py)) continue;
    ctx.globalAlpha = TRAIL_ALPHA_MIN + (TRAIL_ALPHA_MAX - TRAIL_ALPHA_MIN) * ((i + 1) / segs);
    if (a.galaxy !== b.galaxy) {
      strokeTrailArc(ctx, cam.k, a, b, i);
    } else {
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.stroke();
    }
  }
}

// Rota inter-projeto viva: ctrl afastado na perpendicular do midpoint
// (lado alterna por indice), dash zoom-compensado via scratch DASH.
function strokeTrailArc(ctx, k, a, b, i) {
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const dist = Math.hypot(dx, dy) || 1;
  const off = clamp(dist * 0.18, 24, 120) * (i % 2 === 0 ? 1 : -1);
  DASH[0] = 6 / k;
  DASH[1] = 8 / k;
  ctx.setLineDash(DASH);
  ctx.beginPath();
  ctx.moveTo(a.px, a.py);
  ctx.quadraticCurveTo(
    (a.px + b.px) / 2 + (-dy / dist) * off,
    (a.py + b.py) / 2 + (dx / dist) * off,
    b.px,
    b.py,
  );
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

function drawRipples(eng, fleet, now) {
  for (const rp of fleet.ripples) {
    if (!rp || !rp.a || !rp.b) continue;
    if (!finiteXY(rp.a.px, rp.a.py) || !finiteXY(rp.b.px, rp.b.py)) continue;
    const dur = Number(rp.dur) || RIPPLE_DUR_FALLBACK_MS;
    const t = (now - rp.start) / dur;
    if (t >= 1) drawRippleArrival(eng, rp, now, dur);
    else if (t >= 0) drawRippleDot(eng, rp, t);
  }
}

// Dot brilhante viajando pelo link real (cor do node tocado) + rastro curto.
function drawRippleDot(eng, rp, t) {
  const { ctx, cam } = eng;
  const color = rp.a.color || T.fallbackShip;
  const r = clamp(2 / cam.k, 0.8, 3);
  ctx.fillStyle = color;
  for (let j = 2; j >= 1; j -= 1) {
    const tt = Math.max(0, t - j * 0.08);
    const tx = rp.a.px + (rp.b.px - rp.a.px) * tt;
    const ty = rp.a.py + (rp.b.py - rp.a.py) * tt;
    ctx.globalAlpha = 0.32 - j * 0.1;
    ctx.fillRect(tx - r * 0.4, ty - r * 0.4, r * 0.8, r * 0.8);
  }
  const x = rp.a.px + (rp.b.px - rp.a.px) * t;
  const y = rp.a.py + (rp.b.py - rp.a.py) * t;
  const hs = r * 3.2;
  ctx.globalAlpha = 0.5;
  ctx.drawImage(haloSprite(color), x - hs, y - hs, hs * 2, hs * 2);
  ctx.globalAlpha = 0.95;
  ctx.fillRect(x - r / 2, y - r / 2, r, r);
}

// Chegada do ripple: mini-halo no vizinho, alpha 0.35 com fade de 400ms.
function drawRippleArrival(eng, rp, now, dur) {
  const fade = 1 - clamp((now - rp.start - dur) / RIPPLE_HALO_FADE_MS, 0, 1);
  if (fade <= 0) return;
  const { ctx, cam } = eng;
  const hs = Math.max((rp.b.r || 2) * 2.4, 6 / cam.k);
  ctx.globalAlpha = 0.35 * fade;
  ctx.drawImage(haloSprite(rp.a.color || T.fallbackShip), rp.b.px - hs, rp.b.py - hs, hs * 2, hs * 2);
}

// ------------------------------------------------------------- camada OVER

// now: timestamp capturado UMA vez pelo drawFrame; opcional por compat.
export function drawFleetOver(eng, now) {
  const fleet = eng.fleet;
  if (!fleet) return;
  T = canvasTheme();
  const protos = Array.isArray(fleet.protoStars) ? fleet.protoStars : null;
  const runs = Array.isArray(fleet.runs) ? fleet.runs : null;
  if (!hasShips(fleet) && (!protos || !protos.length)) return;
  const ts = Number.isFinite(now) ? now : performance.now();
  if (protos && protos.length) drawProtoStars(eng, fleet, ts);
  if (hasShips(fleet)) drawConduits(eng, fleet, ts);
  if (!eng.reduced && runs && runs.length) drawRuns(eng, fleet, ts);
  if (!eng.reduced) drawParticles(eng, fleet);
  if (hasShips(fleet)) drawShips(eng, fleet, ts);
  eng.ctx.globalAlpha = 1;
}

// ------------------------------------------------------------- conduites
// Tether vivo agente -> alvo atual (arquivo/MCP/skill): persiste ENTRE os
// runs (preenche o gap onde a sonda nao esta voando), deixando sempre
// visivel "quem esta plugado em que". So naves ATIVAS com alvo resolvido.
function drawConduits(eng, fleet, now) {
  for (const ship of fleet.ships.values()) {
    if (!ship || ship.gone || ship.state !== 'ativa' || !finiteXY(ship.x, ship.y)) continue;
    const target = shipTargetNode(fleet, ship);
    if (target) drawConduit(eng, ship, target, now);
  }
  eng.ctx.setLineDash(NO_DASH);
  eng.ctx.lineDashOffset = 0;
}

function drawConduit(eng, ship, node, now) {
  const { ctx, cam } = eng;
  const color = ship.color || T.fallbackShip;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3 / cam.k;
  if (eng.reduced) {
    ctx.globalAlpha = CONDUIT_ALPHA;
    ctx.setLineDash(NO_DASH);
  } else {
    DASH[0] = 5 / cam.k;
    DASH[1] = 7 / cam.k;
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = -(now * CONDUIT_DASH_PXMS) / cam.k;
    ctx.globalAlpha = CONDUIT_ALPHA + 0.12 * (0.5 + 0.5 * Math.sin(eng.time * 4 + (ship.bobPhase || 0)));
  }
  ctx.beginPath();
  ctx.moveTo(ship.x, ship.y);
  ctx.lineTo(node.px, node.py);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  if (!eng.reduced) drawConduitPackets(eng, ship.x, ship.y, node.px, node.py, color, now);
  drawConduitPulse(eng, node, color);
}

// Pacotes de luz percorrendo o tether nave->node (cor da nave), espacados
// por offset; halo cacheado + nucleo solido, zero gradiente por frame.
function drawConduitPackets(eng, ax, ay, bx, by, color, now) {
  const { ctx, cam } = eng;
  const r = clamp(2.4 / cam.k, 1, 3.4);
  const hs = r * 3.4;
  ctx.fillStyle = color;
  for (let i = 0; i < CONDUIT_PACKETS; i += 1) {
    const t = ((now / CONDUIT_FLOW_MS + i / CONDUIT_PACKETS) % 1 + 1) % 1;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(haloSprite(color), x - hs, y - hs, hs * 2, hs * 2);
    ctx.globalAlpha = 1;
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

// Pulso suave na ponta-arquivo: o node-alvo respira na cor da nave (com
// reduced fica num brilho fixo). Halo cacheado esticado, sem alocacao.
function drawConduitPulse(eng, node, color) {
  const { ctx, cam } = eng;
  const base = Math.max(Number(node.r) || 2, 2);
  const pulse = eng.reduced ? 0.6 : 0.5 + 0.4 * Math.sin(eng.time * 3 + base);
  const hs = Math.max(base * 3, 6 / cam.k);
  ctx.globalAlpha = 0.5 * pulse;
  ctx.drawImage(haloSprite(color), node.px - hs, node.py - hs, hs * 2, hs * 2);
}

// ---------------------------------------------------------------- protoStar

function drawProtoStars(eng, fleet, now) {
  for (const ps of fleet.protoStars) {
    if (!ps || !finiteXY(ps.x, ps.y)) continue;
    const gt = eng.reduced ? 1 : clamp((now - ps.start) / PROTO_GROW_MS, 0, 1);
    if (gt < 1) drawProtoBirth(eng, ps, gt);
    else drawProtoCore(eng, ps);
  }
}

// Nascimento: 8 particulas radiais convergindo + cruz de luz crescendo 0->1.
function drawProtoBirth(eng, ps, gt) {
  const { ctx, cam } = eng;
  const k = cam.k;
  const color = ps.color || T.fallbackShip;
  const reach = (12 / k) * (1 - gt) + 2 / k;
  const pr = 1 / k;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35 + gt * 0.5;
  for (let i = 0; i < 8; i += 1) {
    const ang = (i / 8) * TAU;
    ctx.fillRect(ps.x + Math.cos(ang) * reach - pr / 2, ps.y + Math.sin(ang) * reach - pr / 2, pr, pr);
  }
  const arm = (8 / k) * gt;
  const w = 1 / k;
  ctx.globalAlpha = 0.8 * gt;
  ctx.fillRect(ps.x - arm, ps.y - w / 2, arm * 2, w);
  ctx.fillRect(ps.x - w / 2, ps.y - arm, w, arm * 2);
}

// Pos-nascimento: estrela 2px pulsando na cor + halo cacheado + label.
function drawProtoCore(eng, ps) {
  const { ctx, cam } = eng;
  const color = ps.color || T.fallbackShip;
  const pulse = eng.reduced ? 0.8 : 0.65 + 0.3 * Math.sin(eng.time * 3 + (ps.start % 7));
  const s = 2 / cam.k;
  const hs = s * 3.5;
  ctx.globalAlpha = 0.3 * pulse;
  ctx.drawImage(haloSprite(color), ps.x - hs, ps.y - hs, hs * 2, hs * 2);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = color;
  ctx.fillRect(ps.x - s / 2, ps.y - s / 2, s, s);
  drawProtoLabel(eng, ps);
}

function drawProtoLabel(eng, ps) {
  const { ctx, cam } = eng;
  ctx.font = `${9 / cam.k}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3 / cam.k;
  ctx.strokeStyle = T.labelStroke;
  const y = ps.y + 5 / cam.k;
  ctx.strokeText(PROTO_LABEL, ps.x, y);
  ctx.fillStyle = T.protoLabel;
  ctx.fillText(PROTO_LABEL, ps.x, y);
}

// --------------------------------------------------------------------- runs

// Fases derivadas SO de (now - run.start): out -> scan -> back. Variant
// 'ping' (alvo = station MCP) troca o holo-livro por radio; variant
// 'skill' (F7, alvo = livro da biblioteca) troca por runas subindo.
function drawRuns(eng, fleet, now) {
  for (const run of fleet.runs) {
    if (!run || !run.ship || !run.node || !run.ctrl) continue;
    if (!finiteXY(run.ship.x, run.ship.y) || !finiteXY(run.node.px, run.node.py)) continue;
    const elapsed = now - run.start;
    if (elapsed < 0) continue;
    if (elapsed < RUN_OUT_MS) {
      drawRunOut(eng, run, elapsed / RUN_OUT_MS);
    } else if (elapsed < RUN_OUT_MS + RUN_SCAN_MS) {
      const se = elapsed - RUN_OUT_MS;
      if (run.variant === 'ping') drawRunPing(eng, run, se);
      else if (run.variant === 'skill') drawRunSkill(eng, run, se);
      else drawRunScan(eng, fleet, run, se);
    } else if (elapsed < RUN_OUT_MS + RUN_SCAN_MS + RUN_BACK_MS) {
      drawRunBack(eng, run, (elapsed - RUN_OUT_MS - RUN_SCAN_MS) / RUN_BACK_MS);
    }
  }
}

// Fase out: sonda voa pela bezier nave->node com rastro de 3 dots.
function drawRunOut(eng, run, t) {
  const { ctx, cam } = eng;
  const sw = fleetSize(BASE_PROBE_PX, cam.k);
  const color = runColor(run);
  ctx.fillStyle = color;
  for (let j = 3; j >= 1; j -= 1) {
    const p = runPoint(run, Math.max(0, t - j * 0.07));
    if (!p) continue;
    const r = sw * (0.16 - j * 0.035);
    ctx.globalAlpha = 0.4 - j * 0.1;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  const p = runPoint(run, t);
  if (!p) return;
  ctx.globalAlpha = 0.95;
  blitSprite(ctx, probeSprite(color), p.x, p.y, sw, sw);
}

// Fase scan: holo-livro aberto sobre a estrela + scan line + sonda com beam.
function drawRunScan(eng, fleet, run, scanElapsed) {
  const k = eng.cam.k;
  const node = run.node;
  const pw = clamp(20 / k, 8, 30);
  const ph = pw * 1.25;
  const bx = node.px - pw / 2;
  const by = node.py - (node.r + ph * 0.75);
  const openT = clamp(scanElapsed / BOOK_OPEN_MS, 0, 1);
  const pulse = run.dir === 'write' ? bookPulse(fleet, run, bx, by, pw, ph) : 0;
  drawHoloBook(eng, run, bx, by, pw, ph, openT, pulse);
  if (openT >= 1) drawScanLine(eng, bx, by, pw, ph, scanElapsed);
  drawScanProbe(eng, run, bx, by, pw, ph);
}

// Fase back: livro fecha (scaleY->0 em 180ms) e a sonda volta pela
// bezier; runs 'ping'/'skill' nao tem livro, so a sonda voltando.
function drawRunBack(eng, run, tb) {
  const { ctx, cam } = eng;
  const node = run.node;
  const closeT = run.variant === 'file'
    ? 1 - clamp((tb * RUN_BACK_MS) / BOOK_OPEN_MS, 0, 1)
    : 0;
  if (closeT > 0) {
    const pw = clamp(20 / cam.k, 8, 30);
    const ph = pw * 1.25;
    drawHoloBook(eng, run, node.px - pw / 2, node.py - (node.r + ph * 0.75), pw, ph, closeT, 0);
  }
  const p = runPoint(run, 1 - tb);
  if (!p) return;
  const sw = fleetSize(BASE_PROBE_PX, cam.k);
  ctx.globalAlpha = clamp(1 - tb * 0.6, 0, 1);
  blitSprite(ctx, probeSprite(runColor(run)), p.x, p.y, sw, sw);
}

// Holo-livro v2 (F7): abre do topo (scaleY squish), fundo bookBg do tema,
// moldura com 4 cantos em L na cor + contorno fraco, glifos baked em 2
// cores por hash do node; pulse soma brilho quando write entrega.
function drawHoloBook(eng, run, bx, by, pw, ph, scaleY, pulse) {
  if (scaleY <= 0) return;
  const { ctx, cam } = eng;
  const color = run.color || T.fallbackShip;
  const hh = ph * scaleY;
  ctx.globalAlpha = 1;
  ctx.fillStyle = T.bookBg;
  ctx.fillRect(bx, by, pw, hh);
  ctx.lineWidth = 1 / cam.k;
  ctx.strokeStyle = color;
  ctx.globalAlpha = Math.min(1, 0.35 + pulse);
  ctx.strokeRect(bx, by, pw, hh);
  drawBookCorners(eng, bx, by, pw, hh, color, Math.min(1, 0.85 + pulse));
  const glyphs = holoGlyphs(color, hash32(String(run.node.id)));
  ctx.globalAlpha = Math.min(1, 0.75 + pulse);
  const prevSmooth = ctx.imageSmoothingEnabled; // restaura o anterior, nao forca true
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(glyphs, bx + pw * 0.08, by + ph * 0.06 * scaleY, pw * 0.84, ph * 0.88 * scaleY);
  ctx.imageSmoothingEnabled = prevSmooth;
}

// Moldura v2: 4 cantos em L na cor do run (tracos curtos, zero alloc).
function drawBookCorners(eng, bx, by, pw, hh, color, alpha) {
  const { ctx, cam } = eng;
  const arm = Math.min(pw, hh) * 0.24;
  ctx.lineWidth = 1.6 / cam.k;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  strokeCorner(ctx, bx, by, arm, arm);
  strokeCorner(ctx, bx + pw, by, -arm, arm);
  strokeCorner(ctx, bx, by + hh, arm, -arm);
  strokeCorner(ctx, bx + pw, by + hh, -arm, -arm);
}

function strokeCorner(ctx, x, y, dx, dy) {
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy);
  ctx.stroke();
}

// Pulso do write: +0.2 de brilho por particula dentro do livro (cap 0.3).
// Varre o pool fixo (<=240 slots), zero alocacao.
function bookPulse(fleet, run, bx, by, pw, ph) {
  const pool = fleet.particles;
  if (!pool || !pool.length) return 0;
  let near = 0;
  for (const p of pool) {
    if (!p || !p.active || p.run !== run) continue;
    if (p.x >= bx && p.x <= bx + pw && p.y >= by && p.y <= by + ph) near += 1;
  }
  return Math.min(near * 0.2, 0.3);
}

// Linha de scan v2 (F7): varre topo->base 2x na cor scanLine do tema, com
// RASTRO de 3 linhas finas esmaecendo atras da varredura; glow via
// haloSprite JA cacheado esticado em faixa (nunca gradiente novo).
function drawScanLine(eng, bx, by, pw, ph, scanElapsed) {
  const { ctx, cam } = eng;
  const sweep = ((scanElapsed / RUN_SCAN_MS) * 2) % 1;
  const ly = by + ph * sweep;
  const gh = ph * 0.22;
  ctx.globalAlpha = 0.45;
  ctx.drawImage(haloSprite(T.scanLine), bx - pw * 0.15, ly - gh / 2, pw * 1.3, gh);
  ctx.fillStyle = T.scanLine;
  for (let j = 1; j <= 3; j += 1) {
    const ty = ly - j * (ph * 0.05);
    if (ty < by) break;
    ctx.globalAlpha = 0.3 - j * 0.08;
    ctx.fillRect(bx, ty, pw, 0.8 / cam.k);
  }
  ctx.globalAlpha = 0.9;
  ctx.fillRect(bx, ly - 0.75 / cam.k, pw, 1.5 / cam.k);
}

// Sonda paira ao lado do livro (lado da nave) com beam fino ate a borda.
function drawScanProbe(eng, run, bx, by, pw, ph) {
  const { ctx, cam } = eng;
  const color = run.color || T.fallbackShip;
  const sw = fleetSize(BASE_PROBE_PX, cam.k);
  const onLeft = run.ship.x <= run.node.px;
  const sx = onLeft ? bx - pw * 0.45 : bx + pw + pw * 0.45;
  const sy = by + ph * 0.42 + (eng.reduced ? 0 : Math.sin(eng.time * 2.6) * (1.6 / cam.k));
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / cam.k;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(onLeft ? bx : bx + pw, sy);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  blitSprite(ctx, probeSprite(color), sx, sy, sw, sw);
}

// Fase scan do run 'ping': aneis de radio concentricos expandindo do
// satelite (2 ciclos na fase) + glifo do servico subindo + feixe
// tracejado sonda<->satelite; as particulas voltando pra nave ja saem do
// pool do model (drawParticles cobre).
function drawRunPing(eng, run, scanElapsed) {
  const { ctx, cam } = eng;
  const st = run.node;
  const color = run.color || T.fallbackShip;
  const base = Math.max(Number(st.r) || 2, 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 / cam.k;
  for (let j = 0; j < 2; j += 1) {
    const c = ((scanElapsed / RUN_SCAN_MS) * 2 + j * 0.5) % 1;
    ctx.globalAlpha = (1 - c) * PING_RING_ALPHA;
    ctx.beginPath();
    ctx.arc(st.px, st.py, base * (1.6 + c * 7), 0, TAU);
    ctx.stroke();
  }
  drawPingGlyph(eng, run, color, base, scanElapsed);
  const sw = fleetSize(BASE_PROBE_PX, cam.k);
  const onLeft = run.ship.x <= st.px;
  const sx = st.px + (onLeft ? -1 : 1) * (base * 4 + sw);
  const sy = st.py - sw * 0.35 + (eng.reduced ? 0 : Math.sin(eng.time * 2.6) * (1.6 / cam.k));
  DASH[0] = 3 / cam.k;
  DASH[1] = 4 / cam.k;
  ctx.setLineDash(DASH);
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(st.px, st.py);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = 0.95;
  blitSprite(ctx, probeSprite(color), sx, sy, sw, sw);
}

// Glifo do servico (1a letra do label) subindo e esmaecendo na fase ping.
function drawPingGlyph(eng, run, color, base, scanElapsed) {
  const st = run.node;
  const label = String(st.label || st.id || '').replace(/^mcp:/, '');
  const glyph = label.charAt(0).toUpperCase();
  if (!glyph) return;
  const { ctx, cam } = eng;
  const t = clamp(scanElapsed / RUN_SCAN_MS, 0, 1);
  ctx.font = `${8 / cam.k}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.85 * (1 - t);
  ctx.fillStyle = color;
  ctx.fillText(glyph, st.px, st.py - base * 2.4 - (t * 10) / cam.k);
}

// Fase scan do run 'skill' (F7): halo violeta pulsando no livro + 3 runas
// pixel subindo e girando (celulas do runeSprite, rotacao via ctx.rotate,
// zero alloc) + sonda pairando com beam. As particulas da volta (read:
// node -> nave) saem violeta via drawParticles/runColor.
function drawRunSkill(eng, run, scanElapsed) {
  const { ctx, cam } = eng;
  const node = run.node;
  const color = skillViolet();
  const img = runeSprite(color);
  const cw = img.width / 3;
  const t0 = scanElapsed / RUN_SCAN_MS;
  const base = Math.max(Number(node.r) || 2, 2);
  const hs = Math.max(base * 2.6, 7 / cam.k);
  ctx.globalAlpha = 0.3 + 0.18 * Math.sin(t0 * TAU * 2);
  ctx.drawImage(haloSprite(color), node.px - hs, node.py - hs, hs * 2, hs * 2);
  for (let i = 0; i < 3; i += 1) {
    const t = (t0 * 1.6 + i / 3) % 1;
    const s = clamp((6 + i * 2) / cam.k, 3, 15);
    const rx = node.px + ((i - 1) * 5 + Math.sin((t0 + i) * TAU) * 2) / cam.k;
    const ry = node.py - base - (4 + t * 24) / cam.k;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate((t0 * 2 + i * 0.37) * TAU);
    ctx.globalAlpha = 0.95 * Math.sin(t * Math.PI);
    blitSpriteRegion(ctx, img, i * cw, 0, cw, img.height, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  drawSkillProbe(eng, run, color, base);
}

// Sonda do run 'skill': paira ao lado do livro com beam violeta fino.
function drawSkillProbe(eng, run, color, base) {
  const { ctx, cam } = eng;
  const node = run.node;
  const sw = fleetSize(BASE_PROBE_PX, cam.k);
  const onLeft = run.ship.x <= node.px;
  const sx = node.px + (onLeft ? -1 : 1) * (base * 3 + sw);
  const sy = node.py + sw * 0.2 + (eng.reduced ? 0 : Math.sin(eng.time * 2.6) * (1.6 / cam.k));
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / cam.k;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(node.px, node.py);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  blitSprite(ctx, probeSprite(color), sx, sy, sw, sw);
}

// Particulas do pool fixo: posicao ja vem do stepFleet (model); so render.
function drawParticles(eng, fleet) {
  const pool = fleet.particles;
  if (!pool || !pool.length) return;
  const { ctx, cam } = eng;
  for (const p of pool) {
    if (!p || !p.active || !finiteXY(p.x, p.y)) continue;
    const run = p.run;
    const s = clamp((Number(p.size) || 1.6) / cam.k, 0.8, 2.6);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = run && run.variant === 'skill'
      ? skillViolet()
      : (run && run.color) || T.fallbackShip;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
}

// -------------------------------------------------------------------- naves

function drawShips(eng, fleet, now) {
  for (const ship of fleet.ships.values()) {
    if (!ship || !finiteXY(ship.x, ship.y)) continue;
    // rito de saida (F5.7): warp/dissolve por goneState; sem goneState
    // (model antigo) ou com reduced, cai no fade legado do shipAlpha
    if (ship.gone && !eng.reduced && drawGoneRite(eng, ship, now)) continue;
    const alpha = shipAlpha(eng, ship, now);
    if (alpha <= 0) continue;
    drawShip(eng, ship, now, alpha);
  }
}

// Fades puramente visuais: spawn 300ms, gone legado 1.2s, dormindo com
// rampa do power-down (sleepDim). Com reduced nada anima: nave nasce
// solida e some junto com o model.
function shipAlpha(eng, ship, now) {
  let a = 1;
  if (!eng.reduced && ship.spawnT) a = clamp((now - ship.spawnT) / SHIP_SPAWN_MS, 0, 1);
  if (ship.gone) a *= eng.reduced ? 0 : 1 - clamp((now - ship.gone) / SHIP_GONE_MS, 0, 1);
  if (ship.state === 'dormindo') a *= sleepDim(ship, now, eng.reduced);
  return a;
}

// Nave: anel de estado + sprite com bob senoidal (so visual, nao muda o
// model) + scale-in de spawn + callsign no ceu + drones orbitando.
// Dormindo: power-down (rito 1.6s), depois casco apagado + Zzz + ancora.
function drawShip(eng, ship, now, alpha) {
  const { ctx, cam } = eng;
  const isCargo = ship.variant === 'cargo';
  const variant = isCargo ? 'cargo' : 'mother';
  // F-art: classe (silhueta+tamanho) e moving (chama) so quando a flag esta ON;
  // OFF => cruzador/chama-sempre => sw e sprite identicos ao baseline.
  const cls = FLEET_ART ? (ship.shipClass || 'cruzador') : 'cruzador';
  const moving = FLEET_ART ? ship.moving === true : true;
  const sw = shipSize(isCargo, cam.k, cls);
  // POUSO: nave ATIVA em voo (nao docada) repousa logo acima da estrela e fica
  // PARADA (sem bob). As demais (doca/ociosa/dormindo) flutuam no espaco com bob.
  const landed = ship.state === 'ativa' && !ship.parked;
  const bob = eng.reduced || landed ? 0 : Math.sin(eng.time * 1.1 + (ship.bobPhase || 0)) * sw * 0.06;
  const y = ship.y - (landed ? sw * SHIP_LAND_LIFT : 0) + bob;
  const sleeping = ship.state === 'dormindo';
  // SHIP-HERO: halo pulsante na cor do projeto atras da nave ATIVA (destaca o
  // dado mais importante no fit-zoom). Antes do casco pra ficar por baixo.
  if (SHIP_HERO && ship.state === 'ativa' && !ship.gone) {
    drawHeroHalo(eng, ship.x, y, sw, ship.color, alpha);
  }
  if (sleeping && ship.parked) drawAnchor(eng, ship, ship.x, y, sw);
  if (sleeping && !eng.reduced && sleepRiteActive(ship, now)) {
    drawSleepRite(eng, ship, ship.x, y, sw, now, alpha);
  } else {
    // F-art: sem chama (parado) fixa frame 0 -- sprite sem jato, sem alternancia.
    const frame = (eng.reduced || !moving) ? 0 : Math.floor(eng.time * SHIP_FLAME_HZ) % 2;
    const sprite = sleeping
      ? shipSleepSprite(variant)
      : shipSprite(ship.color, variant, frame, cls, moving);
    let scale = 1;
    if (!eng.reduced && ship.spawnT) {
      const st = clamp((now - ship.spawnT) / SHIP_SPAWN_MS, 0, 1);
      scale = 0.4 + 0.6 * (1 - (1 - st) * (1 - st));
    }
    if (ship.awaiting && !sleeping) drawWaitBeacon(eng, ship, ship.x, y, sw, now, alpha);
    else drawShipRing(eng, ship, ship.x, y, sw, alpha);
    const w = sw * scale;
    const h = w * (sprite.height / sprite.width);
    ctx.globalAlpha = alpha;
    // F-art: SO o casco rotaciona pelo heading (anel/halo/badge/callsign/drones
    // ficam na orientacao do mundo). Dormindo NAO gira (Zzz/ancora sao horizontais
    // e o rito de power-down do fleet-rites blita sem rotacao).
    if (FLEET_ART && !sleeping) {
      ctx.save();
      ctx.translate(ship.x, y);
      ctx.rotate(ship.heading || 0);
      blitSprite(ctx, sprite, 0, 0, w, h);
      ctx.restore();
    } else {
      blitSprite(ctx, sprite, ship.x, y, w, h);
    }
    if (sleeping) drawZzz(eng, ship, ship.x, y, sw, alpha);
  }
  // Chip persistente SO em nave ativa/esperando-DE-VERDADE: sessao encerrada
  // ainda chega com awaiting=true no payload, entao o gate espelha o do
  // drawWaitBeacon (awaiting && !dormindo) — sem isso os pills das paradas
  // empilhavam na DOCA (refino pedido na decisao de 02/07). Parada so mostra
  // callsign no mergulho real (k>2.0).
  const heroChip = SHIP_HERO
    && (ship.state === 'ativa' || (ship.awaiting && !sleeping));
  const parkedShip = ship.state === 'ociosa' || ship.state === 'dormindo';
  const zoomChip = cam.k > (parkedShip ? 2.0 : CALLSIGN_MIN_K);
  if (heroChip || zoomChip) drawShipCallsign(eng, ship, ship.x, y, sw, alpha);
  if (ship.subCount > 0 && cam.k > BADGE_MIN_K) drawSubBadge(eng, ship, ship.x, y, sw, alpha);
  if (Array.isArray(ship.drones) && ship.drones.length) {
    drawDrones(eng, ship, ship.x, y, sw, now, alpha);
  }
}

// B: badge de contagem de subagentes no canto superior-direito da nave -- o
// TOTAL real (mesmo alem dos drones desenhados). Disco de contraste
// (labelStroke do tema) + anel e numero na cor do projeto.
function drawSubBadge(eng, ship, x, y, sw, alpha) {
  const { ctx, cam } = eng;
  const r = Math.max(sw * 0.22, 6.5 / cam.k);
  const bx = x + sw * 0.5;
  const by = y - sw * 0.5;
  const color = ship.color || T.fallbackShip;
  ctx.globalAlpha = 0.92 * alpha;
  ctx.fillStyle = T.labelStroke;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 1.2 / cam.k;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${r * 1.25}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(ship.subCount), bx, by + r * 0.06);
}

// SHIP-HERO: halo pulsante suave na cor do projeto atras da nave ATIVA (halo
// cacheado esticado, pulso so por alpha/escala -- zero gradiente por frame).
function drawHeroHalo(eng, x, y, sw, color, alpha) {
  const { ctx } = eng;
  const col = color || T.fallbackShip;
  const pulse = eng.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(eng.time * 2.4 + x);
  const hs = sw * (1.15 + 0.22 * pulse);
  ctx.globalAlpha = (0.2 + 0.16 * pulse) * alpha;
  ctx.drawImage(haloSprite(col), x - hs, y - hs, hs * 2, hs * 2);
}

// Callsign no ceu (F7): nome de estrela da sessao sob a nave a partir de
// k > 0.45 -- labelStrong com stroke do tema, 9px zoom-compensado. Com
// SHIP-HERO sai SEMPRE (10px) sobre um chip de contraste colado na nave.
function drawShipCallsign(eng, ship, x, y, sw, alpha) {
  const { ctx, cam } = eng;
  const name = callsign(ship.id);
  if (!name) return;
  const fpx = SHIP_HERO ? 10 : 9;
  ctx.font = `${fpx / cam.k}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const a = (ship.state === 'dormindo' ? 0.6 : 0.92) * alpha;
  const ly = y + sw * 0.62;
  if (SHIP_HERO) drawCallsignChip(eng, ship, x, ly, name, fpx, a);
  ctx.globalAlpha = a;
  ctx.lineWidth = 3 / cam.k;
  ctx.strokeStyle = T.labelStroke;
  ctx.strokeText(name, x, ly);
  ctx.fillStyle = T.labelStrong;
  ctx.fillText(name, x, ly);
}

// SHIP-HERO: fundo-chip do callsign (pill de contraste do tema + borda na cor
// do projeto) pra o nome "colar" na nave e sobreviver a qualquer fundo. Assume
// que o font ja foi setado (measureText usa a metrica corrente).
function drawCallsignChip(eng, ship, x, ly, name, fpx, alpha) {
  const { ctx, cam } = eng;
  const bw = ctx.measureText(name).width + (10 / cam.k);
  const bh = (fpx + 4) / cam.k;
  roundRectPath(ctx, x - bw / 2, ly - 2 / cam.k, bw, bh, 3 / cam.k);
  ctx.globalAlpha = 0.72 * alpha;
  ctx.fillStyle = T.labelStroke;
  ctx.fill();
  ctx.globalAlpha = 0.85 * alpha;
  ctx.lineWidth = 1 / cam.k;
  ctx.strokeStyle = ship.color || T.fallbackShip;
  ctx.stroke();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// F8: beacon "esperando voce" — anel rosa pulsante + ping expandindo (o
// alerta que substitui o anel de estado enquanto o turno esta encerrado).
// O halo cacheado da cor ready da o glow; ping e 1 arco, zero alloc.
function drawWaitBeacon(eng, ship, x, y, sw, now, alpha) {
  const { ctx, cam } = eng;
  const color = readyHex();
  const r = sw * 0.66;
  const hs = sw * 1.1;
  const pulse = eng.reduced ? 0.85 : 0.55 + 0.45 * Math.sin(eng.time * 3.4 + (ship.bobPhase || 0));
  ctx.globalAlpha = 0.28 * pulse * alpha;
  ctx.drawImage(haloSprite(color), x - hs, y - hs, hs * 2, hs * 2);
  ctx.globalAlpha = pulse * alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7 / cam.k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  if (!eng.reduced) {
    const c = (now % 1400) / 1400;
    ctx.globalAlpha = (1 - c) * 0.55 * alpha;
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + c * 1.7), 0, TAU);
    ctx.stroke();
  }
}

// Anel de estado: ativa = arco pulsante na cor (estatico com reduced),
// ociosa = anel ringIdle 0.25, dormindo = anel ringSleep 0.15.
function drawShipRing(eng, ship, x, y, sw, alpha) {
  const { ctx, cam } = eng;
  const r = sw * 0.66;
  ctx.lineWidth = 1.2 / cam.k;
  ctx.beginPath();
  if (ship.state === 'ativa') {
    ctx.strokeStyle = ship.color || T.fallbackShip;
    if (eng.reduced) {
      ctx.globalAlpha = 0.5 * alpha;
      ctx.arc(x, y, r, 0, TAU);
    } else {
      ctx.globalAlpha = (0.5 + 0.3 * Math.sin(eng.time * 2.2 + (ship.bobPhase || 0))) * alpha;
      const a0 = eng.time * 1.3 + (ship.bobPhase || 0);
      ctx.arc(x, y, r, a0, a0 + TAU * 0.72);
    }
  } else {
    const idle = ship.state === 'ociosa';
    ctx.globalAlpha = (idle ? 0.25 : 0.15) * alpha;
    ctx.strokeStyle = idle ? T.ringIdle : T.ringSleep;
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.stroke();
}

// UI: verbo curto e AMIGAVEL do tool do drone pro label do leque. O nome cru
// (ex.: "StructuredOutput") poluia repetido em volta do agente (img #8); aqui
// vira "lê/escreve/shell/busca..." e o generico/desconhecido nao mostra nada.
const DRONE_TOOL_VERB = {
  Read: 'lê', Edit: 'edita', Write: 'escreve', MultiEdit: 'edita',
  Bash: 'shell', PowerShell: 'shell', Grep: 'busca', Glob: 'busca',
  WebSearch: 'web', WebFetch: 'web', Task: 'spawna', Skill: 'skill',
};
function droneToolVerb(tool) {
  if (!tool) return '';
  const t = String(tool);
  if (DRONE_TOOL_VERB[t]) return DRONE_TOOL_VERB[t];
  if (t.startsWith('mcp__')) return 'mcp';
  return ''; // StructuredOutput e afins: so o callsign, sem ruido
}

// B: drones em ARCO LIMPO sobre a nave -- posicao deterministica e EVEN por
// indice (fanAngle), nunca a orbita a deriva que os amontoava num blob. Idle =
// arco apertado; HOVER so ABRE o raio e mostra tethers + labels (transicao
// suave). Sway lento compartilhado da vida ao arco; ativo ganha pulso claro.
function drawDrones(eng, ship, cx, cy, sw, now, baseAlpha) {
  const { ctx, cam } = eng;
  const dw = fleetSize(BASE_DRONE_PX, cam.k);
  const hovered = ship.id === eng.hoverShipId;
  const n = ship.drones.length;
  const orbit = sw * (hovered ? DRONE_FAN_ORBIT : DRONE_IDLE_ORBIT);
  const sway = eng.reduced ? 0 : Math.sin(eng.time * DRONE_SWAY_HZ + (ship.bobPhase || 0)) * DRONE_SWAY_RAD;
  for (let i = 0; i < n; i += 1) {
    const d = ship.drones[i];
    if (!d) continue;
    let a = baseAlpha;
    if (!eng.reduced && d.born) a *= clamp((now - d.born) / SHIP_SPAWN_MS, 0, 1);
    if (d.gone) a *= eng.reduced ? 0 : 1 - clamp((now - d.gone) / SHIP_SPAWN_MS, 0, 1);
    if (a <= 0) continue;
    const ang = fanAngle(i, n) + sway;
    const x = cx + Math.cos(ang) * orbit;
    const y = cy + Math.sin(ang) * orbit;
    if (hovered) drawDroneTether(eng, cx, cy, x, y, ship.color, a);
    if (d.active) drawActiveDronePulse(eng, x, y, dw, a);
    ctx.globalAlpha = a * 0.95;
    blitSprite(ctx, droneSprite(ship.color), x, y, dw, dw);
    if (hovered) {
      // leque: callsign + VERBO amigavel do tool (nao o nome cru repetido)
      const verb = droneToolVerb(d.tool);
      const label = verb ? `${droneCallsign(d.id)} ${verb}` : droneCallsign(d.id);
      drawDroneLabel(eng, x, y, dw, a, label);
    }
    // Idle = arco LIMPO: sem labels (varios subagentes ativos viravam um muro
    // de texto). O pulso ja marca quem trabalha; hover revela nomes + verbos.
  }
}

// Drone ATIVO (subagente trabalhando agora): halo pulsante na cor de scan +
// nucleo solido -- destaca QUAL drone esta ativo sem poluir os demais. Halo
// cacheado esticado (zero gradiente por frame); estatico com reduced.
function drawActiveDronePulse(eng, x, y, dw, alpha) {
  const { ctx } = eng;
  const pulse = eng.reduced ? 0.85 : 0.5 + 0.5 * Math.sin(eng.time * 3.4);
  const hs = dw * 1.15;
  ctx.globalAlpha = 0.5 * pulse * alpha;
  ctx.drawImage(haloSprite(T.scanLine), x - hs, y - hs, hs * 2, hs * 2);
  const pr = dw * 0.3;
  ctx.globalAlpha = pulse * alpha;
  ctx.fillStyle = T.scanLine;
  ctx.fillRect(x - pr / 2, y - pr / 2, pr, pr);
}

// Angulo do drone i no arco -- ~207deg centrado no topo da nave, EVEN por
// indice (idle e leque compartilham; o hover so muda o raio). n=1 => topo.
function fanAngle(i, n) {
  if (n <= 1) return -Math.PI / 2;
  const ARC = Math.PI * 1.15;
  return -Math.PI / 2 + ((i / (n - 1)) - 0.5) * ARC;
}

// FB: tether fino nave->drone no leque, para o drone "pertencer" a nave.
function drawDroneTether(eng, ax, ay, bx, by, color, alpha) {
  const { ctx, cam } = eng;
  ctx.globalAlpha = 0.3 * alpha;
  ctx.strokeStyle = color || T.fallbackShip;
  ctx.lineWidth = 1 / cam.k;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

// Nome (e tool, no leque) do drone sob ele, com stroke de contraste do tema.
function drawDroneLabel(eng, x, y, dw, alpha, text) {
  const { ctx, cam } = eng;
  if (!text) return;
  ctx.font = `${8 / cam.k}px ${T.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.92 * alpha;
  ctx.lineWidth = 2.5 / cam.k;
  ctx.strokeStyle = T.labelStroke;
  const ly = y + dw * 0.5;
  ctx.strokeText(text, x, ly);
  ctx.fillStyle = T.labelStrong;
  ctx.fillText(text, x, ly);
}
