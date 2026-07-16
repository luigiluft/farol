// FAROL - graph-fx.js: 4 animações de DADO REAL do universo (nunca
// decoração). DEFAULT LIGADO, independente da variante 'tidy'; kill-switch
// único localStorage torre.skyFx='off' desliga as 4. Regra dura de perf: só
// transform/alpha/composite por frame; todo gradiente é BAKED em sprite uma
// vez (cache local por cor). Consumido por graph-draw.js (chama nos pontos
// certos do drawFrame). eng.fleet é READ-ONLY (nunca muta o modelo da frota).
//
// 1. ANEL-SATURNO: galáxia com nave de sessão ATIVA pousada nela ganha anel
//    fino inclinado na cor da sessão (gira devagar). Sai quando a nave sai.
// 2. LUZ-ATIVIDADE: galáxia com nota editada <24h brilha mais quente; sem
//    atividade 7d+ escurece. Fator vem do modelo (gal.actGlow/actWarm).
// 3. COMETA: refresh do grafo trazendo nota nova/mais recente dispara um
//    cometa da Torre (0,0) até a galáxia destino (~2s) + estouro na chegada.
// 4. INBOX-DETRITOS: 0-Inbox vira arco de fragmentos irregulares (pátio) em
//    vez de planeta sólido; quantidade ∝ count, cap visual 24.
import { TAU, clamp, hash32, mulberry32, haloSprite, hexToRgba } from './graph-universe.js';
import { project } from './graph-engine.js';

// Sopro quente da luz-atividade (halo aditivo baked por esta cor).
const FX_WARM = '#ffe6b0';
// Cometa: duração do voo e do estouro de chegada.
const COMET_FLIGHT_MS = 2000;
const COMET_BURST_MS = 620;
const COMET_MAX_INFLIGHT = 3;
const COMET_TAIL = 6; // pontos de cauda (baked, alpha decrescente)
const COMET_ENQUEUE_CAP = 8; // teto de galáxias enfileiradas por detecção
// Inbox: fragmentos do pátio.
const DEBRIS_CAP = 24;
const DEBRIS_ARC = Math.PI * 1.15; // abertura do arco de detritos
const DEBRIS_SPIN = 0.06; // rad/s: deriva lentíssima do pátio

// ---------------------------------------------------------------- kill-switch

// Default LIGADO: só 'off' desliga. try/catch porque storage pode lançar
// (modo privado/sandbox) — nesse caso mantém ligado (default).
function skyFxValue() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('torre.skyFx') : null;
  } catch (err) {
    return null;
  }
}
export function isSkyFxOn() {
  return skyFxValue() !== 'off';
}
function isSkyFxDebug() {
  return skyFxValue() === 'debug';
}

// -------------------------------------------------------------- cache sprites

const fxSprites = new Map();

// Anel de Saturno baked por cor: annulus com gradiente radial (baked) + um arco
// claro pra a rotação ficar VISÍVEL (anel simétrico girando não mostraria
// movimento). Desenhado depois com scale-Y (inclinação) + rotate (precessão).
function saturnRingSprite(color) {
  const key = `sat:${color}`;
  if (fxSprites.has(key)) return fxSprites.get(key);
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2;
  const rO = 60;
  const rI = 44;
  x.beginPath();
  x.arc(cx, cx, rO, 0, TAU);
  x.arc(cx, cx, rI, 0, TAU, true);
  const g = x.createRadialGradient(cx, cx, rI, cx, cx, rO);
  g.addColorStop(0, hexToRgba(color, 0.12));
  g.addColorStop(0.5, hexToRgba(color, 0.6));
  g.addColorStop(1, hexToRgba(color, 0));
  x.fillStyle = g;
  x.fill('evenodd');
  x.beginPath();
  x.arc(cx, cx, (rO + rI) / 2, -0.6, 0.6);
  x.lineWidth = (rO - rI) * 0.72;
  x.strokeStyle = hexToRgba('#ffffff', 0.32);
  x.stroke();
  fxSprites.set(key, c);
  return c;
}

// Fragmento irregular do pátio (asteroide): blob com bossas claras/escuras
// deterministicas por variante. Baked uma vez por cor+variante.
function rockSprite(color, variant) {
  const key = `rock:${color}:${variant}`;
  if (fxSprites.has(key)) return fxSprites.get(key);
  const s = 40;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2;
  const r = 13;
  const rng = mulberry32(hash32(key));
  x.save();
  x.beginPath();
  const pts = 9;
  for (let i = 0; i <= pts; i += 1) {
    const a = (i / pts) * TAU;
    const rr = r * (0.72 + rng() * 0.5); // borda irregular
    const px = cx + Math.cos(a) * rr;
    const py = cx + Math.sin(a) * rr;
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
  x.clip();
  // Tom de rocha (não faísca): brilho de canto sutil + corpo na cor + limbo
  // escuro pra ler como detrito/entulho, não como estrela.
  const g = x.createRadialGradient(cx - 4, cx - 4, 1, cx, cx, r * 1.3);
  g.addColorStop(0, hexToRgba('#ffffff', 0.22));
  g.addColorStop(0.35, color);
  g.addColorStop(1, hexToRgba('#000000', 0.62));
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  x.restore();
  fxSprites.set(key, c);
  return c;
}

// ------------------------------------------------- 1. ANEL-SATURNO (WIP)

// Nave ATIVA pousada (não docada, não sumindo) dentro do disco da galáxia.
// eng.fleet é READ-ONLY: só lê ship.state/parked/gone/x/y/color. Sem link
// direto nave->galáxia no modelo, então derivo por proximidade do centro
// (dist < gal.radius), como combinado.
export function activeShipOnGalaxy(eng, gal) {
  const ships = eng.fleet && eng.fleet.ships;
  if (!ships || !ships.size) return null;
  let best = null;
  let bestD = gal.radius;
  for (const s of ships.values()) {
    if (s.gone || s.parked || s.state !== 'ativa') continue;
    const d = Math.hypot(s.x - gal.cx, s.y - gal.cy);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function drawSaturnRings(eng) {
  if (!eng._skyFx || eng.universe.mode !== 'global') return;
  const { ctx, dpr } = eng;
  const boost = 1 + (1 - (eng._noteLOD ?? 1)) * 1.5; // acompanha o planeta no zoom-out
  const t = eng.time; // relógio das órbitas: congela com reduced-motion
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const gal of eng.universe.galaxies) {
    const ship = activeShipOnGalaxy(eng, gal);
    if (!ship) continue;
    const p = project(eng, gal.cx, gal.cy, gal.cz || 0);
    const rad = gal.sunR * boost * 2.2 * p.scale;
    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.rotate(t * 0.25 + gal.breathe); // precessão lenta -> giro visível
    ctx.scale(1, 0.42); // inclinação
    ctx.globalAlpha = 0.5;
    ctx.drawImage(saturnRingSprite(ship.color), -rad, -rad, rad * 2, rad * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ------------------------------------------------- 4. INBOX-DETRITOS

// Arco de fragmentos irregulares onde estaria o planeta do 0-Inbox. Chamado
// pelo drawSuns em planetMode quando gal.inbox && eng._skyFx. baseR = raio do
// planeta em px de tela (sr*p.scale). Posições deterministicas por hash, o arco
// inteiro deriva lentíssimo (transform). Notas dentro seguem no mergulho normal.
export function drawDebrisBelt(eng, p, baseR, gal, dim) {
  const { ctx } = eng;
  const count = Math.min(Math.max(Number(gal.count) || 0, 1), DEBRIS_CAP);
  const rng = mulberry32(hash32(`debris:${gal.group}`));
  const spin = eng.time * DEBRIS_SPIN; // congela com reduced-motion
  const arcStart = -DEBRIS_ARC / 2 - Math.PI / 2; // centrado no topo
  ctx.globalAlpha = dim;
  for (let i = 0; i < count; i += 1) {
    const frac = count > 1 ? i / (count - 1) : 0.5;
    const a = arcStart + frac * DEBRIS_ARC + (rng() - 0.5) * 0.28 + spin;
    const rr = baseR * (0.55 + rng() * 1.05);
    const fx = p.sx + Math.cos(a) * rr;
    const fy = p.sy + Math.sin(a) * rr * 0.7; // arco levemente achatado
    const size = baseR * (0.16 + rng() * 0.16);
    ctx.drawImage(rockSprite(gal.color, i % 5), fx - size, fy - size, size * 2, size * 2);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------- 3. COMETA (nota nova)

// Cache CROSS-BUILD (módulo, sobrevive à recriação do engine): id -> mtimeMs
// visto. null = nunca populado (primeiro build fica SILENCIOSO: sem chuva de
// cometas no boot). Diff puro exportado pro bench.
let seenMtimes = null;

export function freshNoteIds(seen, nodes) {
  const out = [];
  for (const n of nodes) {
    const prev = seen.get(n.id);
    if (prev === undefined || (Number(n.mtimeMs) || 0) > prev) out.push(n.id);
  }
  return out;
}

// Detecta notas novas/mais recentes desde o build anterior e enfileira 1 cometa
// por GALÁXIA destino (dedupe). Atualiza o cache. Primeiro build: só popula.
function detectFreshComets(eng) {
  const nodes = eng.universe.nodes;
  if (seenMtimes === null) {
    seenMtimes = new Map();
    for (const n of nodes) seenMtimes.set(n.id, Number(n.mtimeMs) || 0);
    return;
  }
  const galaxies = new Set();
  for (const n of nodes) {
    const prev = seenMtimes.get(n.id);
    const mt = Number(n.mtimeMs) || 0;
    if (prev === undefined || mt > prev) {
      if (n.galaxy && Number.isFinite(n.galaxy.cx)) galaxies.add(n.galaxy);
    }
    seenMtimes.set(n.id, mt);
  }
  let enq = 0;
  for (const gal of galaxies) {
    if (enq >= COMET_ENQUEUE_CAP) break;
    eng._cometQ.push(gal);
    enq += 1;
  }
}

function makeComet(gal, now) {
  return { gal, start: now, color: gal.color, burst: false };
}

// Inicializa o estado de FX do engine (1x) e roda a detecção de cometas do
// build corrente. Em modo debug expõe window.__torreFxSpawnComet pro QA capturar
// um cometa em voo (off em prod: só com torre.skyFx='debug').
export function initEngineFx(eng) {
  if (eng._fxReady) return;
  eng._fxReady = true;
  eng._comets = [];
  eng._cometQ = [];
  if (!eng._skyFx || eng.universe.mode !== 'global') return;
  detectFreshComets(eng);
  if (isSkyFxDebug() && typeof window !== 'undefined') {
    window.__torreFxSpawnComet = () => {
      const gals = eng.universe.galaxies;
      if (!gals || !gals.length) return false;
      // QA: mira a galáxia mais LONGE da Torre (cometa cruza a vista de forma
      // visível). Em prod o destino real é a galáxia da nota nova.
      const far = gals.reduce((m, g) => (
        Math.hypot(g.cx, g.cy) > (m ? Math.hypot(m.cx, m.cy) : -1) ? g : m), null);
      if (far) eng._cometQ.push(far);
      return Boolean(far);
    };
  }
}

// Promove da fila respeitando o cap de 3 em voo, avança e desenha. Cauda =
// pontos baked (haloSprite) com alpha decrescente; cabeça branca quente; na
// chegada, um estouro curto (halo expandindo). Só transform/alpha/composite.
export function updateComets(eng, now) {
  if (!eng._skyFx || !eng._comets) return;
  const comets = eng._comets;
  const q = eng._cometQ;
  let inFlight = 0;
  for (const c of comets) if (now - c.start < COMET_FLIGHT_MS) inFlight += 1;
  while (inFlight < COMET_MAX_INFLIGHT && q.length) {
    comets.push(makeComet(q.shift(), now));
    inFlight += 1;
  }
  if (!comets.length) return;
  const { ctx, dpr } = eng;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  let w = 0;
  for (const c of comets) {
    const age = now - c.start;
    if (age > COMET_FLIGHT_MS + COMET_BURST_MS) continue; // terminou: descarta
    comets[w] = c;
    w += 1;
    drawComet(eng, c, age);
  }
  comets.length = w;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawComet(eng, c, age) {
  const { ctx } = eng;
  const gx = c.gal.cx;
  const gy = c.gal.cy;
  if (age >= COMET_FLIGHT_MS) {
    // estouro na chegada: halo expandindo + fade
    const bp = clamp((age - COMET_FLIGHT_MS) / COMET_BURST_MS, 0, 1);
    const pt = project(eng, gx, gy, c.gal.cz || 0);
    const r = Math.max(c.gal.sunR, 8) * (1.6 + bp * 2.2) * pt.scale;
    ctx.globalAlpha = (1 - bp) * 0.8;
    ctx.drawImage(haloSprite(c.color), pt.sx - r, pt.sy - r, r * 2, r * 2);
    return;
  }
  const t = age / COMET_FLIGHT_MS;
  const eased = 1 - (1 - t) * (1 - t); // easeOutQuad: rápido saindo, freia
  // Tamanhos em px de TELA (não escalam com o zoom): um risco cruzando a vista
  // some se encolher com p.scale. Posição via project (mundo->tela); raio fixo.
  for (let j = COMET_TAIL; j >= 1; j -= 1) {
    const tf = Math.max(eased - j * 0.05, 0);
    const p = project(eng, gx * tf, gy * tf, 0);
    const r = 4 + (COMET_TAIL - j) * 1.6; // cauda afina indo pra trás
    ctx.globalAlpha = (1 - j / (COMET_TAIL + 1)) * 0.55;
    ctx.drawImage(haloSprite(c.color), p.sx - r, p.sy - r, r * 2, r * 2);
  }
  const head = project(eng, gx * eased, gy * eased, 0);
  const hr = 11; // cabeça branca quente, fixa em tela
  ctx.globalAlpha = 0.95;
  ctx.drawImage(haloSprite('#ffffff'), head.sx - hr, head.sy - hr, hr * 2, hr * 2);
}

// ================================================================ SKY ART
// Pacote de arte: texturas de planeta por pasta (no graph-universe), DAILY com
// terminador de HORA REAL e sol/lua de fundo. Kill-switch NOVO e independente:
// localStorage torre.skyArt='off' desliga os 3; default LIGADO.

export function isSkyArtOn() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('torre.skyArt') !== 'off' : true;
  } catch (err) {
    return true;
  }
}

// Hora local em fração do dia [0,1). Override de QA: torre.skyArtHour = 0..24
// força a hora (para o screenshot noturno). UNSET em prod -> hora real.
export function clockHourFrac() {
  let override = NaN;
  try {
    if (typeof localStorage !== 'undefined') override = Number(localStorage.getItem('torre.skyArtHour'));
  } catch (err) { /* storage bloqueado */ }
  const d = new Date();
  const h = Number.isFinite(override) && override >= 0 && override <= 24
    ? override
    : d.getHours() + d.getMinutes() / 60;
  return (h % 24) / 24;
}

// DAILY-relógio: offset a somar ao ângulo que aponta a luz pra Torre. Convenção:
// MEIO-DIA (hourFrac 0.5) = offset 0 -> lado CLARO voltado pra Torre;
// MEIA-NOITE (0) = ±PI -> lado ESCURO pra Torre. 24h = 1 volta completa.
export function dailyTerminatorOffset(hourFrac) {
  return (hourFrac - 0.5) * TAU;
}

// Fase da lua (algoritmo síncrono simples, precisão ~±1 dia). Ref: lua nova
// 2000-01-06 18:14 UTC; mês sinódico 29.530588853 d. p: 0 nova .. 0.5 cheia.
const MOON_SYNODIC = 29.530588853;
const MOON_REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // dias epoch
export function moonPhase(ms) {
  const days = ms / 86400000 - MOON_REF;
  let p = (days % MOON_SYNODIC) / MOON_SYNODIC;
  if (p < 0) p += 1;
  return { p, illum: (1 - Math.cos(p * TAU)) / 2, waxing: p < 0.5 };
}

// -------- sprites baked do relógio de fundo (sol quente / lua com fase)

function clockSunSprite() {
  const key = 'clockSun';
  if (fxSprites.has(key)) return fxSprites.get(key);
  const s = 80;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2;
  const R = 15;
  // raios sutis (baked)
  x.strokeStyle = hexToRgba('#ffd27d', 0.4);
  x.lineWidth = 1.4;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * R * 1.3, cx + Math.sin(a) * R * 1.3);
    x.lineTo(cx + Math.cos(a) * R * 1.9, cx + Math.sin(a) * R * 1.9);
    x.stroke();
  }
  const g = x.createRadialGradient(cx, cx, 1, cx, cx, R);
  g.addColorStop(0, '#fff3d0');
  g.addColorStop(0.6, '#ffcf7a');
  g.addColorStop(1, hexToRgba('#ff9e3d', 0));
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cx, R, 0, TAU);
  x.fill();
  fxSprites.set(key, c);
  return c;
}

const MOON_LIGHT = '#d8dce6';
const MOON_DARK = 'rgba(42, 48, 64, 0.88)';

// Disco iluminado da lua: base clara + mares MUITO sutis (3 manchas pequenas
// IRREGULARES, alpha ≤0.12 — nunca bolotas redondas grandes). Vibe pixel-art
// discreta, não biscoito. O rim-light do limbo é aplicado no moonSprite.
function moonLitDisc(x, cx, R) {
  const g = x.createRadialGradient(cx - R * 0.35, cx - R * 0.35, 1, cx, cx, R * 1.05);
  g.addColorStop(0, '#f4f6fb');
  g.addColorStop(1, '#c2c7d4');
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cx, R, 0, TAU);
  x.fill();
  const rng = mulberry32(hash32('moonMare'));
  for (let i = 0; i < 3; i += 1) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * R * 0.55;
    x.save();
    x.translate(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr);
    x.rotate(rng() * TAU);
    x.scale(1, 0.55 + rng() * 0.3); // achatada -> mancha irregular, não bolota
    x.fillStyle = hexToRgba('#9aa1b2', 0.1);
    x.beginPath();
    x.arc(0, 0, R * (0.1 + rng() * 0.06), 0, TAU);
    x.fill();
    x.restore();
  }
}

// Lua com FASE: disco escuro + lune iluminada recortada (meia-face ± elipse do
// terminador). Baked por bucket de fase (0.02). Só transform/alpha por frame.
function moonSprite(p) {
  const bucket = Math.round(p * 50) / 50;
  const key = `moon:${bucket}`;
  if (fxSprites.has(key)) return fxSprites.get(key);
  const s = 48; // menor (era 64)
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2;
  const R = 17; // corpo menor e elegante (era 26)
  const waxing = bucket < 0.5;
  const cosP = Math.cos(bucket * TAU);
  const rx = Math.abs(cosP) * R;
  const crescent = cosP > 0; // illum < 0.5
  x.save();
  x.beginPath();
  x.arc(cx, cx, R, 0, TAU);
  x.clip();
  x.fillStyle = MOON_DARK;
  x.fillRect(0, 0, s, s);
  // meia-face do lado iluminado (limbo): direita se crescente, esquerda se minguante
  x.save();
  x.beginPath();
  if (waxing) x.rect(cx, cx - R - 1, R + 1, R * 2 + 2);
  else x.rect(cx - R - 1, cx - R - 1, R + 1, R * 2 + 2);
  x.clip();
  moonLitDisc(x, cx, R);
  if (crescent && rx > 0.5) {
    x.fillStyle = MOON_DARK; // escurece a elipse -> sobra o crescente
    x.beginPath();
    x.ellipse(cx, cx, rx, R, 0, 0, TAU);
    x.fill();
  }
  x.restore();
  if (!crescent && rx > 0.5) {
    x.save(); // gibosa: acende a elipse no lado escuro
    x.beginPath();
    x.ellipse(cx, cx, rx, R, 0, 0, TAU);
    x.clip();
    moonLitDisc(x, cx, R);
    x.restore();
  }
  // rim-light: arco fino claro no LIMBO iluminado (direita se crescente).
  x.lineWidth = 1.3;
  x.strokeStyle = 'rgba(246, 249, 255, 0.55)';
  x.beginPath();
  x.arc(cx, cx, R - 0.7, waxing ? -Math.PI / 2 : Math.PI / 2, (waxing ? -Math.PI / 2 : Math.PI / 2) + Math.PI);
  x.stroke();
  x.restore();
  fxSprites.set(key, c);
  return c;
}

// Sol/lua-relógio: corpo pequeno no arco de parallax MAIS profundo (chamado
// ANTES das nebulosas). Posição no arco = hora local (nasce ~6h à esquerda,
// pino no topo ao meio-dia, se põe ~18h; noite = lua com fase real). Alpha
// discreto (~0.5): relógio ambiental. Parallax raso -> quase não desliza no pan.
const CLOCK_PARALLAX = 0.03;
export function drawSunMoonClock(eng) {
  if (!eng._skyArt) return;
  const { ctx, dpr, w, h, cam } = eng;
  const hf = Number.isFinite(eng._hourFrac) ? eng._hourFrac : clockHourFrac();
  const h24 = hf * 24;
  const isDay = h24 >= 6 && h24 < 18;
  const t = isDay ? (h24 - 6) / 12 : (((h24 - 18) % 24) + 24) % 24 / 12;
  // Arco na FAIXA DE CÉU do topo (bem acima do anel de galáxias) — o céu
  // arrumado é DEFAULT e põe uma galáxia no topo (INBOX), então o pino do
  // meio-dia/meia-noite não pode cair em cima dela. Pico ~0.05h, pés ~0.17h.
  const bx = w * (0.08 + 0.84 * t) + cam.tx * CLOCK_PARALLAX;
  const by = h * 0.17 - h * 0.12 * Math.sin(Math.PI * t) + cam.ty * CLOCK_PARALLAX;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 0.55; // corpo menor -> pode subir um tico e ainda ser discreto
  if (isDay) {
    const sp = clockSunSprite();
    ctx.drawImage(sp, bx - sp.width / 2, by - sp.height / 2);
  } else {
    const sp = moonSprite(moonPhase(Date.now()).p);
    ctx.drawImage(sp, bx - sp.width / 2, by - sp.height / 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
