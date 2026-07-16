// FAROL - graph-universe.js (A2, F3+F4; P3 na F5 fase 2): modelo do
// grafo-universo. Constroi o universo a partir do payload de GET
// /api/graph: galaxias (pastas PARA) em anel deterministico, notas como
// planetas com orbita derivada do hash do path (raio por backlinks,
// periodo 90-240s, fase, excentricidade leve), brilho real por recencia
// do mtimeMs, starfield de 3 camadas + poeira estelar, nebulosas
// pre-renderizadas (blur BAKED no offscreen, nunca filter por frame) e
// sprites cacheados por cor.
// F5.8: estacoes de servico (MCP servers de /api/mcp) orbitando o farol
// TORRE no miolo do anel (universe.stations / stationById / beacon).
// F7: aneis das estacoes sobem (78-104 / 124-152, satelites maiores
// respiram) e nasce a BIBLIOTECA orbital: skills de /api/skills viram
// livros (universe.books / bookById) num anel 170-200 entre os satelites
// e as galaxias. Sprites cacheados com chave PREFIXADA pelo tema
// (getTheme()); skySprite le canvasTheme() para o ceu do tema corrente.
// F5.9-v2: anel original de galaxias por pasta PARA raiz (geometria F4);
// grupos densos (count > 70) ganham segmentacao LEVE por dentro: cada
// nota recebe subgroup (2o segmento do path), clusteriza num setor
// angular com omega compartilhado e ganha shade sutil da cor do grupo.
// Centroides dos clusters em universe.subClusters (1x no build).
// Zero estado de DOM aqui: so dados e sprites. Consumido por Graph.jsx,
// graph-engine.js, graph-draw.js e graph-station.js (ownership W-GRAPH).
import { canvasTheme, getTheme } from './theme.js';

export const TAU = Math.PI * 2;
export const ORIGIN_GALAXY = { cx: 0, cy: 0 };

const ORBIT_MIN_S = 90;
const ORBIT_SPAN_S = 150;
const GALAXY_GAP = 70;
// Heliocêntrico: todas as galáxias revolvem ao redor da Torre (0,0) na MESMA
// velocidade angular (anel sempre equidistante, sem conjunção). ~280s/volta.
const GAL_OMEGA = TAU / 280;
const LOCAL_RINGS = [0, 130, 230];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const STARS_FAR = 220;
const STARS_MID = 140;
const STARS_NEAR = 90;
const DUST_COUNT = 50;
const STAR_SEED = 20260610;
const NEBULA_SPRITE_PX = 256;
const NEBULA_FALLBACK = '#5b9cf5';
// F5.9-v2: segmentacao leve POR DENTRO dos grupos densos (count > 70).
const SPLIT_MAX = 70;
const SUB_PERIOD_MIN_S = 120;
const SUB_PERIOD_SPAN_S = 80; // periodo compartilhado do subgrupo: 120-200s
// Review visual F5.9-v2: +-14% lia quase tudo como o mesmo cyan; +-24%
// mantem a familia coesa mas torna os grumos distinguiveis no olho.
const SHADE_STEPS = [-0.24, -0.12, 0, 0.12, 0.24];
const HASH_SPAN = 4294967296; // 2^32: hash32 -> fracao 0..1
// Distribuicao por angulo aureo (filotaxia/girassol): cada nota recebe um
// indice i dentro do grupo e ganha phase = i * GOLDEN_ANGLE, que preenche o
// disco de forma uniforme e redonda em vez de grumos+vazios do rng puro.
const GOLDEN_ANGLE = 2.399963267; // ~137.5 graus em rad: PI*(3-sqrt(5))
const ANGLE_JITTER_RAD = 0.05; // jitter pequeno deterministico anti-relogio
// Raio com densidade uniforme NO DISCO: r = sqrt(rng())*(span)+minOrbit.
// A raiz quadrada compensa a area crescente do anel (uniforme em area,
// nao em raio), preenchendo o disco inteiro em vez de empilhar aneis.
const CONN_PULL_IN = 0.15; // vies leve: nota muito conectada puxa 15% pra dentro
// F5.8/F7: satelites de servico (MCP) orbitando a estacao no miolo.
// F7: aneis maiores (satelites grandes respiram): 78-104 / 124-152.
const STATION_CAP = 16;
const STATION_R = 4;
const STATION_RING_INNER = 78;
const STATION_RING_INNER_SPAN = 26; // anel interno: 78-104
const STATION_RING_OUTER = 124;
const STATION_RING_OUTER_SPAN = 28; // anel externo: 124-152
// Review fix F7: omega COMPARTILHADO por anel (interno horario, externo
// anti-horario) -- com periodos por hash os slots angulares uniformes
// degradariam com o tempo; compartilhado, ficam uniformes para sempre.
const STATION_OMEGA_INNER = TAU / 110; // anel interno: volta em ~110s
const STATION_OMEGA_OUTER = -TAU / 160; // anel externo contra-gira em ~160s
// F7: biblioteca orbital de skills (livros entre satelites e galaxias).
const BOOK_CAP = 12;
const BOOK_R = 5;
const BOOK_RING_INNER = 170;
const BOOK_RING_SPAN = 30; // anel da biblioteca: 170-200
const BOOK_PERIOD_MIN_S = 90;
const BOOK_PERIOD_SPAN_S = 90; // periodo orbital 90-180s
const BOOK_VIOLET = '#b48cfa'; // base dos tomos; shade sutil por hash

// paleta por pasta PARA (SPEC: Inbox cinza, Projects verde radar, Areas azul,
// Resources cyan, Atlas roxo, Daily ambar, Templates dim, System vermelho-dim)
export const GROUP_STYLES = [
  { key: 'inbox', label: 'Inbox', color: '#8a97a3' },
  { key: 'project', label: 'Projects', color: '#3ddc84' },
  { key: 'area', label: 'Areas', color: '#5b9cf5' },
  // lightColor (review fix F7): cyan claro lavava no ceu claro; variante
  // do MESMO hue mais escura/saturada (SPEC C1.2 autoriza +contraste).
  { key: 'resource', label: 'Resources', color: '#4dd0e1', lightColor: '#0e7d90' },
  { key: 'atlas', label: 'Atlas', color: '#b18cf2' },
  { key: 'daily', label: 'Daily', color: '#ffb454' },
  { key: 'template', label: 'Templates', color: '#5d6b78' },
  { key: 'system', label: 'System', color: '#c25b54' },
];
const FALLBACK_COLOR = '#5d6b78';

// Paleta de servico (F5.8): tons violeta/teal/magenta distintos das
// galaxias PARA; cor do satelite escolhida por hash do id do MCP.
export const SERVICE_PALETTE = [
  '#7a4df2', '#b03df0', '#e04ad8', '#f0569e', '#1fc8a9', '#16a085', '#62e8c0',
];

// ---------------------------------------------------------------- helpers

export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// PRNG deterministico barato; cada nota deriva sua orbita do hash do path.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function colorForGroup(group) {
  const g = String(group || '').toLowerCase();
  const style = GROUP_STYLES.find((s) => g.includes(s.key));
  if (!style) return FALLBACK_COLOR;
  // O build re-roda na troca de tema (Graph.jsx recria o engine), entao a
  // cor escolhida aqui e estavel pela vida do universo corrente.
  return getTheme() === 'light' && style.lightColor ? style.lightColor : style.color;
}

// Tom por subgrupo (F5.9-v2): blend deterministico do hex em direcao a
// preto (step negativo) ou branco (step positivo), 5 passos sutis de
// -14% a +14% (step = hash32(subgroup) % 5). Sem lib de cor; a familia
// continua legivel como mancha unica, subpastas distinguiveis no olho.
function shadeColor(hex, step) {
  const amount = SHADE_STEPS[step] || 0;
  if (amount === 0) return hex;
  const n = parseInt(String(hex).slice(1), 16);
  const toward = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (ch) => Math.round(ch + (toward - ch) * t);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

export function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function baseName(p) {
  const last = String(p || '').split(/[\\/]/).pop() || '';
  return last.replace(/\.md$/i, '');
}

export function groupOf(row) {
  return row.group || 'root';
}

export function cleanGroup(group) {
  const g = String(group || 'root');
  return g === 'root' ? 'raiz do vault' : g.replace(/^\d+-/, '');
}

// Q5: tamanho = importância. Bump gentil no raio por backlinks (notas muito
// conectadas mais gordas) — contraste hub-vs-folha mais legível.
function noteWorldRadius(size) {
  return clamp(1.6 + (Number(size) || 1) * 1.05, 1.6, 7.5);
}

export function relTime(mtimeMs) {
  const mins = Math.floor((Date.now() - mtimeMs) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `há ${d} d`;
  const m = Math.floor(d / 30);
  return m < 12 ? `há ${m} meses` : `há ${Math.floor(m / 12)} anos`;
}

// Brilho real: tier visual derivado da recencia do mtimeMs (dado -> visual).
// Sem mtimeMs (server ainda v2) a nota degrada para estrela fria.
function brightnessTier(mtimeMs, now) {
  const age = now - mtimeMs;
  if (!mtimeMs || age > MONTH_MS) {
    return { halo: 0, haloAlpha: 0, core: 0.55, pulse: 0, scale: 0.8 };
  }
  if (age <= DAY_MS) return { halo: 3.4, haloAlpha: 0.55, core: 1, pulse: 1, scale: 1.15 };
  if (age <= WEEK_MS) return { halo: 2.3, haloAlpha: 0.32, core: 0.95, pulse: 0, scale: 1 };
  return { halo: 1.7, haloAlpha: 0.16, core: 0.8, pulse: 0, scale: 0.9 };
}

// ------------------------------------------------- sprites de halo cacheados

// F7 (review fix): prefixo de tema SO nos sprites cujo conteudo depende
// do tema -- sky le canvasTheme(); nebula/rays mantem o prefixo por
// higiene de cache cruzado. halo/sun derivam 100% da cor do argumento:
// chave CRUA, troca de tema nao re-baka nem acumula entradas duplicadas
// (o cache nao tem eviction; cada entrada e um <canvas> offscreen vivo).
const spriteCache = new Map();

function themeKey(key) {
  return `${getTheme()}:${key}`;
}

// key ja FINAL: o caller decide se prefixa com themeKey().
function makeSprite(key, size, stops) {
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [off, col] of stops) g.addColorStop(off, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
}

// Ceu do tema: gradiente radial sky -> skyDeep baked UMA vez por tema;
// o drawFrame estica no viewport com 1 drawImage (zero gradiente/frame).
export function skySprite() {
  const th = canvasTheme();
  return makeSprite(themeKey('sky'), 256, [
    [0, th.sky],
    [0.55, th.sky],
    [1, th.skyDeep],
  ]);
}

export function haloSprite(color) {
  return makeSprite(`halo:${color}`, 64, [
    [0, hexToRgba(color, 0.85)],
    [0.35, hexToRgba(color, 0.22)],
    [1, hexToRgba(color, 0)],
  ]);
}

// CORPO da estrela (F-sun): "sol de verdade" baked por cor em vez do glow
// chapado antigo. Disco DEFINIDO (limbo escuro) + nucleo branco-quente +
// granulacao (mottling PRNG) + cromosfera macia na borda. O glow/corona aditivo
// fica por conta do haloSprite no drawSuns; aqui e so o corpo. Baked UMA vez.
// Parametrizado por PRESET pra o dono escolher o balanco vendo (sun-preview):
// glow (macio) / defined (equilibrado) / solar (sol de verdade, mais granulado).
export const STAR_PRESETS = {
  glow: {
    tag: 'glow', discR: 0.74, coreR: 0.34, cromoStart: 0.82, cromoA: 0.5,
    hot: 0.78, hotMid: 0.26, limbA: 0.22, limbB: 0.42, gran: 22, granA: 0.12,
    corona: 2.85, body: 1.6,
  },
  defined: {
    tag: 'defined', discR: 0.78, coreR: 0.3, cromoStart: 0.9, cromoA: 0.42,
    hot: 0.8, hotMid: 0.28, limbA: 0.3, limbB: 0.58, gran: 30, granA: 0.18,
    corona: 2.15, body: 1.85,
  },
  // SOLAR refinado (escolha do dono 2026-06-23, 'leve refino'): nucleo um
  // tico maior/mais quente, corona com mais radiancia (nao tao pelada), limbo
  // menos preto na borda, granulacao mais limpa (menos celulas + menos alpha).
  solar: {
    tag: 'solar', discR: 0.82, coreR: 0.3, cromoStart: 0.92, cromoA: 0.38,
    hot: 0.84, hotMid: 0.32, limbA: 0.36, limbB: 0.64, gran: 34, granA: 0.19,
    corona: 2.0, body: 1.95,
  },
};
// Preset ATIVO do app (drawSuns le corona/body daqui). Trocar = 1 linha.
export const STAR_PRESET = STAR_PRESETS.solar;

export function bakeStar(color, p) {
  const key = `sun:${color}:${p.tag}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2;
  const cy = s / 2;
  const R = s / 2;
  const disc = R * p.discR;
  const core = R * p.coreR;
  // 1) cromosfera: feather na borda do disco (cor -> transparente)
  const cromo = x.createRadialGradient(cx, cy, disc * p.cromoStart, cx, cy, R);
  cromo.addColorStop(0, hexToRgba(color, p.cromoA));
  cromo.addColorStop(1, hexToRgba(color, 0));
  x.fillStyle = cromo;
  x.fillRect(0, 0, s, s);
  // 2) disco DEFINIDO: clip + gradiente quente -> cor -> limbo escuro
  x.save();
  x.beginPath();
  x.arc(cx, cy, disc, 0, TAU);
  x.clip();
  const body = x.createRadialGradient(cx, cy, 0, cx, cy, disc);
  body.addColorStop(0, mixHex(color, p.hot, 255));
  body.addColorStop(0.42, mixHex(color, p.hotMid, 255));
  body.addColorStop(0.74, color);
  body.addColorStop(0.9, mixHex(color, p.limbA, 0));
  body.addColorStop(1, mixHex(color, p.limbB, 0));
  x.fillStyle = body;
  x.fillRect(0, 0, s, s);
  // 3) granulacao: mottling claro/escuro deterministico por cor
  const rng = mulberry32(hash32(`sun:${color}`));
  for (let i = 0; i < p.gran; i += 1) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * disc * 0.94;
    const bx = cx + Math.cos(a) * rr;
    const by = cy + Math.sin(a) * rr;
    const br = disc * (0.05 + rng() * 0.13);
    const dark = rng() < 0.5;
    const g = x.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, dark ? `rgba(0,0,0,${p.granA})` : `rgba(255,255,255,${p.granA + 0.02})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(bx, by, br, 0, TAU);
    x.fill();
  }
  x.restore();
  // 4) nucleo branco-quente: brilho central aditivo
  x.globalCompositeOperation = 'lighter';
  const coreG = x.createRadialGradient(cx, cy, 0, cx, cy, core);
  coreG.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
  coreG.addColorStop(0.5, hexToRgba(color, 0.45));
  coreG.addColorStop(1, hexToRgba(color, 0));
  x.fillStyle = coreG;
  x.beginPath();
  x.arc(cx, cy, core, 0, TAU);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  spriteCache.set(key, c);
  return c;
}

export function sunSprite(color) {
  return bakeStar(color, STAR_PRESET);
}

// F3: esfera ILUMINADA (planeta) p/ o modo PLANETA (zoom-out) do drawSuns.
// Luz vem de cima-esquerda (PLANET_LIGHT_BASE); o caller rotaciona o sprite p/
// a luz apontar a Torre. Gradiente lit + terminador escuro + textura de nuvens
// (prng por cor) + especular + atmosfera Fresnel no limbo. Chave CRUA por cor.
export const PLANET_LIGHT_BASE = Math.atan2(-1, -1);
function mixHex(hex, t, toward) {
  const n = parseInt(String(hex).slice(1), 16);
  const m = (ch) => Math.round(ch + (toward - ch) * t);
  return `rgb(${m((n >> 16) & 255)}, ${m((n >> 8) & 255)}, ${m(n & 255)})`;
}
// Textura de nuvens (default, IDÊNTICA ao histórico): 10 blobs claros/escuros
// prng por cor. É o comportamento com skyArt desligado.
function texClouds(x, color, cx, cy, r) {
  const pr = mulberry32(hash32(color));
  for (let i = 0; i < 10; i += 1) {
    const bx = cx + (pr() - 0.5) * r * 1.5;
    const by = cy + (pr() - 0.5) * r * 1.5;
    const br = r * (0.16 + pr() * 0.42);
    const dark = pr() < 0.55;
    const bg = x.createRadialGradient(bx, by, 0, bx, by, br);
    bg.addColorStop(0, dark ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.12)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = bg;
    x.beginPath();
    x.arc(bx, by, br, 0, TAU);
    x.fill();
  }
}

// SYSTEM = superfície-circuito: traços finos ortogonais (tipo PCB) + pads,
// num tom mais claro da cor, alpha baixa. Deterministico por cor.
function texCircuit(x, color, cx, cy, r) {
  const pr = mulberry32(hash32(`circuit:${color}`));
  x.strokeStyle = mixHex(color, 0.55, 255);
  x.fillStyle = mixHex(color, 0.6, 255);
  x.lineWidth = 1.4;
  x.globalAlpha = 0.32;
  for (let i = 0; i < 11; i += 1) {
    let px = cx + (pr() - 0.5) * r * 1.7;
    let py = cy + (pr() - 0.5) * r * 1.7;
    x.beginPath();
    x.moveTo(px, py);
    const segs = 2 + Math.floor(pr() * 2);
    for (let j = 0; j < segs; j += 1) {
      const len = r * (0.18 + pr() * 0.4);
      if (pr() < 0.5) px += pr() < 0.5 ? len : -len;
      else py += pr() < 0.5 ? len : -len;
      x.lineTo(px, py);
    }
    x.stroke();
    x.fillRect(px - 2, py - 2, 4, 4); // pad no fim do traço
  }
  x.globalAlpha = 1;
}

// PROJECTS = luzes de cidade no lado ESCURO (bottom-right; luz vem do topo-esq).
// Pontos quentes aditivos onde (px+py) > (cx+cy) — trabalho acontecendo à noite.
function texCity(x, color, cx, cy, r) {
  const pr = mulberry32(hash32(`city:${color}`));
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i += 1) {
    const a = pr() * TAU;
    const rr = Math.sqrt(pr()) * r * 0.92;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (px - cx + (py - cy) < r * 0.12) continue; // só o lado escuro
    x.globalAlpha = 0.35 + pr() * 0.45;
    x.fillStyle = pr() < 0.7 ? '#ffd9a0' : '#fff2cf';
    const d = 0.9 + pr() * 1.4;
    x.fillRect(px - d / 2, py - d / 2, d, d);
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
}

// RESOURCES = gigante gasoso: bandas horizontais alternando tons da cor.
function texGas(x, color, cx, cy, r) {
  const pr = mulberry32(hash32(`gas:${color}`));
  const bands = 9;
  for (let i = 0; i < bands; i += 1) {
    const y0 = cy - r + (i / bands) * r * 2;
    const h = (r * 2) / bands + 1;
    const up = i % 2 === 0;
    x.fillStyle = up ? mixHex(color, 0.22, 255) : mixHex(color, 0.24, 0);
    x.globalAlpha = 0.16 + pr() * 0.1;
    x.fillRect(cx - r, y0, r * 2, h);
  }
  x.globalAlpha = 1;
}

// DAILY = terminador dia/noite NÍTIDO: meia-face escura com borda dura na
// perpendicular à luz (topo-dir -> baixo-esq). O caller rotaciona o sprite pela
// HORA REAL (dailyClockAngle), então essa linha vira o relógio dia/noite.
function texDayNight(x, color, cx, cy, r) {
  x.save();
  x.translate(cx, cy);
  x.rotate(-Math.PI / 4); // alinha a borda com a perpendicular à luz
  x.fillStyle = 'rgba(3, 5, 12, 0.5)';
  x.fillRect(-r * 1.5, 0, r * 3, r * 1.6); // metade local +y = lado noite
  x.restore();
}

function planetTexture(x, color, type, cx, cy, r) {
  if (type === 'circuit') texCircuit(x, color, cx, cy, r);
  else if (type === 'city') texCity(x, color, cx, cy, r);
  else if (type === 'gas') texGas(x, color, cx, cy, r);
  else if (type === 'daynight') texDayNight(x, color, cx, cy, r);
  else texClouds(x, color, cx, cy, r);
}

// Tipo de textura semântica por pasta PARA. Default 'clouds' (nuvens = look
// histórico). Inbox vira detritos no draw, então o tipo dela é indiferente.
export function planetArtType(group) {
  const g = String(group).toLowerCase();
  if (g.includes('system')) return 'circuit';
  if (g.includes('project')) return 'city';
  if (g.includes('resource')) return 'gas';
  if (g.includes('daily')) return 'daynight';
  return 'clouds';
}

// Esfera iluminada (planeta): gradiente lit + terminador + TEXTURA por tipo +
// especular + Fresnel. type default 'clouds' reproduz EXATAMENTE o sprite
// histórico (kill-switch skyArt='off' usa esse caminho). Baked por (cor, tipo).
export function planetSprite(color, type = 'clouds') {
  const key = `planet:${color}:${type}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const s = 200;
  const r = 80;
  const cx = s / 2;
  const cy = s / 2;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.clip();
  const g = x.createRadialGradient(cx - 34, cy - 34, 2, cx, cy, r * 1.2);
  g.addColorStop(0, mixHex(color, 0.66, 255));
  g.addColorStop(0.4, color);
  g.addColorStop(0.74, mixHex(color, 0.46, 0));
  g.addColorStop(1, mixHex(color, 0.86, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  planetTexture(x, color, type, cx, cy, r);
  x.globalCompositeOperation = 'lighter';
  const sg = x.createRadialGradient(cx - 32, cy - 32, 0, cx - 32, cy - 32, 28);
  sg.addColorStop(0, 'rgba(255,255,255,.6)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sg;
  x.beginPath();
  x.arc(cx - 32, cy - 32, 28, 0, TAU);
  x.fill();
  const fr = x.createRadialGradient(cx, cy, r * 0.78, cx, cy, r);
  fr.addColorStop(0, hexToRgba(color, 0));
  fr.addColorStop(0.78, hexToRgba(color, 0));
  fr.addColorStop(1, hexToRgba(color, 0.5));
  x.fillStyle = fr;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.fill();
  x.restore();
  spriteCache.set(key, c);
  return c;
}

// Nebulosa pre-renderizada: blobs de gradiente radial + blur aplicado UMA
// vez no bake do offscreen (nunca filter por frame). Desenhada depois com
// drawImage + globalAlpha baixa (0.05-0.09).
export function nebulaSprite(color, variant) {
  const raw = `neb:${color}:${variant}`;
  const key = themeKey(raw);
  if (spriteCache.has(key)) return spriteCache.get(key);
  const size = NEBULA_SPRITE_PX;
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext('2d');
  // Seed theme-INDEPENDENT (review fix): o layout dos blobs nao muda na
  // troca de tema -- o prefixo do tema fica so na chave de cache.
  const rng = mulberry32(hash32(raw));
  for (let i = 0; i < 5; i += 1) {
    const bx = size * (0.34 + rng() * 0.32);
    const by = size * (0.34 + rng() * 0.32);
    const br = size * (0.14 + rng() * 0.16);
    const g = tctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, hexToRgba(color, 0.45 + rng() * 0.25));
    g.addColorStop(0.55, hexToRgba(color, 0.16));
    g.addColorStop(1, hexToRgba(color, 0));
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, size, size);
  }
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(13px)';
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = 'none';
  spriteCache.set(key, c);
  return c;
}

// Raios cruzados sutis do nucleo (lens flare de 4 pontas): cada spike e um
// gradiente radial achatado por scale, tudo baked uma vez por cor.
export function raysSprite(color) {
  const key = themeKey(`rays:${color}`);
  if (spriteCache.has(key)) return spriteCache.get(key);
  const size = 256;
  const half = size / 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const spikes = [
    [0, 1],
    [Math.PI / 2, 1],
    [Math.PI / 4, 0.4],
    [-Math.PI / 4, 0.4],
  ];
  for (const [angle, strength] of spikes) {
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(angle);
    ctx.scale(1, 0.035);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, half);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.55 * strength})`);
    g.addColorStop(0.2, hexToRgba(color, 0.3 * strength));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-half, -half, size, size);
    ctx.restore();
  }
  spriteCache.set(key, c);
  return c;
}

// Nebulosas do universo: ate 4, nas cores das galaxias presentes, com
// anchor/escala/drift deterministicos (mesmo payload = mesmo ceu).
export function makeNebulas(colors, seed) {
  const list = colors && colors.length ? colors : [NEBULA_FALLBACK];
  const rng = mulberry32(seed >>> 0);
  const count = Math.min(4, Math.max(3, list.length));
  const nebulas = [];
  for (let i = 0; i < count; i += 1) {
    nebulas.push({
      sprite: nebulaSprite(list[i % list.length], i),
      u: 0.1 + rng() * 0.8,
      v: 0.1 + rng() * 0.8,
      scale: 0.72 + rng() * 0.55,
      alpha: 0.05 + rng() * 0.04,
      driftSpeed: 0.04 + rng() * 0.04,
      driftPhase: rng() * TAU,
    });
  }
  return nebulas;
}

// ------------------------------------------------------ montagem do universo

// Hubs do payload (VAULT + linhas de grupo PARA) nao viram planetas:
// as galaxias sao reconstruidas aqui com geometria propria.
export function noteRows(raw) {
  return (raw.nodes || []).filter((n) => n.id !== 'VAULT' && n.id !== n.group);
}

function orderedGroups(rows) {
  const seen = [...new Set(rows.map(groupOf))];
  const rank = (g) => {
    const i = GROUP_STYLES.findIndex((s) => String(g).toLowerCase().includes(s.key));
    return i === -1 ? 99 : i;
  };
  return seen.sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

function makeGalaxy(group, count) {
  // Q5/UI: hub (galáxia) maior por nº de notas — contraste BEM mais
  // pronunciado (antes RESOURCES~500 e TEMPLATES~1 ficavam quase iguais).
  const sunR = Math.min(7 + Math.sqrt(count) * 1.9, 32);
  const minOrbit = sunR + 16;
  // Densidade ~constante por galaxia: o coeficiente do sqrt(count) sobe (de
  // 12 para 22) e o teto sobe (de 300 para 640) para que uma galaxia com
  // 514 notas respire em vez de espremer tudo no mesmo disco de uma com 100.
  const radius = Math.min(minOrbit + 40 + Math.sqrt(count) * 22, 640);
  return {
    group,
    label: cleanGroup(group),
    color: colorForGroup(group),
    count,
    sunR,
    minOrbit,
    radius,
    // FX inbox-detritos: a galáxia 0-Inbox desenha um arco de fragmentos
    // (pátio) em vez de planeta sólido. So a flag; o draw decide.
    inbox: String(group).toLowerCase().includes('inbox'),
    // skyArt: textura semântica do planeta por pasta (baked por cor+tipo).
    // system=circuito, project=cidade, resource=gasoso, daily=dia/noite,
    // resto=nuvens. So o tipo; planetSprite baka, o draw escolhe se aplica.
    artType: planetArtType(group),
    // FX luz-atividade: preenchidos no buildGlobalUniverse a partir do
    // max(mtime) das notas da galáxia. Defaults neutros (sem boost/dim).
    lastMtime: 0,
    actGlow: 1,
    actWarm: 0,
    cx: 0,
    cy: 0,
    cz: 0, // 2.5D: galaxias coplanares por enquanto (todas em z=0)
    // Órbita ao redor da Torre (placeGalaxies seta orbitR/baseAngle; omega uniforme).
    orbitR: 0,
    baseAngle: 0,
    omega: GAL_OMEGA,
    breathe: ((hash32(group) % 1000) / 1000) * TAU,
  };
}

// FX luz-atividade: fator de brilho por recência do max(mtime) da galáxia.
// <24h esquenta (glow ate 1.3x + sopro quente 0.4..1); 7d+ esfria (0.85x);
// entre, neutro. Computado 1x no build (não muda dentro da sessão em minutos);
// o draw só aplica se o kill-switch estiver ligado. Sem mtime => neutro.
const ACT_RECENT_MS = DAY_MS; // 24h: janela quente
const ACT_STALE_MS = WEEK_MS; // 7d: além disso, esfria
const ACT_GLOW_HOT = 1.3;
const ACT_GLOW_COLD = 0.85;
function galaxyActivity(lastMtime, now) {
  if (!lastMtime) return { glow: 1, warm: 0 };
  const age = now - lastMtime;
  if (age <= ACT_RECENT_MS) {
    const f = 1 - age / ACT_RECENT_MS; // 1 agora -> 0 em 24h
    return { glow: 1 + (ACT_GLOW_HOT - 1) * f, warm: 0.4 + 0.6 * f };
  }
  if (age >= ACT_STALE_MS) return { glow: ACT_GLOW_COLD, warm: 0 };
  return { glow: 1, warm: 0 };
}

// ------------------------------------- segmentacao leve F5.9-v2 (global)

// 2o segmento do path apos o prefixo do grupo ('3-Resources/Claude
// Code/x.md' => 'Claude Code'). Nota na raiz do grupo (sem subpasta)
// devolve null: orbita uniforme normal, sem cluster.
function subgroupOf(group, id) {
  const norm = String(id || '').replace(/\\/g, '/');
  const prefix = `${group}/`;
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length);
  const cut = rest.indexOf('/');
  return cut === -1 ? null : rest.slice(0, cut);
}

// Centro do setor angular do subgrupo (deterministico por hash).
// Fallback quando o mapa de setores uniformes nao cobre o subgrupo.
function subgroupAngle(subgroup) {
  return (hash32(subgroup) / HASH_SPAN) * TAU;
}

// Setores por grupo denso: a LARGURA de cada setor e proporcional a contagem
// de notas do subgrupo (subgrupo gordo ocupa mais arco), entao o anel fica
// preenchido uniforme em vez de grumos. Cada setor guarda { start, width,
// center, count }: center alimenta o label do cluster (geometria antiga),
// start/width alimentam a distribuicao por angulo aureo proporcional das
// notas dentro do setor (ver sectorPhaseOf). Mesmo payload = mesmos setores.
function subgroupSectors(list, group) {
  const counts = new Map();
  for (const r of list) {
    const sub = subgroupOf(group, r.id);
    if (sub) counts.set(sub, (counts.get(sub) || 0) + 1);
  }
  const subs = [...counts.keys()].sort();
  const map = new Map();
  const total = subs.reduce((sum, s) => sum + counts.get(s), 0) || 1;
  let cursor = 0;
  for (const sub of subs) {
    const count = counts.get(sub);
    const width = (count / total) * TAU;
    map.set(sub, { start: cursor, width, center: cursor + width / 2, count });
    cursor += width;
  }
  return map;
}

function sectorAngleOf(subgroup, sectors) {
  const s = sectors && sectors.get(subgroup);
  return s ? s.center : subgroupAngle(subgroup);
}

// Angulo aureo de uma nota DENTRO do setor do subgrupo: distribui as notas
// igualmente pela largura do setor (proporcional a contagem) usando passo de
// angulo aureo, com jitter pequeno deterministico. iInSub = ordem da nota no
// subgrupo; sem setor mapeado (fallback) cai no centro deterministico.
function sectorPhaseOf(subgroup, sectors, iInSub, jitter) {
  const s = sectors && sectors.get(subgroup);
  if (!s) return subgroupAngle(subgroup) + jitter;
  const span = s.count > 1 ? s.width : 0;
  // frac em [0,1): passo aureo modulo 1 espalha a ordem uniformemente.
  const frac = s.count > 1 ? ((iInSub * GOLDEN_ANGLE) / TAU) % 1 : 0.5;
  return s.start + frac * span + jitter;
}

// Omega compartilhado do subgrupo (periodo 120-200s por hash): todas as
// notas do cluster giram juntas e o grumo permanece coeso.
function subgroupOmega(subgroup) {
  const frac = hash32(subgroup) / HASH_SPAN;
  return TAU / (SUB_PERIOD_MIN_S + frac * SUB_PERIOD_SPAN_S);
}

// universe.subClusters (computado 1x no build): parametros medios do
// cluster para o draw posicionar o label do subgrupo sem custo por frame
// (posicao = galaxy.cx + cos(angle0 + omega*t) * radius, mesma f(t) das
// notas). `from` = indice do 1o node do grupo em `nodes`.
function collectSubClusters(out, gal, nodes, from, sectors) {
  const acc = new Map();
  for (let i = from; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!n.subgroup) continue;
    let c = acc.get(n.subgroup);
    if (!c) {
      c = { sum: 0, count: 0 };
      acc.set(n.subgroup, c);
    }
    c.sum += n.a;
    c.count += 1;
  }
  for (const [sub, c] of acc) {
    out.push({
      galaxy: gal,
      label: String(sub).toLowerCase(),
      angle0: sectorAngleOf(sub, sectors),
      omega: subgroupOmega(sub),
      radius: c.sum / c.count,
      count: c.count,
      color: shadeColor(gal.color, hash32(sub) % SHADE_STEPS.length),
    });
  }
}

// Anel deterministico com espacamento angular PROPORCIONAL ao raio de cada
// galaxia: a galaxia gorda ocupa mais arco e a magra menos, em vez da fracao
// uniforme i/n que jogava as pequenas longe e deixava vazios. Cada galaxia
// recebe um "peso" = raio + meio-GAP; o arco e a fracao do peso no total e a
// galaxia fica no centro do seu arco. O raio do anel e o minimo que garante
// que o arco de cada galaxia comporte seu diametro+GAP (sem sobreposicao).
function placeGalaxies(galaxies) {
  const n = galaxies.length;
  if (n <= 1) return;
  const weights = galaxies.map((g) => g.radius + GALAXY_GAP / 2);
  const totalW = weights.reduce((s, w) => s + w, 0);
  // Para cada galaxia: arco = (peso/totalW)*TAU; a corda desse arco precisa
  // de pelo menos diametro+GAP. ring = max sobre i de (raio+GAP/2)/sin(arco/2).
  let ring = 0;
  for (let i = 0; i < n; i += 1) {
    const half = (weights[i] / totalW) * Math.PI; // metade do arco em rad
    const need = (galaxies[i].radius + GALAXY_GAP / 2) / Math.max(Math.sin(half), 1e-4);
    if (need > ring) ring = need;
  }
  let acc = 0;
  galaxies.forEach((gal, i) => {
    const arc = (weights[i] / totalW) * TAU;
    const ang = -Math.PI / 2 + acc + arc / 2; // centro do arco proprio
    acc += arc;
    gal.orbitR = ring;
    gal.baseAngle = ang;
    gal.cx = ring * Math.cos(ang);
    gal.cy = ring * Math.sin(ang);
  });
}

// ------------------------------- variante 'CÉU ARRUMADO' (flag localStorage)

// Céu arrumado é o DEFAULT desde 02/07 (escolhido pelo dono vendo o A/B).
// Rollback = localStorage torre.skyVariant='off' (escape hatch, remover após
// uma semana de uso). try/catch porque storage pode lançar (modo privado) ->
// cai no default arrumado.
function isTidySky() {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('torre.skyVariant') !== 'off';
  } catch (err) {
    return true;
  }
}

const TIDY_MIN_COUNT = 20; // < 20 notas: sai do anel principal, vira cinturão
const TIDY_BELT_SCALE = 0.4; // planeta do cinturão ~0.4x do tamanho atual
const TIDY_SIZE_MIN = 0.62; // clamp inferior do fator de tamanho das grandes
const TIDY_SIZE_MAX = 1.25; // clamp superior (grande destacada sem virar sol)
const TIDY_START_ANGLE = -Math.PI / 2; // 1o slot no topo (igual placeGalaxies)
const TIDY_BELT_RATIO = 0.42; // raio do cinturão = fração do anel principal
const TIDY_BELT_MIN_R = 240; // piso do cinturão: além da biblioteca (170-200)

function normAngle(a) {
  let m = a;
  while (m > Math.PI) m -= TAU;
  while (m < -Math.PI) m += TAU;
  return m;
}

// Aplica órbita circular (raio + ângulo-base) numa galáxia. A omega uniforme
// (GAL_OMEGA, setada no makeGalaxy) fica intacta: só o ângulo-base/raio mudam,
// então a revolução do anel segue idêntica -- apenas a distribuição muda.
function setGalaxyOrbit(gal, ring, angle) {
  gal.orbitR = ring;
  gal.baseAngle = angle;
  gal.cx = ring * Math.cos(angle);
  gal.cy = ring * Math.sin(angle);
}

// Raio do anel que garante que cada galáxia da lista caiba no seu slot de
// passo IGUAL (numSlots fatias de TAU) sem sobrepor a vizinha: mesma lógica do
// placeGalaxies, com meio-passo fixo (Math.PI/numSlots) em vez de proporcional.
function tidyRingRadius(list, numSlots) {
  if (!list.length || numSlots <= 1) return 0;
  const half = Math.PI / numSlots; // metade do passo angular igual
  let ring = 0;
  for (const g of list) {
    const need = (g.radius + GALAXY_GAP / 2) / Math.max(Math.sin(half), 1e-4);
    if (need > ring) ring = need;
  }
  return ring;
}

// Cinturão interno: galáxias pequenas num anel mais próximo do centro (fração
// do anel principal, piso além da biblioteca e teto dentro do anel grande),
// passo angular igual entre si. Marca gal.belt -> o draw esconde o label fixo
// (só hover/tooltip). As notas seguem orbitando o centro da galáxia no mergulho.
// Interleave: o start é offsetado meio-passo (step/2) para o cinturão não nascer
// alinhado com o topo do anel principal e sentar nos vãos entre as grandes.
function placeTidyBelt(belt, mainRing) {
  if (!belt.length) return;
  const ratioRing = TIDY_BELT_RATIO * mainRing;
  const clearRing = tidyRingRadius(belt, belt.length);
  const ceil = Math.max(mainRing * 0.8, TIDY_BELT_MIN_R);
  const ring = clamp(Math.max(ratioRing, clearRing), TIDY_BELT_MIN_R, ceil);
  const step = TAU / belt.length;
  belt.forEach((gal, i) => {
    gal.belt = true;
    setGalaxyOrbit(gal, ring, TIDY_START_ANGLE + step / 2 + i * step);
  });
}

// Tamanho visual do planeta: grandes proporcionais a sqrt(count) normalizado no
// range das grandes (clamp [0.62, 1.25]); cinturão fixo em 0.4x. Escala
// gal.sunR (fonte única lida pelo draw E pelo pick do engine -> visual e alvo
// de clique coerentes). minOrbit/radius já foram fixados no makeGalaxy, então o
// disco de notas do mergulho não muda.
function applyTidySizes(big, belt) {
  const sqrts = big.map((g) => Math.sqrt(g.count));
  const lo = sqrts.length ? Math.min(...sqrts) : 0;
  const hi = sqrts.length ? Math.max(...sqrts) : 0;
  const span = hi - lo;
  for (const gal of big) {
    const norm = span > 0 ? (Math.sqrt(gal.count) - lo) / span : 1;
    gal.sunR *= TIDY_SIZE_MIN + norm * (TIDY_SIZE_MAX - TIDY_SIZE_MIN);
  }
  for (const gal of belt) gal.sunR *= TIDY_BELT_SCALE;
}

// Arruma o céu: galáxias GRANDES (>= 20 notas) em passos angulares IGUAIS na
// ordem PARA (galaxies já vem ordenada), reservando +1 slot para a DOCA;
// pequenas viram cinturão interno; tamanhos por count. Devolve o ângulo-base
// reservado da doca (o slot que sobra no anel principal).
function placeGalaxiesTidy(galaxies) {
  const big = galaxies.filter((g) => g.count >= TIDY_MIN_COUNT);
  const belt = galaxies.filter((g) => g.count < TIDY_MIN_COUNT);
  if (!big.length) {
    // Sem galáxias grandes (vault degenerado): todas no anel principal com
    // passo igual (+ slot da doca) e tamanho do cinturão. Sem distinção de anel.
    const numSlots = galaxies.length + 1;
    const ring = tidyRingRadius(galaxies, numSlots);
    const step = TAU / numSlots;
    galaxies.forEach((gal, i) => setGalaxyOrbit(gal, ring, TIDY_START_ANGLE + i * step));
    for (const gal of galaxies) gal.sunR *= TIDY_BELT_SCALE;
    return normAngle(TIDY_START_ANGLE + galaxies.length * step);
  }
  const numSlots = big.length + 1; // +1 slot reservado da DOCA no anel
  const mainRing = tidyRingRadius(big, numSlots);
  const step = TAU / numSlots;
  big.forEach((gal, i) => setGalaxyOrbit(gal, mainRing, TIDY_START_ANGLE + i * step));
  placeTidyBelt(belt, mainRing);
  applyTidySizes(big, belt);
  return normAngle(TIDY_START_ANGLE + big.length * step); // último slot = doca
}

// Raio da doca na variante 'tidy': mesma fórmula do computeDockSpot (60px além
// da borda externa das galáxias grandes); só o ÂNGULO vem do slot reservado.
function tidyDockRadius(ringR, maxR) {
  const outer = ringR > 0 ? ringR + maxR : maxR;
  return Math.max(220, outer + 60);
}

function sizeRange(rows) {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const s = Number(r.size) || 1;
    if (s < min) min = s;
    if (s > max) max = s;
  }
  return { min, max };
}

// Planeta: posicao deterministica preenchendo o disco da galaxia.
// Angulo: distribuicao por angulo aureo (filotaxia) — phase = i*GOLDEN_ANGLE
// + jitter pequeno — em vez de rng puro, que gerava grumos e vazios. Raio:
// densidade UNIFORME no disco via r = sqrt(rng())*(radius-minOrbit)+minOrbit
// (a raiz quadrada compensa a area do anel), com vies leve de 15% pra dentro
// para notas muito conectadas. Periodo lento 90-240s.
// F5.9-v2: nota com subgroup (so em grupo denso) clusteriza no setor angular
// do subgrupo (largura proporcional a contagem), distribuida por angulo
// aureo proporcional dentro do setor — orient 0 para a posicao ser real,
// omega compartilhado e shade sutil da cor do grupo.
// idx = { i, total, iInSub }: i = ordem global no grupo (angulo aureo),
// iInSub = ordem no subgrupo (angulo aureo dentro do setor).
function makeNote(row, gal, range, now, subgroup, sectors, idx) {
  const rng = mulberry32(hash32(row.id));
  const span = range.max - range.min;
  const conn = span > 0 ? ((Number(row.size) || 1) - range.min) / span : 0.5;
  const jitter = (rng() - 0.5) * 2 * ANGLE_JITTER_RAD;
  // sqrt-uniform: densidade constante em area; vies leve por backlink.
  const reach = gal.radius - gal.minOrbit;
  const uniformR = Math.sqrt(rng()) * reach + gal.minOrbit;
  const orbitR = Math.max(gal.minOrbit, uniformR - conn * CONN_PULL_IN * reach);
  const ecc = rng() * 0.12;
  const orient = subgroup ? 0 : rng() * TAU;
  const omega = subgroup
    ? subgroupOmega(subgroup)
    : TAU / (ORBIT_MIN_S + rng() * ORBIT_SPAN_S);
  const phase = subgroup
    ? sectorPhaseOf(subgroup, sectors, idx.iInSub, jitter)
    : idx.i * GOLDEN_ANGLE + jitter;
  const mtime = Number(row.mtimeMs) || 0;
  // 2.5D: profundidade pseudo-3D por nota. zoff vem de um hash SEPARADO do
  // id (':z') para NAO perturbar a ordem do rng() acima (orbita/cor/fase
  // ficam identicas ao 2D); centrado em 0 e proporcional ao orbitR local
  // (notas distantes do sol ganham mais volume). pz = profundidade efetiva
  // por frame (cz da galaxia + zoff), preenchida pelo updatePositions.
  const zoff = ((hash32(`${row.id}:z`) / HASH_SPAN) - 0.5) * 2 * orbitR * 0.6;
  return {
    id: row.id,
    label: row.label || baseName(row.id),
    group: groupOf(row),
    subgroup: subgroup || null,
    mtimeMs: mtime,
    kind: 'note',
    color: subgroup ? shadeColor(gal.color, hash32(subgroup) % SHADE_STEPS.length) : gal.color,
    r: noteWorldRadius(row.size),
    tier: brightnessTier(mtime, now),
    galaxy: gal,
    a: orbitR,
    b: orbitR * (1 - ecc),
    omega,
    phase,
    cosO: Math.cos(orient),
    sinO: Math.sin(orient),
    pulsePhase: rng() * TAU,
    zoff,
    pz: 0,
    px: 0,
    py: 0,
  };
}

// l.same = mesma galaxia (constelacao intra-galaxia, geometria F4).
function resolveLinks(rawLinks, nodeById) {
  const links = [];
  for (const l of rawLinks || []) {
    const a = nodeById.get(l.source);
    const b = nodeById.get(l.target);
    if (!a || !b || a === b) continue;
    links.push({ a, b, same: a.galaxy === b.galaxy && a.group === b.group });
  }
  return links;
}

function buildAdjacency(links) {
  const adj = new Map();
  const push = (id, l) => {
    if (!adj.has(id)) adj.set(id, []);
    adj.get(id).push(l);
  };
  for (const l of links) {
    push(l.a.id, l);
    push(l.b.id, l);
  }
  return adj;
}

// ------------------------------------------------- estacoes MCP (F5.8)

// Satelite de servico: 2 aneis intercalados por indice (78-104 / 124-152)
// ao redor da estacao em (0,0). Review fix F7: fase em SLOTS ANGULARES
// uniformes por anel (hash puro clumpava 2-3 satelites num crescente e
// esvaziava o resto do hub) com jitter deterministico de ate 30% do slot;
// anel externo offsetado meio-slot para intercalar com o interno. px/py
// preenchidos pelo updatePositions do engine (px = cos(phase+omega*t)*a).
function makeStation(mcp, index, total) {
  const id = `mcp:${mcp.id}`;
  const rng = mulberry32(hash32(id));
  const inner = index % 2 === 0;
  const ringBase = inner ? STATION_RING_INNER : STATION_RING_OUTER;
  const ringSpan = inner ? STATION_RING_INNER_SPAN : STATION_RING_OUTER_SPAN;
  const slots = Math.max(1, inner ? Math.ceil(total / 2) : Math.floor(total / 2));
  const slot = Math.floor(index / 2);
  const jitter = (hash32(id) / HASH_SPAN - 0.5) * (TAU / slots) * 0.3;
  return {
    id,
    label: String(mcp.label || mcp.id),
    color: SERVICE_PALETTE[hash32(String(mcp.id)) % SERVICE_PALETTE.length],
    kind: 'mcp',
    r: STATION_R,
    a: ringBase + rng() * ringSpan,
    omega: inner ? STATION_OMEGA_INNER : STATION_OMEGA_OUTER,
    phase: (slot / slots) * TAU + (inner ? 0 : TAU / (slots * 2)) + jitter,
    blinkPhase: rng() * TAU,
    px: 0,
    py: 0,
    count: Number(mcp.count) || 0,
    lastUsedTs: Number(mcp.lastUsedTs) || 0,
  };
}

// ------------------------------------------------- biblioteca de skills (F7)

// Livro: skill de /api/skills orbitando em anel circular 170-200 entre os
// satelites MCP e as galaxias; shade sutil de violeta por hash do id.
// px/py preenchidos pelo updatePositions do engine (mesma f(t) das stations).
function makeBook(skill) {
  const id = `skill:${skill.id}`;
  const rng = mulberry32(hash32(id));
  return {
    id,
    label: String(skill.name || skill.id),
    color: shadeColor(BOOK_VIOLET, hash32(String(skill.id)) % SHADE_STEPS.length),
    kind: 'skill',
    r: BOOK_R,
    a: BOOK_RING_INNER + rng() * BOOK_RING_SPAN,
    omega: TAU / (BOOK_PERIOD_MIN_S + rng() * BOOK_PERIOD_SPAN_S),
    phase: rng() * TAU,
    bobPhase: rng() * TAU,
    px: 0,
    py: 0,
    usedCount: Number(skill.usedCount) || 0,
    lastUsedTs: Number(skill.lastUsedTs) || 0,
  };
}

// Cap de 12 livros por usedCount desc (desempate por nome, deterministico).
// Guards identicos aos das stations: payload de skills invalido degrada
// para biblioteca vazia — o universo nunca quebra por /api/skills.
function buildBooks(skills) {
  if (!Array.isArray(skills)) return [];
  const seen = new Set();
  const valid = [];
  for (const s of skills) {
    if (!s || typeof s !== 'object' || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    valid.push(s);
  }
  valid.sort((a, b) => (Number(b.usedCount) || 0) - (Number(a.usedCount) || 0)
    || String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return valid.slice(0, BOOK_CAP).map((s) => makeBook(s));
}

// C: estacao 'web' sintetica -- destino fixo das acoes WebSearch/WebFetch
// (que nao tem vaultPath nem MCP server, entao nao tinham 'aonde' no mapa).
// id 'mcp:web' para resolver pelo MESMO caminho stationById/resolveNode dos
// satelites MCP (resolveNode so consulta stationById em ids 'mcp:*'); cor
// cyan, SEMPRE presente. FORA das galaxias: orbita num anel alem do ring
// galactico (outerR = ringR + maxR), nunca sobre uma galaxia.
const WEB_STATION_MARGIN = 18; // folga alem da borda externa das galaxias (perto, nao perdida no vacuo)
const WEB_STATION_FALLBACK = STATION_RING_OUTER + STATION_RING_OUTER_SPAN + 10;
function makeWebStation(outerR) {
  const base = Number.isFinite(outerR) && outerR > 0 ? outerR : WEB_STATION_FALLBACK;
  return {
    id: 'mcp:web',
    label: 'web',
    color: '#4dd0e1',
    kind: 'web',
    r: STATION_R + 2, // UI: mais presenca (nao some no vacuo)
    a: base + WEB_STATION_MARGIN,
    omega: -TAU / 300, // deriva lenta no anel externo (volta em ~300s)
    phase: -Math.PI / 2, // nasce no topo
    blinkPhase: 0,
    px: 0,
    py: 0,
    count: 0,
    lastUsedTs: 0,
  };
}

// Cap de 16 estacoes por count desc (desempate por id, deterministico).
// outerR (raio da borda externa das galaxias) posiciona a estacao 'web' alem
// do ring galactico. Guards: mcps null/nao-array, entrada sem id ou id
// duplicado degradam para a 'web' sozinha - o universo nunca quebra.
function buildStations(mcps, outerR) {
  if (!Array.isArray(mcps)) return [makeWebStation(outerR)];
  const seen = new Set();
  const valid = [];
  for (const m of mcps) {
    if (!m || typeof m !== 'object' || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    valid.push(m);
  }
  valid.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0)
    || String(a.id).localeCompare(String(b.id)));
  const top = valid.slice(0, STATION_CAP);
  const stations = top.map((m, i) => makeStation(m, i, top.length));
  stations.push(makeWebStation(outerR)); // C: web fora das galaxias, fora do cap MCP
  return stations;
}

// Notas de um grupo: grupo denso (count > SPLIT_MAX) marca subgroup por
// nota e registra os subClusters; os demais ficam num disco preenchido por
// angulo aureo. idx.i = ordem global no grupo (angulo aureo); iInSub =
// contador por subgrupo (angulo aureo dentro do setor proporcional).
function pushGroupNotes(nodes, subClusters, gal, list, now) {
  const range = sizeRange(list);
  const dense = list.length > SPLIT_MAX;
  const from = nodes.length;
  const sectors = dense ? subgroupSectors(list, gal.group) : null;
  const total = list.length;
  const subCounters = new Map();
  list.forEach((row, i) => {
    const subgroup = dense ? subgroupOf(gal.group, row.id) : null;
    const iInSub = subgroup ? (subCounters.get(subgroup) || 0) : 0;
    if (subgroup) subCounters.set(subgroup, iInSub + 1);
    nodes.push(makeNote(row, gal, range, now, subgroup, sectors, { i, total, iInSub }));
  });
  if (dense) collectSubClusters(subClusters, gal, nodes, from, sectors);
}

// mcps (2o parametro opcional, F5.8): [{ id, label, count, lastUsedTs }]
// vindo de /api/mcp; null/ausente => sem estacoes e beacon null.
// skills (3o parametro opcional, F7): [{ id, name, usedCount, lastUsedTs }]
// vindo de /api/skills; null/ausente => biblioteca vazia, nunca quebra.
// F5.9-v2: UMA galaxia por grupo PARA raiz (anel/sois/geometria do F4);
// a segmentacao acontece por dentro, via subgroup + subClusters.
// F5b: spot BASE da DOCA — estrela de 1a classe que REVOLVE com o anel. ALEM de
// todas as galaxias (como a estacao web) -> isolada por construcao, nunca colada
// num projeto. O angulo base e o centro do MAIOR vao angular entre galaxias; como
// a doca gira na MESMA omega (GAL_OMEGA, ver buildGlobalUniverse/updatePositions),
// ela fica TRAVADA nesse vao para sempre (sem colidir com galaxia). Sem o vies de
// visibilidade do F-DOCA estatico: revolvendo, ela cruza todos os angulos — como
// as galaxias ja cruzam — entao o vies (que a prendia no topo) nao faz mais sentido.
const DOCK_FALLBACK_ANGLE = -Math.PI / 2 - 0.5; // base p/ universo degenerado (0/1 galaxia)
function computeDockSpot(galaxies, ringR, maxR) {
  const outer = galaxies.length && ringR > 0 ? ringR + maxR : maxR;
  const radius = Math.max(220, outer + 60); // 60px ALEM da borda externa das galaxias
  if (!galaxies.length || ringR <= 0) return { angle: DOCK_FALLBACK_ANGLE, radius };
  const angs = galaxies.map((g) => Math.atan2(g.cy, g.cx)).sort((a, b) => a - b);
  let bestGap = -1;
  let angle = DOCK_FALLBACK_ANGLE;
  for (let i = 0; i < angs.length; i += 1) {
    const a = angs[i];
    const next = i === angs.length - 1 ? angs[0] + TAU : angs[i + 1];
    const gap = next - a;
    if (gap > bestGap) {
      bestGap = gap;
      angle = a + gap / 2;
    }
  }
  let m = angle;
  while (m > Math.PI) m -= TAU;
  while (m < -Math.PI) m += TAU;
  return { angle: m, radius };
}

export function buildGlobalUniverse(raw, mcps, skills) {
  const rows = noteRows(raw);
  const groups = orderedGroups(rows);
  const byGroup = new Map(groups.map((g) => [g, []]));
  for (const row of rows) byGroup.get(groupOf(row)).push(row);
  const galaxies = groups.map((g) => makeGalaxy(g, byGroup.get(g).length));
  // Variante 'CÉU ARRUMADO' (flag localStorage 'torre.skyVariant'): anel de
  // passos iguais + cinturão interno + tamanho por count. Sem a flag, o
  // placeGalaxies original roda intacto (baseline idêntico).
  const tidy = isTidySky();
  let tidyDockAngle = null;
  if (tidy) tidyDockAngle = placeGalaxiesTidy(galaxies);
  else placeGalaxies(galaxies);
  const galByGroup = new Map(galaxies.map((g) => [g.group, g]));
  const now = Date.now();
  const nodes = [];
  const subClusters = [];
  for (const g of groups) {
    pushGroupNotes(nodes, subClusters, galByGroup.get(g), byGroup.get(g), now);
  }
  // FX luz-atividade: max(mtime) por galáxia -> fator de brilho por recência.
  for (const g of groups) {
    const gal = galByGroup.get(g);
    let mx = 0;
    for (const r of byGroup.get(g)) {
      const m = Number(r.mtimeMs) || 0;
      if (m > mx) mx = m;
    }
    gal.lastMtime = mx;
    const a = galaxyActivity(mx, now);
    gal.actGlow = a.glow;
    gal.actWarm = a.warm;
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const links = resolveLinks(raw.links, nodeById);
  const maxR = galaxies.reduce((m, g) => Math.max(m, g.radius), 0);
  // No tidy as galáxias têm orbitR distintos (anel principal vs cinturão);
  // o ringR de referência (doca/estação-web/extent) é o anel principal = maior
  // orbitR. Sem tidy, todas compartilham o mesmo orbitR, então o max coincide
  // com o hypot da 1a galáxia (valor idêntico ao legado).
  const ringR = tidy
    ? galaxies.reduce((m, g) => Math.max(m, g.orbitR || 0), 0)
    : (galaxies.length > 1 ? Math.hypot(galaxies[0].cx, galaxies[0].cy) : 0);
  const nebColors = [...galaxies]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((g) => g.color);
  const stations = buildStations(mcps, ringR + maxR); // C: web alem do ring galactico
  const books = buildBooks(skills);
  // Doca: no tidy fica no slot reservado do anel (mesmo raio-fórmula do
  // computeDockSpot, só o ângulo é o slot que sobra); senão, no maior vão.
  const dock = tidy
    ? { angle: tidyDockAngle ?? DOCK_FALLBACK_ANGLE, radius: tidyDockRadius(ringR, maxR) }
    : computeDockSpot(galaxies, ringR, maxR); // FB: spot da doca no maior vao
  return {
    mode: 'global',
    galaxies,
    nodes,
    nodeById,
    links,
    adjacency: buildAdjacency(links),
    nebulas: makeNebulas(nebColors, STAR_SEED + 1),
    extent: ringR + maxR + 70, // banda externa p/ a DOCA caber na vista (apertado: menos vacuo morto)
    // F5b: dockAngle e a posicao VIVA (updatePositions revolve por frame); inicia
    // no vao (base). dockBaseAngle + dockOmega=GAL_OMEGA fazem a doca girar com o
    // anel, travada no vao. dockR (raio do anel da doca) e constante.
    dockAngle: dock.angle,
    dockR: dock.radius,
    dockBaseAngle: dock.angle,
    dockOmega: GAL_OMEGA,
    subClusters,
    stations,
    stationById: new Map(stations.map((s) => [s.id, s])),
    beacon: stations.length ? { px: 0, py: 0, pz: 0 } : null,
    books,
    bookById: new Map(books.map((b) => [b.id, b])),
  };
}

function bfsDepths(rows, rawLinks, centerId) {
  const adj = new Map(rows.map((n) => [n.id, []]));
  for (const l of rawLinks) {
    if (adj.has(l.source) && adj.has(l.target)) {
      adj.get(l.source).push(l.target);
      adj.get(l.target).push(l.source);
    }
  }
  const depths = new Map([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of adj.get(id) || []) {
      if (!depths.has(next)) {
        depths.set(next, depths.get(id) + 1);
        queue.push(next);
      }
    }
  }
  return depths;
}

// Modo local: a nota aberta vira o sol central; vizinhos orbitam em aneis
// por profundidade, mantendo a cor da pasta de origem de cada um.
function makeLocalNode(row, depth, centerPath, now) {
  const rng = mulberry32(hash32(row.id));
  const isCenter = row.id === centerPath;
  const ringBase = isCenter
    ? 0
    : LOCAL_RINGS[Math.min(depth, 2)] + Math.max(depth - 2, 0) * 80;
  const orbitR = isCenter ? 0 : Math.max(46, ringBase + (rng() - 0.5) * 46);
  const ecc = rng() * 0.1;
  const period = (ORBIT_MIN_S + rng() * ORBIT_SPAN_S) * (depth >= 2 ? 1.6 : 1);
  const orient = rng() * TAU;
  const mtime = Number(row.mtimeMs) || 0;
  return {
    id: row.id,
    label: row.label || baseName(row.id),
    group: groupOf(row),
    subgroup: null, // F5.9-v2 e so global; shape do node fica uniforme
    mtimeMs: mtime,
    kind: isCenter ? 'center' : 'note',
    color: colorForGroup(row.group),
    r: isCenter ? 15 : noteWorldRadius(row.size),
    tier: brightnessTier(mtime, now),
    galaxy: ORIGIN_GALAXY,
    a: orbitR,
    b: orbitR * (1 - ecc),
    omega: isCenter ? 0 : TAU / period,
    phase: rng() * TAU,
    cosO: Math.cos(orient),
    sinO: Math.sin(orient),
    pulsePhase: rng() * TAU,
    zoff: 0, // local view fica plano (sem volume pseudo-3D)
    pz: 0,
    px: 0,
    py: 0,
  };
}

export function buildLocalUniverse(raw, centerPath) {
  const rows = noteRows(raw);
  const depths = bfsDepths(rows, raw.links || [], centerPath);
  const now = Date.now();
  const nodes = rows.map((row) => makeLocalNode(row, depths.get(row.id) ?? 2, centerPath, now));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const links = resolveLinks(raw.links, nodeById);
  const nebColors = [...new Set(nodes.map((n) => n.color))].slice(0, 4);
  return {
    mode: 'local',
    galaxies: [],
    nodes,
    nodeById,
    links,
    adjacency: buildAdjacency(links),
    nebulas: makeNebulas(nebColors, STAR_SEED + 2),
    extent: LOCAL_RINGS[2] + 120,
    // F5.8/F5.9-v2/F7 sao so global: local sem estacoes, livros ou clusters.
    subClusters: [],
    stations: [],
    stationById: new Map(),
    beacon: null,
    books: [],
    bookById: new Map(),
  };
}

// -------------------------------------------------------- starfield estatico

function starLayer(rng, count, rMin, rMax, aMin, aMax) {
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      u: rng(),
      v: rng(),
      r: rMin + rng() * (rMax - rMin),
      alpha: aMin + rng() * (aMax - aMin),
      twSpeed: rng() < 0.4 ? 0.6 + rng() * 1.6 : 0,
      twPhase: rng() * TAU,
    });
  }
  return stars;
}

// Poeira estelar: graos sub-pixel de alpha baixa com deriva lentissima.
function dustLayer(rng, count) {
  const grains = [];
  for (let i = 0; i < count; i += 1) {
    grains.push({
      u: rng(),
      v: rng(),
      r: 0.5 + rng() * 0.25,
      alpha: 0.03 + rng() * 0.06,
      drift: 0.8 + rng() * 1.8,
    });
  }
  return grains;
}

// 3 camadas de profundidade (parallax crescente no draw) + poeira.
export function makeStarfield() {
  const rng = mulberry32(STAR_SEED);
  return {
    far: starLayer(rng, STARS_FAR, 0.5, 1, 0.1, 0.3),
    mid: starLayer(rng, STARS_MID, 0.8, 1.4, 0.16, 0.4),
    near: starLayer(rng, STARS_NEAR, 1.1, 2, 0.22, 0.55),
    dust: dustLayer(rng, DUST_COUNT),
  };
}
