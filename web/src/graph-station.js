// FAROL - graph-station.js (W-GRAPH, F7): a ESTACAO CEREBRAL central,
// os satelites MCP grandes e a BIBLIOTECA orbital de skills. Migrou de
// fleet-draw (drawStations) e fleet-sprites (towerSprite/satSprite) na F7:
// o farol virou nucleo-estacao girando, os satelites ganharam monograma e
// label collision-aware (k > 0.5), e um anel de livros (universe.books)
// orbita entre os satelites e as galaxias. Sprites baked 2x em cache com chave
// PREFIXADA pelo tema (getTheme()) - troca de tema nunca serve sprite do
// tema errado; cores estruturais vem de canvasTheme() (1 lookup por draw).
// Performance: nenhum gradiente/blur criado por frame; sinapses derivadas
// de now (deterministicas, zero estado); scratch ORBIT_RADII reusado;
// zero alocacao nos hot paths alem das strings de label (convencao do repo).
import {
  TAU, clamp, hash32, hexToRgba, mulberry32, haloSprite, truncate,
} from './graph-universe.js';
import { canvasTheme, getTheme } from './theme.js';

const BASE_CORE_PX = 42;
const BASE_SAT_PX = 22; // era 13 no fleet-draw: satelites grandes na F7
const BASE_BOOK_PX = 13;
const SIZE_MIN = 8;
const SIZE_MAX = 64;
const CYAN = '#4dd0e1';
const VIOLET = '#b48cfa';
const ACCENT = '#3ddc84';
const FALLBACK_COLOR = '#5b9cf5';
const STATION_IDLE_MS = 60 * 60 * 1000; // 1h sem uso = satelite quieto
const BOOK_ACTIVE_MS = 10 * 60 * 1000; // uso ha <10min = livro brilhando
// Review fix F7: alphas de anel theme-aware -- 0.05/0.04 eram calibradas
// pro ceu escuro e sumiam no light (derivado de getTheme() local; o
// contrato de theme.js fica intocado, lista de tokens fechada C1.2).
const ORBIT_RING_ALPHA = 0.05;
const ORBIT_RING_ALPHA_LIGHT = 0.13;
const LIB_RING_ALPHA = 0.04;
const LIB_RING_ALPHA_LIGHT = 0.1;
const SAT_LABEL_MIN_K = 0.5; // era 0.35: no fit os labels colidiam ilegiveis
const SAT_BADGE_MIN_K = 0.6;
const LIB_LABEL_MIN_K = 0.45;
const BOOK_LABEL_MIN_K = 0.9;
const LIB_RING_R = 185; // linha media do anel 170-200 dos livros
// Review fix F7: nucleo heroi no mergulho -- px de TELA crescem 42 -> 96
// conforme k sobe 1 -> 2.2 (focusHub) e o sprite hi-detail entra em k>1.5.
const CORE_PX_HERO = 96;
const CORE_HERO_K = 2.2;
const CORE_DETAIL_MIN_K = 1.5;
// Monograma e brilhos 'acesos': quase-branco FIXO nos 2 temas (o painel do
// satelite e escuro nos dois; derivar do tema apagava a letra no light).
const MONO_INK = '#f4fbff';
const LABEL_CHAR_W = 0.62; // avanco medio da mono em fracao do font-size
const SYNAPSE_PERIOD_MS = 3000;
const SYNAPSE_TRAVEL_MS = 1300;
const CACHE_MAX = 128;

// Scratch reusado por frame (dedupe dos raios de orbita, cap 16).
const ORBIT_RADII = [];

// -------------------------------------------------- variantes de design (flag)
// Flag (localStorage lido 1x no load) troca o MIOLO no fit-zoom; ausente => o
// caminho original roda intocado (baseline == atual). 'a' colapsa (estacao +
// anel + badges de contagem); 'b' arruma os satelites em 2 aneis limpos sem
// label. Nos dois, o mergulho (LOD alto) cai no caminho original com o detalhe.
function readFlag(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null; // localStorage bloqueado (modo privacidade): cai no atual
  }
}
// Default 'a' (colapsado) desde 02/07 — escolhido pelo dono vendo A/B.
// Rollback = localStorage torre.hubVariant='off' (escape hatch, remover
// apos uma semana de uso); 'b' segue disponivel pra comparacao.
const HUB_VARIANT = (() => {
  const raw = readFlag('torre.hubVariant');
  if (raw === 'off') return null;
  return raw === 'b' ? 'b' : 'a';
})();
// Colapsa/arruma o hub SO no fit-zoom (LOD baixo, mesma faixa em que as notas
// somem no graph-draw). Acima disso o detalhe original volta.
const HUB_LOW_LOD = 0.5;
// HUB-B: 2 aneis concentricos, icones uniformes 1.3x, alpha 0.45 (hover sobe).
const HUB_B_SAT_SCALE = 1.3;
const HUB_B_ALPHA = 0.45;
const HUB_B_RING_INNER = 96; // raio-base do anel interno (cresce se lotar)
const HUB_B_RING_OUTER = 150; // raio-base do anel externo
const HUB_B_RING_MAX = 200; // teto do anel externo (fica dentro da biblioteca)
const HUB_B_SPACING = 1.18; // folga angular entre icones (x tamanho do sprite)
const HUB_B_OMEGA_INNER = 0.05; // giro lento organizado (rad/s)
const HUB_B_OMEGA_OUTER = -0.035; // externo contra-gira devagar
// Anel do hub (colapsado ou limpo): um pouco mais presente que os orbit rings
// originais (0.05/0.04), que sumiam quando viram o unico traco estrutural.
const HUB_RING_ALPHA = 0.16;
const HUB_RING_ALPHA_LIGHT = 0.24;

function hubLow(eng) {
  return (eng._noteLOD ?? 1) <= HUB_LOW_LOD;
}

// ------------------------------------------------------- cache de sprites

const cache = new Map();

// Bake 2x com chave prefixada pelo tema corrente; paint recebe (ctx, th).
function bake(key, w, h, paint) {
  const k = `${getTheme()}:${key}`;
  if (cache.has(k)) return cache.get(k);
  if (cache.size >= CACHE_MAX) cache.clear();
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  paint(ctx, canvasTheme());
  cache.set(k, c);
  return c;
}

export function clearStationSprites() {
  cache.clear();
}

function px(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function circle(ctx, color, cx, cy, r) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

// Blit pixel-crisp centrado; restaura o smoothing anterior.
function blit(ctx, img, cx, cy, w, h) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.imageSmoothingEnabled = prev;
}

function stationSize(base, k) {
  return clamp(base / k, SIZE_MIN, SIZE_MAX);
}

// Tamanho do nucleo (em mundo): com k <= 1 usa clamp em mundo com teto
// PROPRIO (110; o teto 64 dos satelites igualava core e satelite no fit,
// matando a hierarquia de heroi); com k > 1 os px de TELA crescem
// 42 -> 96 ate o k do focusHub -- o nucleo vira heroi no mergulho em vez
// de coadjuvante de 42px num canvas de ~1000px.
const CORE_SIZE_MAX_WORLD = 110;

function coreSize(k) {
  if (k <= 1) return clamp(BASE_CORE_PX / k, SIZE_MIN, CORE_SIZE_MAX_WORLD);
  const t = clamp((k - 1) / (CORE_HERO_K - 1), 0, 1);
  return (BASE_CORE_PX + (CORE_PX_HERO - BASE_CORE_PX) * t) / k;
}

// Label cresce com o zoom: clamp(base, base*sqrt(k), max) px de TELA --
// discreto no fit, e no mergulho do hub o nome amigavel e o payoff.
function labelSizePx(k, base, max) {
  return clamp(base * Math.sqrt(k), base, max);
}

function finiteXY(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function safeColor(color) {
  return typeof color === 'string' && color.startsWith('#') ? color : FALLBACK_COLOR;
}

// ------------------------------------------------------ fonte 5x5 pixel

// Monograma do satelite: 1a letra alfanumerica do label, A-Z em 5x5.
const FONT_5X5 = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10111', '10001', '01110'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  Q: ['01110', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '11110', '10010', '10001'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '11111'],
};

function monogramOf(label) {
  const m = String(label || '').match(/[a-zA-Z0-9]/);
  return m ? m[0].toUpperCase() : '*';
}

// Letra fora da fonte (digito/asterisco) degrada para quadrado solido.
function drawMonogram(ctx, color, ch, x0, y0) {
  const rows = FONT_5X5[ch];
  ctx.fillStyle = color;
  if (!rows) {
    ctx.fillRect(x0 + 1, y0 + 1, 3, 3);
    return;
  }
  for (let r = 0; r < 5; r += 1) {
    const row = rows[r];
    for (let c = 0; c < 5; c += 1) {
      if (row.charCodeAt(c) === 49) ctx.fillRect(x0 + c, y0 + r, 1, 1);
    }
  }
}

// --------------------------------------------------------------- sprites

// Sinapse com glow BAKED: aura translucida + miolo aceso (zero blur/frame).
function paintSynapse(ctx, color, x, y, big) {
  const aura = big ? 4.6 : 3.4;
  ctx.fillStyle = hexToRgba(color, 0.16);
  ctx.fillRect(x - aura / 2, y - aura / 2, aura, aura);
  ctx.fillStyle = hexToRgba(color, 0.45);
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = big ? MONO_INK : color;
  ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
}

// Lobo de sinapses: pontos deterministicos no hemisferio, com glow baked.
function paintLobe(ctx, rng, color, cx, cy, count) {
  for (let i = 0; i < count; i += 1) {
    const x = cx + (rng() - 0.5) * 9;
    const y = cy + (rng() - 0.5) * 6;
    paintSynapse(ctx, color, x, y, rng() < 0.3);
  }
}

// Casco do nucleo: esfera em 3 tons + specular + rim-light cyan/violeta
// (o contorno luminoso e o que separa a estacao do ceu no tema claro).
function paintCoreHull(ctx, th) {
  circle(ctx, th.hullDark, 24, 26, 14);
  circle(ctx, th.hull, 23.6, 25.4, 12.9);
  circle(ctx, hexToRgba(th.hullLight, 0.85), 21, 22.6, 8.2);
  circle(ctx, hexToRgba(MONO_INK, 0.3), 19, 20.5, 4);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = hexToRgba(CYAN, 0.8);
  ctx.beginPath();
  ctx.arc(24, 26, 13.6, Math.PI * 0.78, Math.PI * 1.62);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(VIOLET, 0.55);
  ctx.beginPath();
  ctx.arc(24, 26, 13.6, Math.PI * 0.02, Math.PI * 0.5);
  ctx.stroke();
}

// Anel equatorial COMPLETO (elipse, nao arcos soltos) com 4 pods acesos.
function paintCoreRing(ctx, th) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = th.hullDark;
  ctx.beginPath();
  ctx.ellipse(24, 26, 20, 5.5, 0, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = th.hullLight;
  ctx.beginPath();
  ctx.ellipse(24, 25.4, 20, 5.5, 0, 0, TAU);
  ctx.stroke();
  const pods = [[44, 26], [24, 31.5], [4, 26], [24, 20.5]];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = pods[i];
    px(ctx, th.hullDark, x - 2, y - 2.5, 4, 5);
    px(ctx, th.hull, x - 1.5, y - 2, 3, 4);
    px(ctx, th.hullLight, x - 1.5, y - 2.5, 3, 1);
    const lit = i % 2 === 0 ? CYAN : th.towerLight;
    ctx.fillStyle = hexToRgba(lit, 0.35);
    ctx.fillRect(x - 1.5, y - 1, 3, 2.4);
    px(ctx, lit, x - 0.5, y - 0.5, 1, 1.4);
  }
}

function paintCoreAntennas(ctx, th) {
  px(ctx, th.hullDark, 14, 6, 1, 7);
  px(ctx, th.hullLight, 11, 5, 6, 2);
  px(ctx, MONO_INK, 13, 4, 2, 1);
  px(ctx, th.hullDark, 33, 4, 1, 9);
  px(ctx, th.hullLight, 30, 3, 6, 2);
  px(ctx, MONO_INK, 32, 2, 2, 1);
}

// Luzes de navegacao com glow nas pontas do anel equatorial.
function paintCoreNavLights(ctx, th) {
  ctx.fillStyle = hexToRgba(th.towerLight, 0.4);
  ctx.fillRect(2.5, 24.5, 3, 3);
  px(ctx, th.towerLight, 3.5, 25.5, 1, 1);
  ctx.fillStyle = hexToRgba(CYAN, 0.4);
  ctx.fillRect(42.5, 24.5, 3, 3);
  px(ctx, CYAN, 43.5, 25.5, 1, 1);
}

// Detalhe extra do mergulho (k > 1.5): janelas acesas no hemisferio sul.
function paintCoreWindows(ctx) {
  ctx.fillStyle = hexToRgba(MONO_INK, 0.75);
  for (let i = 0; i < 5; i += 1) ctx.fillRect(17 + i * 3, 32.5, 1.4, 1);
  for (let i = 0; i < 4; i += 1) ctx.fillRect(19 + i * 3, 35, 1.4, 1);
}

// Nucleo cerebral 48x48 (redesign review F7): casco legivel nos 2 temas,
// 2 lobos de sinapses cyan/violeta com glow baked, anel equatorial
// completo com 4 pods acesos, antenas-prato e luzes de navegacao.
function paintCore(ctx, th, hi) {
  const rng = mulberry32(hash32('core-lobes'));
  paintCoreAntennas(ctx, th);
  paintCoreHull(ctx, th);
  paintLobe(ctx, rng, CYAN, 17, 20, hi ? 8 : 5);
  paintLobe(ctx, rng, VIOLET, 30, 19, hi ? 8 : 5);
  if (hi) paintCoreWindows(ctx);
  paintCoreRing(ctx, th);
  paintCoreNavLights(ctx, th);
}

// hi=true: variante com mais sinapses + janelas, usada no mergulho (k>1.5).
export function coreSprite(hi) {
  const detail = Boolean(hi);
  return bake(detail ? 'core:hi' : 'core', 48, 48, (ctx, th) => paintCore(ctx, th, detail));
}

// Satelite 20x20: prato com concavidade, corpo com painel-monograma 5x5
// (1a letra do label do servico) e paineis solares com grade.
function paintSat(ctx, th, col, ch) {
  // prato com concavidade + feed
  px(ctx, col, 4, 0, 12, 2);
  px(ctx, hexToRgba(col, 0.65), 6, 2, 8, 1);
  px(ctx, hexToRgba(col, 0.4), 8, 3, 4, 1);
  px(ctx, th.cockpit, 9, 0, 2, 1);
  // mastro + corpo
  px(ctx, th.hull, 9, 4, 2, 2);
  px(ctx, th.hull, 5, 6, 10, 12);
  px(ctx, th.hullLight, 5, 6, 10, 1);
  px(ctx, th.hullDark, 5, 17, 10, 1);
  // painel do monograma: letra quase-branca FIXA (MONO_INK) nos 2 temas;
  // th.windowLit no light era tinta escura sobre painel escuro (invisivel).
  px(ctx, th.hullDark, 7, 9, 7, 7);
  drawMonogram(ctx, MONO_INK, ch, 8, 10);
  // paineis solares com grade
  px(ctx, hexToRgba(col, 0.8), 0, 8, 4, 8);
  px(ctx, hexToRgba('#04070b', 0.4), 1, 8, 1, 8);
  px(ctx, hexToRgba('#04070b', 0.4), 0, 11, 4, 1);
  px(ctx, hexToRgba(col, 0.8), 16, 8, 4, 8);
  px(ctx, hexToRgba('#04070b', 0.4), 18, 8, 1, 8);
  px(ctx, hexToRgba('#04070b', 0.4), 16, 11, 4, 1);
  // luz de navegacao
  px(ctx, th.towerLight, 5, 18, 1, 1);
}

export function satSprite(color, monogram) {
  const col = safeColor(color);
  const ch = monogramOf(monogram);
  return bake(`sat:${col}:${ch}`, 20, 20, (ctx, th) => paintSat(ctx, th, col, ch));
}

// Tomo 10x12: capa na cor da skill, lombada escura, corte de paginas e
// brilho-runa central.
function paintBook(ctx, th, col) {
  px(ctx, hexToRgba('#04070b', 0.45), 1, 11, 9, 1); // sombra da base
  px(ctx, col, 1, 1, 8, 10); // capa
  px(ctx, hexToRgba('#04070b', 0.35), 1, 1, 2, 10); // lombada
  px(ctx, hexToRgba('#ffffff', 0.25), 3, 1, 6, 1); // aresta de luz
  px(ctx, th.cockpit, 9, 2, 1, 8); // corte das paginas
  // runa central em cruz
  px(ctx, th.windowLit, 5, 4, 1, 3);
  px(ctx, th.windowLit, 4, 5, 3, 1);
  px(ctx, hexToRgba('#ffffff', 0.7), 5, 5, 1, 1);
}

export function bookSprite(color) {
  const col = safeColor(color);
  return bake(`book:${col}`, 10, 12, (ctx, th) => paintBook(ctx, th, col));
}

// ------------------------------------------------------------ texto util

function drawTextLabel(eng, th, text, x, y, sizePx, color, alpha) {
  const { ctx, cam } = eng;
  ctx.font = `${sizePx / cam.k}px ${th.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3 / cam.k;
  ctx.strokeStyle = th.labelStroke;
  ctx.strokeText(String(text), x, y);
  ctx.fillStyle = color;
  ctx.fillText(String(text), x, y);
}

// ------------------------------------------------------- estacao + MCPs

// Estacao cerebral + satelites MCP. Chamado pelo drawFrame logo apos
// drawSubClusterLabels e antes de drawLibrary/drawFleetOver. INDEPENDE da
// frota; universo sem stations (modo local, payload v2) => no-op.
export function drawStations(eng, now) {
  const u = eng.universe;
  if (!u || !Array.isArray(u.stations) || !u.stations.length) return;
  const th = canvasTheme();
  const ts = Number.isFinite(now) ? now : performance.now();
  const t = ts / 1000;
  const epoch = Date.now(); // lastUsedTs e epoch ms, nao performance.now()
  // Variantes de design SO no fit-zoom; o caminho original (abaixo) fica
  // intocado, entao sem flag ou no mergulho o render e identico ao atual.
  if (HUB_VARIANT === 'a' && hubLow(eng)) {
    drawCollapsedHub(eng, th, u, t);
    eng.ctx.globalAlpha = 1;
    return;
  }
  if (HUB_VARIANT === 'b' && hubLow(eng)) {
    drawCleanHub(eng, th, u, t, epoch);
    eng.ctx.globalAlpha = 1;
    return;
  }
  drawOrbitRings(eng, u, th);
  if (u.beacon) drawCoreStation(eng, th, t);
  for (const st of u.stations) {
    if (!st || !finiteXY(st.px, st.py)) continue;
    drawSatellite(eng, th, st, t, epoch);
  }
  drawSatLabels(eng, th, u, epoch);
  if (!eng.reduced && u.beacon) drawSynapse(eng, u.stations, ts);
  eng.ctx.globalAlpha = 1;
}

// Aneis de orbita dos satelites: um arc por raio unico (scratch reusado).
function drawOrbitRings(eng, u, th) {
  const { ctx, cam } = eng;
  ORBIT_RADII.length = 0;
  for (const st of u.stations) {
    const a = st && Number(st.a);
    if (Number.isFinite(a) && a > 0 && ORBIT_RADII.indexOf(a) === -1) ORBIT_RADII.push(a);
  }
  if (!ORBIT_RADII.length) return;
  ctx.strokeStyle = th.orbitRing;
  ctx.lineWidth = 1 / cam.k;
  ctx.globalAlpha = getTheme() === 'light' ? ORBIT_RING_ALPHA_LIGHT : ORBIT_RING_ALPHA;
  for (const r of ORBIT_RADII) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  }
}

// Nucleo cerebral em (0,0): halo accent pulsante ATRAS (e o que separa a
// estacao do ceu no dark) + sprite (hi-detail no mergulho) + anel girando
// devagar + 'FAROL' afastado do anel (0.95 sw; o violeta gira em ~0.85).
function drawCoreStation(eng, th, t) {
  const { ctx, cam } = eng;
  const sw = coreSize(cam.k);
  const pulse = eng.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.4);
  const hs = sw * (0.85 + 0.12 * pulse);
  ctx.globalAlpha = 0.14 + 0.16 * pulse;
  ctx.drawImage(haloSprite(ACCENT), -hs, -hs, hs * 2, hs * 2);
  ctx.globalAlpha = 0.98;
  blit(ctx, coreSprite(cam.k > CORE_DETAIL_MIN_K), 0, 0, sw, sw);
  drawCoreRing(eng, t, sw);
  drawTextLabel(eng, th, 'FAROL', 0, sw * 0.95, labelSizePx(cam.k, 11, 14), th.labelStrong, 0.92);
}

// Anel orbital do nucleo: 2 arcs cyan opostos + 1 arc violeta contrario.
function drawCoreRing(eng, t, sw) {
  const { ctx, cam } = eng;
  const r = sw * 0.72;
  const a0 = eng.reduced ? 0.6 : t * 0.35;
  ctx.lineWidth = 1.4 / cam.k;
  ctx.strokeStyle = CYAN;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, a0, a0 + TAU * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, a0 + Math.PI, a0 + Math.PI + TAU * 0.3);
  ctx.stroke();
  ctx.strokeStyle = VIOLET;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.18, -a0 * 0.7, -a0 * 0.7 + TAU * 0.22);
  ctx.stroke();
}

// Idle (1h+ sem uso) fica quieto: alpha rebaixada compartilhada entre
// sprite, beacon e label.
function satBaseAlpha(st, epoch) {
  const last = Number(st.lastUsedTs);
  const idle = !Number.isFinite(last) || last <= 0 || epoch - last > STATION_IDLE_MS;
  return idle ? 0.62 : 1;
}

// Satelite: sprite com monograma e beacon piscando; badge de count com
// k > 0.6. O label sai no pass collision-aware (drawSatLabels).
function drawSatellite(eng, th, st, t, epoch) {
  const { ctx, cam } = eng;
  const base = satBaseAlpha(st, epoch);
  const sw = stationSize(BASE_SAT_PX, cam.k);
  ctx.globalAlpha = base;
  blit(ctx, satSprite(st.color, st.label), st.px, st.py, sw, sw);
  drawSatBeacon(eng, st, t, sw, base, base < 1);
  if (cam.k > SAT_BADGE_MIN_K && Number(st.count) > 0) {
    drawTextLabel(eng, th, `${st.count}`, st.px + sw * 0.58, st.py - sw * 0.78, 8, th.labelDim, base * 0.85);
  }
}

// ---------------------------------------------- labels collision-aware

// Caixas (em mundo) dos labels ja colocados no frame: scratch reusado,
// zero alocacao apos o warmup. Prioridade = ordem do array de stations
// (buildStations ja ordena por count desc).
const LABEL_BOXES = [];

function placeLabelBox(x, y, w, h, used) {
  let b = LABEL_BOXES[used];
  if (!b) {
    b = { x: 0, y: 0, w: 0, h: 0 };
    LABEL_BOXES[used] = b;
  }
  b.x = x;
  b.y = y;
  b.w = w;
  b.h = h;
  return used + 1;
}

function hitsPlacedBox(x, y, w, h, used) {
  for (let i = 0; i < used; i += 1) {
    const b = LABEL_BOXES[i];
    if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return true;
  }
  return false;
}

// Reserva a caixa do 'FAROL' antes dos satelites: nenhum label de
// servico cobre o nome do nucleo.
function seedCoreLabelBox(eng) {
  const k = eng.cam.k;
  const fs = labelSizePx(k, 11, 14) / k;
  const w = 7 * fs * LABEL_CHAR_W; // 'FAROL' = 7 chars
  return placeLabelBox(-w / 2, coreSize(k) * 0.95, w, fs * 1.3, 0);
}

// Labels dos satelites (review fix F7): cada label tenta o lado preferido
// (alterna abaixo/acima por indice), cai pro outro lado se colidir e e
// SUPRIMIDO se ambos colidirem -- prioridade por count, nada se sobrepoe.
// Largura estimada por avanco medio da mono (sem measureText por frame).
function drawSatLabels(eng, th, u, epoch) {
  const { cam } = eng;
  if (cam.k <= SAT_LABEL_MIN_K) return;
  let used = u.beacon ? seedCoreLabelBox(eng) : 0;
  const sizePx = labelSizePx(cam.k, 8, 13);
  const fs = sizePx / cam.k; // em unidades de mundo (ctx esta escalado)
  const h = fs * 1.3;
  const sw = stationSize(BASE_SAT_PX, cam.k);
  for (let i = 0; i < u.stations.length; i += 1) {
    const st = u.stations[i];
    if (!st || !finiteXY(st.px, st.py)) continue;
    const text = String(st.label || st.id || 'mcp');
    const w = Math.max(text.length, 1) * fs * LABEL_CHAR_W;
    const x = st.px - w / 2;
    const below = st.py + sw * 0.62;
    const above = st.py - sw * 0.62 - h;
    let y = i % 2 === 0 ? below : above;
    if (hitsPlacedBox(x, y, w, h, used)) {
      y = i % 2 === 0 ? above : below;
      if (hitsPlacedBox(x, y, w, h, used)) continue; // colisao dupla: suprime
    }
    used = placeLabelBox(x, y, w, h, used);
    drawTextLabel(eng, th, text, st.px, y, sizePx, th.label, satBaseAlpha(st, epoch) * 0.9);
  }
}

function drawSatBeacon(eng, st, t, sw, base, idle) {
  const { ctx, cam } = eng;
  const speed = idle ? 0.7 : 2;
  const blink = eng.reduced
    ? 0.6
    : 0.35 + 0.65 * Math.max(0, Math.sin(t * speed + (Number(st.blinkPhase) || 0)));
  const pr = Math.max(sw * 0.14, 0.8 / cam.k);
  ctx.globalAlpha = base * blink;
  ctx.fillStyle = safeColor(st.color);
  ctx.fillRect(st.px - pr / 2, st.py - sw * 0.66 - pr / 2, pr, pr);
}

// Sinapse: a cada ~3s um pulso viaja nucleo -> satelite (escolhido por
// hash da janela de tempo, deterministico, zero estado). Dot + rastro
// curto, mesma estetica do ripple do fleet-draw.
function drawSynapse(eng, stations, now) {
  const win = Math.floor(now / SYNAPSE_PERIOD_MS);
  const p = (now - win * SYNAPSE_PERIOD_MS) / SYNAPSE_TRAVEL_MS;
  if (p >= 1) return;
  const st = stations[((win * 2654435761) >>> 0) % stations.length];
  if (!st || !finiteXY(st.px, st.py)) return;
  const { ctx, cam } = eng;
  const color = safeColor(st.color);
  const r = clamp(2 / cam.k, 0.8, 3);
  ctx.fillStyle = color;
  for (let j = 2; j >= 1; j -= 1) {
    const tt = Math.max(0, p - j * 0.08);
    ctx.globalAlpha = 0.32 - j * 0.1;
    ctx.fillRect(st.px * tt - r * 0.4, st.py * tt - r * 0.4, r * 0.8, r * 0.8);
  }
  const x = st.px * p;
  const y = st.py * p;
  const hs = r * 3.2;
  ctx.globalAlpha = 0.5;
  ctx.drawImage(haloSprite(color), x - hs, y - hs, hs * 2, hs * 2);
  ctx.globalAlpha = 0.95;
  ctx.fillRect(x - r / 2, y - r / 2, r, r);
}

// ----------------------------------------------------- variante HUB-A / HUB-B

// Anel fino generico (colapsado e limpo): 1 arco na cor do orbitRing do tema.
function drawHubRing(eng, th, r) {
  const { ctx, cam } = eng;
  ctx.strokeStyle = th.orbitRing;
  ctx.lineWidth = 1 / cam.k;
  ctx.globalAlpha = getTheme() === 'light' ? HUB_RING_ALPHA_LIGHT : HUB_RING_ALPHA;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
}

// Raio representativo dos satelites (media dos raios de orbita, sem a 'web'
// que orbita la fora): o anel colapsado fica onde os satelites estariam.
function collapsedRadius(u) {
  let sum = 0;
  let n = 0;
  for (const st of u.stations) {
    if (!st || st.kind === 'web') continue;
    const a = Number(st.a);
    if (Number.isFinite(a) && a > 0) { sum += a; n += 1; }
  }
  return n ? sum / n : 120;
}

// HUB-A "colapsado": no fit-zoom o miolo vira so a estacao central + 1 anel
// fino + 2 badges de contagem. O amontoado ilegivel some e o dado (quantos
// MCP / quantas skills) fica legivel; o mergulho traz o detalhe de volta.
function drawCollapsedHub(eng, th, u, t) {
  drawHubRing(eng, th, collapsedRadius(u));
  if (u.beacon) drawCoreStation(eng, th, t);
  drawHubBadges(eng, th, u);
}

// 2 badges mono discretos abaixo do 'FAROL': "<n> MCP" e "<n> SKILLS".
function drawHubBadges(eng, th, u) {
  const { cam } = eng;
  const sw = coreSize(cam.k);
  const mcp = u.stations.length;
  const skills = Array.isArray(u.books) ? u.books.length : 0;
  const sizePx = labelSizePx(cam.k, 9, 12);
  const lh = (sizePx * 1.5) / cam.k;
  let y = sw * 0.95 + (labelSizePx(cam.k, 11, 14) * 1.6) / cam.k; // abaixo do nome
  drawTextLabel(eng, th, `${mcp} MCP`, 0, y, sizePx, th.labelDim, 0.82);
  if (skills > 0) {
    y += lh;
    drawTextLabel(eng, th, `${skills} SKILLS`, 0, y, sizePx, th.labelDim, 0.82);
  }
}

// Tamanho uniforme dos icones do HUB-B (1.3x) com o clamp tambem escalado:
// senao no fit-zoom o SIZE_MAX ja engoliria o ganho e os icones nao cresceriam.
function stationSizeB(k) {
  return clamp((BASE_SAT_PX * HUB_B_SAT_SCALE) / k, SIZE_MIN, SIZE_MAX * HUB_B_SAT_SCALE);
}

// Raio de anel que garante folga: circunferencia >= count * sprite * spacing,
// capado ao teto (fica dentro da biblioteca). Organizacao > densidade: se
// lotar, o anel abre em vez de os icones voltarem a se amontoar.
function cleanRingRadius(base, count, sw) {
  const needed = (sw * HUB_B_SPACING * Math.max(count, 1)) / TAU;
  return clamp(Math.max(base, needed), base, HUB_B_RING_MAX);
}

// HUB-B "aneis limpos": mantem os satelites no fit-zoom, mas em 2 aneis
// concentricos com espacamento angular uniforme, icones uniformes 1.3x e SEM
// labels. Alpha 0.45, subindo pra 1 no satelite sob o mouse (pick existente).
function drawCleanHub(eng, th, u, t, epoch) {
  const stations = u.stations;
  const n = stations.length;
  const innerCount = Math.ceil(n / 2);
  const outerCount = n - innerCount;
  const sw = stationSizeB(eng.cam.k);
  const innerR = cleanRingRadius(HUB_B_RING_INNER, innerCount, sw);
  const outerR = Math.max(cleanRingRadius(HUB_B_RING_OUTER, outerCount, sw), innerR + sw * 0.95);
  drawHubRing(eng, th, innerR);
  drawHubRing(eng, th, outerR);
  if (u.beacon) drawCoreStation(eng, th, t);
  const rotIn = eng.reduced ? 0 : t * HUB_B_OMEGA_INNER;
  const rotOut = eng.reduced ? 0 : t * HUB_B_OMEGA_OUTER;
  let iIn = 0;
  let iOut = 0;
  for (let i = 0; i < n; i += 1) {
    const st = stations[i];
    if (!st) continue;
    const inner = i % 2 === 0;
    const count = inner ? innerCount : outerCount;
    const idx = inner ? iIn : iOut;
    const rot = inner ? rotIn : rotOut;
    const stagger = inner ? 0 : Math.PI / Math.max(count, 1); // externo entre os internos
    const ang = rot + (idx / Math.max(count, 1)) * TAU + stagger;
    const r = inner ? innerR : outerR;
    drawCleanSat(eng, st, Math.cos(ang) * r, Math.sin(ang) * r, sw, epoch);
    if (inner) iIn += 1; else iOut += 1;
  }
}

// Satelite do HUB-B: sprite uniforme, sem label/beacon; alpha 0.45 (ou 1 sob
// hover). Idle (1h+ sem uso) segue mais quieto, como no caminho original.
function drawCleanSat(eng, st, x, y, sw, epoch) {
  const { ctx } = eng;
  const hovered = eng.hover && eng.hover.station === st;
  let alpha = hovered ? 1 : HUB_B_ALPHA;
  if (satBaseAlpha(st, epoch) < 1) alpha *= 0.75;
  ctx.globalAlpha = alpha;
  blit(ctx, satSprite(st.color, st.label), x, y, sw, sw);
}

// ------------------------------------------------------------ biblioteca

// Anel BIBLIOTECA: ate 12 livros (universe.books) orbitando entre os
// satelites e as galaxias; px/py vem do updatePositions do engine, o bob
// e so visual. Universo sem books (local/payload sem skills) => no-op.
export function drawLibrary(eng, now) {
  const u = eng.universe;
  const books = u && u.books;
  if (!Array.isArray(books) || !books.length) return;
  // HUB-A colapsado: os livros somem do fit-zoom (a contagem vira badge no
  // hub). HUB-B e o caminho normal mantem a biblioteca intacta.
  if (HUB_VARIANT === 'a' && hubLow(eng)) return;
  const th = canvasTheme();
  const ts = Number.isFinite(now) ? now : performance.now();
  const epoch = Date.now();
  drawLibraryRing(eng, th);
  for (const b of books) {
    if (!b || !finiteXY(b.px, b.py)) continue;
    drawBook(eng, th, b, ts, epoch);
  }
  if (eng.cam.k > LIB_LABEL_MIN_K) {
    const libSize = labelSizePx(eng.cam.k, 8, 12);
    drawTextLabel(eng, th, 'BIBLIOTECA', 0, -LIB_RING_R - 18 / eng.cam.k, libSize, th.labelDim, 0.8);
  }
  eng.ctx.globalAlpha = 1;
}

function drawLibraryRing(eng, th) {
  const { ctx, cam } = eng;
  ctx.strokeStyle = th.orbitRing;
  ctx.lineWidth = 1 / cam.k;
  ctx.globalAlpha = getTheme() === 'light' ? LIB_RING_ALPHA_LIGHT : LIB_RING_ALPHA;
  ctx.beginPath();
  ctx.arc(0, 0, LIB_RING_R, 0, TAU);
  ctx.stroke();
}

// Livro: sprite + bob senoidal + brilho-runa pulsando em hash-phase;
// uso recente (<10min) ganha glow accent e particula-runa subindo.
function drawBook(eng, th, b, now, epoch) {
  const { ctx, cam } = eng;
  const bw = stationSize(BASE_BOOK_PX, cam.k);
  const bh = bw * 1.2;
  const bob = eng.reduced ? 0 : Math.sin(eng.time * 1.1 + (b.bobPhase || 0)) * bw * 0.1;
  const y = b.py + bob;
  const active = Number(b.lastUsedTs) > 0 && epoch - b.lastUsedTs < BOOK_ACTIVE_MS;
  if (active) drawBookGlow(eng, b, y, bw, now);
  ctx.globalAlpha = 0.95;
  blit(ctx, bookSprite(b.color), b.px, y, bw, bh);
  const rune = eng.reduced ? 0.7 : 0.55 + 0.45 * Math.sin(eng.time * 1.8 + (b.phase || 0));
  const pr = Math.max(bw * 0.12, 0.6 / cam.k);
  ctx.globalAlpha = 0.4 + 0.5 * rune;
  ctx.fillStyle = th.windowLit;
  ctx.fillRect(b.px - pr / 2, y - bh * 0.12 - pr / 2, pr, pr);
  if (cam.k > BOOK_LABEL_MIN_K) {
    const size = labelSizePx(cam.k, 7, 12); // cresce no mergulho como os MCPs
    drawTextLabel(eng, th, truncate(b.label, 18), b.px, y + bh * 0.6, size, th.labelDim, 0.85);
  }
}

function drawBookGlow(eng, b, y, bw, now) {
  const { ctx, cam } = eng;
  const pulse = eng.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(now / 320);
  const hs = bw * (1.1 + 0.15 * pulse);
  ctx.globalAlpha = 0.3 + 0.25 * pulse;
  ctx.drawImage(haloSprite(ACCENT), b.px - hs, y - hs, hs * 2, hs * 2);
  if (eng.reduced) return;
  // particula-runa subindo: ciclo derivado de now, zero estado
  const ct = (now % 1400) / 1400;
  const ry = y - bw * (0.7 + ct * 1.4);
  const ps = Math.max(bw * 0.1, 0.6 / cam.k);
  ctx.globalAlpha = (1 - ct) * 0.8;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(b.px - ps / 2, ry - ps / 2, ps, ps);
}
