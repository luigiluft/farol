// FAROL - graph-draw.js (A2, F3+F4): render do grafo-universo.
// Todas as funcoes de desenho do frame: nebulosas pre-renderizadas com
// drift lentissimo, starfield 3 camadas com parallax por profundidade,
// poeira estelar, constelacoes intra-galaxia, sois com raios cruzados
// via sprite, estrelas-nota com halo cacheado, flares da API highlight,
// ego-network do hover com overlay escuro, faroles da busca e labels.
// F5.9-v2: labels discretos de sub-aglomerado (universe.subClusters) que
// acompanham a rotacao do cluster, so com zoom proximo (k > 0.9).
// F-const: mergulho de galaxia em modo CONSTELACAO B1 (graph-constellation.js);
// aqui vive so o gate eng._constT — os fades 1-ct das camadas substituidas
// vem de helpers do modulo (constellationFade & cia). ct=0 = render identico.
// F7: drawStations/drawLibrary vem de graph-station.js (migraram de
// fleet-draw); TODAS as cores de fundo/labels/overlays leem canvasTheme()
// com 1 lookup no topo do drawFrame (cacheado em eng.themeColors); o ceu
// e um skySprite baked por tema (1 drawImage por frame).
// Performance: nenhum gradiente/blur criado por frame (tudo baked em
// sprite); constelacoes em um unico path; overlay em espaco de tela.
import { TAU, clamp, truncate, haloSprite, raysSprite, skySprite, sunSprite, planetSprite, PLANET_LIGHT_BASE, STAR_PRESET } from './graph-universe.js';
import { project } from './graph-engine.js';
import { drawFleetUnder, drawFleetOver } from './fleet-draw.js';
import { drawStations, drawLibrary } from './graph-station.js';
import { isSkyFxOn, initEngineFx, drawSaturnRings, drawDebrisBelt, updateComets, isSkyArtOn, clockHourFrac, dailyTerminatorOffset } from './graph-fx.js';
// F-const: drill-down de galaxia em modo CONSTELACAO B1 (kill-switch
// torre.skyConstellation='off'). Layout memoizado, draws e helpers de fade
// 1-ct das camadas substituidas vivem todos no modulo.
import {
  constellationStrength, applyConstellationLayout, constellationFade,
  noteConstellationDim, constellationLinkFader, drawConstellationBackdrop,
  drawConstellationLinks, drawConstellationNodes,
} from './graph-constellation.js';
import { canvasTheme, getTheme, setRenderTheme } from './theme.js';

// FX luz-atividade: cor do sopro quente (halo aditivo) das galáxias com nota
// editada nas últimas 24h. haloSprite baka por esta cor uma vez.
const SKYFX_WARM = '#ffe6b0';

// 2.5D-real (W3): FONTE UNICA de world->screen e o project() do graph-engine
// (mesma perspectiva do hit-test). O import engine<->draw e circular, mas so
// se resolve em runtime (project so e chamado dentro de funcoes de desenho,
// nunca no topo do modulo), entao e seguro. Substitui o antigo projAnchor.

const PARALLAX_NEB = 0.07;
const PARALLAX_FAR = 0.05;
const PARALLAX_MID = 0.11;
const PARALLAX_NEAR = 0.2;
const PARALLAX_DUST = 0.14;
const SEARCH_DIM = 0.1;
const LABEL_CAP = 16;
const FLARE_RING_MS = 750;
// F2 LOD por zoom: afastado (k baixo) as notas/constelacoes somem e ficam so os
// SOIS (planetas); zoom-in revela as notas = "mergulho" na galaxia. Fade suave
// entre HIDE_K e SHOW_K. Busca/flash sempre visivel (beacon ignora o LOD).
const NOTE_HIDE_K = 0.35;
const NOTE_SHOW_K = 0.8;
// F5.9-v2: labels de sub-aglomerado so com zoom proximo e cluster com
// 5+ notas — zoom out mantem o ceu limpo como no F4.
const SUB_LABEL_MIN_K = 0.9;
const SUB_LABEL_MIN_COUNT = 5;
// F8 - corrente ambiente: o mesmo path das constelacoes recebe um segundo
// traco tracejado fluindo lentissimo (pacotes coursando a rede inteira).
// Congela com reduced/busca. Scratch de dash reusado (zero alloc por frame).
const FLOW_DASH = [0, 0];
const NO_DASH = [];
const FLOW_DASH_PXMS = 0.022; // velocidade do dash em px de tela/ms
// #5 fade de borda das constelacoes: link que sai da viewport DISSOLVE em vez
// de cortar seco ("link pra lugar nenhum"). Cada link cai num bucket de alpha
// pela distancia (px de tela) do seu endpoint mais proximo da borda; FADE_BAND
// e a faixa onde o fade acontece. Path2D por bucket = poucos strokes, zero
// gradiente por frame. Abaixo do ultimo .min o link nao desenha.
const EDGE_FADE_BAND = 90;
const EDGE_BUCKETS = [
  { min: 0.72, mult: 1 },
  { min: 0.46, mult: 0.6 },
  { min: 0.22, mult: 0.34 },
  { min: 0.08, mult: 0.16 },
];
// Review fix F7 (hub claro sem estrutura): starfield/dust derivados
// LOCALMENTE pro tema light -- mesmos hues ardosia, tons mais escuros e
// alpha reforcada. theme.js fica intocado (lista de tokens fechada C1.2).
const LIGHT_SKY = {
  far: '#7e93a8',
  mid: '#5d748c',
  near: '#41586f',
  dust: '#7e90a2',
  boost: 1.5,
};

export function drawFrame(eng) {
  setRenderTheme('dark'); // F3b: universo SEMPRE dark (o chrome do app segue o tema global)
  const { ctx, dpr, cam } = eng;
  const now = performance.now(); // capturado UMA vez por frame (review fix)
  const th = canvasTheme(); // 1 lookup por frame; sub-draws leem daqui
  eng.themeColors = th;
  // FX de dado real (default ON; kill-switch torre.skyFx='off'). 1 leitura por
  // frame; drawSuns/drawSaturnRings/updateComets/labels leem eng._skyFx.
  eng._skyFx = isSkyFxOn();
  initEngineFx(eng); // detecção de cometas do build corrente (guarda 1x/engine)
  // skyArt (kill-switch próprio torre.skyArt='off'): texturas de planeta por
  // pasta + DAILY-relógio + sol/lua de fundo. hourFrac 1x/frame (DAILY e o
  // relógio de fundo leem daqui).
  eng._skyArt = isSkyArtOn();
  eng._hourFrac = eng._skyArt ? clockHourFrac() : null;
  // F2 LOD: 0 = so planetas (afastado) -> 1 = notas plenas (zoom-in). Lido por
  // drawNotes/drawConstellations/drawSuns/drawGalaxyLabels neste mesmo frame.
  eng._noteLOD = clamp((cam.k - NOTE_HIDE_K) / (NOTE_SHOW_K - NOTE_HIDE_K), 0, 1);
  // F-const: forca 0..1 do modo constelacao B1 no mergulho (ct=0 = ceu atual
  // exato). O apply lerpa px/py/pz: pick/tooltip/frota seguem coerentes.
  eng._constT = constellationStrength(eng);
  if (eng._constT > 0) applyConstellationLayout(eng);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, eng.w, eng.h);
  ctx.drawImage(skySprite(), 0, 0, eng.w, eng.h);
  drawNebulas(eng);
  const light = getTheme() === 'light';
  const boost = light ? LIGHT_SKY.boost : 1;
  // 2.5D bloom (so no dark): halos de nota/sol/flare somam luz
  // (globalCompositeOperation 'lighter') -> nuvem densa brilha como cena
  // espacial. No light fica source-over (mapa diurno, sem lavar o fundo).
  eng.additiveBloom = !light;
  drawStarLayer(eng, eng.stars.far, PARALLAX_FAR, light ? LIGHT_SKY.far : th.starFar, boost);
  drawStarLayer(eng, eng.stars.mid, PARALLAX_MID, light ? LIGHT_SKY.mid : th.starMid, boost);
  drawStarLayer(eng, eng.stars.near, PARALLAX_NEAR, light ? LIGHT_SKY.near : th.starNear, boost);
  drawDust(eng, light ? LIGHT_SKY.dust : th.dust, boost);
  drawComet(eng);
  drawTowerBeacon(eng); // beacon quente da Torre (a varredura de radar foi removida a pedido do dono)
  drawConstellationBackdrop(eng, project); // F-const: grade pontilhada + marca-d'agua (no-op com ct=0)
  // 2.5D-real (W3): a matriz-mundo afim (yaw/tilt do cam3, valida em z=0)
  // continua valendo SO para as camadas que ficaram no plano ortografico:
  // a FROTA (fleet-draw) e as ESTACOES/BIBLIOTECA (graph-station), intocadas.
  // As camadas do UNIVERSO com profundidade (constelacoes, sois, notas, ego,
  // flares) agora projetam ponto a ponto via project() e desenham em SCREEN
  // space (cada uma faz save/setTransform/restore), entao a perspectiva real
  // (near maior/na frente + parallax na rotacao) aparece. Elas restauram a
  // matriz ao sair, mantendo este transform valido para as camadas seguintes.
  const { yaw, tilt } = eng.cam3;
  const ma = cam.k * Math.cos(yaw);
  const mb = -cam.k * Math.sin(yaw) * Math.sin(tilt);
  const md = cam.k * Math.cos(tilt);
  ctx.setTransform(dpr * ma, dpr * mb, 0, dpr * md, dpr * cam.tx, dpr * cam.ty);
  if (eng.showLinks) drawConstellations(eng);
  if (eng.showLinks) drawConstellationLinks(eng, project); // F-const: arestas B1 (3 tiers + raios)
  drawFleetUnder(eng, now);
  drawBeltRing(eng); // céu arrumado: anel-guia tênue do cinturão (sob os planetas)
  drawSuns(eng);
  drawSaturnRings(eng); // FX: anel na galáxia com nave ATIVA pousada (sobre o planeta, sob a nave)
  drawConstellationNodes(eng, project); // F-const: pontos creme + hubs + rotulos (sob os beacons do drawNotes)
  drawNotes(eng);
  drawGalaxyLabels(eng);
  drawSubClusterLabels(eng);
  drawStations(eng, now);
  drawLibrary(eng, now);
  drawFleetOver(eng, now);
  if (eng.hover && eng.hover.node) drawEgo(eng);
  else if (eng.search.set) drawSearchLabels(eng);
  if (eng.flares.length) drawFlares(eng, now);
  updateComets(eng, now); // FX: cometa de nota nova (Torre -> galáxia destino), no topo do universo
  setRenderTheme(null); // limpa o override: o chrome do app (fora do frame) segue o tema real
}

// Nebulosas: sprites com blur ja baked, drawImage + alpha 0.05-0.09.
// Wrap pelo span (w + size): a nebulosa sai inteira antes de reentrar
// do outro lado, sem pop visivel. Drift senoidal lentissimo.
function drawNebulas(eng) {
  const { ctx, w, h, time, cam } = eng;
  const nebs = eng.universe.nebulas;
  if (!nebs || !nebs.length) return;
  const zoom = Math.pow(clamp(cam.k, 0.4, 2.4), 0.12);
  for (const nb of nebs) {
    const size = Math.min(w, h) * nb.scale * zoom;
    const spanX = w + size;
    const spanY = h + size;
    const dx = Math.sin(time * nb.driftSpeed + nb.driftPhase) * size * 0.03;
    const dy = Math.cos(time * nb.driftSpeed * 0.8 + nb.driftPhase) * size * 0.025;
    const x = ((((nb.u * spanX + cam.tx * PARALLAX_NEB + dx) % spanX) + spanX) % spanX) - size;
    const y = ((((nb.v * spanY + cam.ty * PARALLAX_NEB + dy) % spanY) + spanY) % spanY) - size;
    ctx.globalAlpha = nb.alpha;
    ctx.drawImage(nb.sprite, x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

// Estrelas em espaco de tela com wrap: parallax por profundidade no pan, twinkle
// por sin(t). Pre-geradas; boost (review fix F7) reforca alpha no tema light.
function drawStarLayer(eng, stars, par, color, boost) {
  const { ctx, w, h, time, cam } = eng;
  const ox = cam.tx * par;
  const oy = cam.ty * par;
  ctx.fillStyle = color;
  for (const s of stars) {
    const x = (((s.u * w + ox) % w) + w) % w;
    const y = (((s.v * h + oy) % h) + h) % h;
    const tw = s.twSpeed ? 0.65 + 0.35 * Math.sin(time * s.twSpeed + s.twPhase) : 1;
    ctx.globalAlpha = Math.min(1, s.alpha * tw * boost);
    ctx.fillRect(x, y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

// Poeira estelar: graos sub-pixel com deriva lenta continua. Cor e boost
// vem do drawFrame (variante light derivada local, theme.js intocado).
function drawDust(eng, color, boost) {
  const { ctx, w, h, time, cam } = eng;
  const ox = cam.tx * PARALLAX_DUST;
  const oy = cam.ty * PARALLAX_DUST;
  ctx.fillStyle = color;
  for (const s of eng.stars.dust) {
    const x = (((s.u * w + ox + time * s.drift) % w) + w) % w;
    const y = (((s.v * h + oy + time * s.drift * 0.4) % h) + h) % h;
    ctx.globalAlpha = Math.min(1, s.alpha * boost);
    ctx.fillRect(x, y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

// Cometa raro: a cada ~41s um risco diagonal cruza o fundo em espaco de
// tela (~1.8s visivel). Origem deterministica por ciclo (hash do indice),
// 5 fillRects de rastro + nucleo -- zero alocacao, some com reduced.
const COMET_PERIOD_S = 41;
const COMET_WINDOW = 0.045;

function drawComet(eng) {
  if (eng.reduced) return;
  const { ctx, w, h, time } = eng;
  const t = (time % COMET_PERIOD_S) / COMET_PERIOD_S;
  if (t > COMET_WINDOW) return;
  const p = t / COMET_WINDOW;
  const seed = (Math.floor(time / COMET_PERIOD_S) * 2654435761) >>> 0;
  const sx = w * (0.12 + ((seed % 997) / 997) * 0.6);
  const sy = h * (0.06 + ((Math.floor(seed / 997) % 997) / 997) * 0.25);
  const dx = w * 0.2;
  const dy = h * 0.17;
  const fade = Math.sin(p * Math.PI);
  ctx.fillStyle = eng.themeColors.comet;
  for (let j = 5; j >= 1; j -= 1) {
    const tt = Math.max(0, p - j * 0.03);
    ctx.globalAlpha = fade * (0.42 - j * 0.07);
    ctx.fillRect(sx + dx * tt - 1, sy + dy * tt - 1, 2, 2);
  }
  ctx.globalAlpha = fade * 0.95;
  ctx.fillRect(sx + dx * p - 1.2, sy + dy * p - 1.2, 2.4, 2.4);
  ctx.globalAlpha = 1;
}

// Torre de Controle: beacon quente (ambar) no centro do anel — nucleo do hub.
// A varredura de radar girando (cone frio + linha) foi REMOVIDA a pedido do
// dono; sobra so a aura ambar como presenca da Torre. Backdrop SUTIL e aditivo
// (atras dos planetas e da estacao-cerebro). So no universo global (beacon
// presente). Atenua suave no mergulho (LOD alto).
function drawTowerBeacon(eng) {
  const { ctx, dpr } = eng;
  if (!eng.universe.beacon) return;
  const lod = eng._noteLOD ?? 0;
  const fade = 1 - lod * 0.6;
  const p = project(eng, 0, 0, 0);
  const sc = p.scale;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const br = Math.max(70 * sc, 26) * (1 + 0.05 * Math.sin(eng.time * 1.1));
  ctx.globalAlpha = 0.7 * fade;
  ctx.drawImage(haloSprite('#ffca78'), p.sx - br, p.sy - br, br * 2, br * 2);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// Constelacoes permanentes: so intra-galaxia, bem fracas, um unico path.
// th.constellation ja carrega a alpha do tema; busca dim via globalAlpha.
// 2.5D-real (W3): cada endpoint projeta via project() (com pz) e o path se
// constroi em SCREEN space — links de notas proximas (z menor) ficam mais
// "na frente" e a rotacao gera parallax. lineWidth/dash em px de tela.
// Distancia normalizada (0..1) do ponto projetado a borda da tela mais proxima:
// 1 = bem dentro, 0 = na borda/fora. Alimenta o bucket de alpha do link.
function edgeFade(eng, p) {
  const d = Math.min(p.sx, p.sy, eng.w - p.sx, eng.h - p.sy);
  return clamp(d / EDGE_FADE_BAND, 0, 1);
}

function edgeBucket(fade) {
  for (let i = 0; i < EDGE_BUCKETS.length; i += 1) {
    if (fade >= EDGE_BUCKETS[i].min) return i;
  }
  return -1; // saiu da viewport: nao desenha (ja dissolveu)
}

function drawConstellations(eng) {
  const { ctx, dpr, universe } = eng;
  const lod = eng._noteLOD ?? 1; // somem junto com as notas no zoom-out
  if (lod <= 0.01) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // #5 fade de borda: cada link entra no Path2D do seu bucket de alpha (pela
  // distancia do endpoint mais proximo da borda) -> links saindo da viewport
  // dissolvem em vez de cortar seco.
  // F-const: fader.claim tira dos buckets os links de galaxia em constelacao
  // (modulo desenha as arestas B1; no morph esvaem via fader.stroke abaixo).
  const fader = constellationLinkFader(eng, project);
  const buckets = EDGE_BUCKETS.map(() => new Path2D());
  for (const l of universe.links) {
    if (universe.mode === 'global' && !l.same) continue;
    if (fader.claim(l)) continue;
    const a = project(eng, l.a.px, l.a.py, l.a.pz);
    const b = project(eng, l.b.px, l.b.py, l.b.pz);
    const bi = edgeBucket(Math.min(edgeFade(eng, a), edgeFade(eng, b)));
    if (bi < 0) continue;
    buckets[bi].moveTo(a.sx, a.sy);
    buckets[bi].lineTo(b.sx, b.sy);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = eng.themeColors.constellation;
  const base = (eng.search.set ? 0.55 : 1) * lod;
  for (let i = 0; i < buckets.length; i += 1) {
    ctx.globalAlpha = base * EDGE_BUCKETS[i].mult;
    ctx.stroke(buckets[i]);
  }
  fader.stroke(ctx, base); // morph: links da constelacao esvaindo com 1-ct
  // Corrente ambiente: dash fluindo so nos buckets mais visiveis (interior).
  if (!eng.reduced && !eng.search.set) drawConstellationFlow(eng, performance.now(), buckets);
  if (eng.activeNodes && eng.activeNodes.size) drawActiveEdges(eng);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Q5: arestas INCIDENTES aos nós ativos (qualquer galáxia) acesas por cima
// das constelações fracas — mostram a quem o nó trabalhado se conecta. Dentro
// do save/screen-space do drawConstellations (path/transform válidos).
function drawActiveEdges(eng) {
  const { ctx, universe } = eng;
  const adj = universe.adjacency;
  ctx.beginPath();
  for (const id of eng.activeNodes) {
    for (const l of (adj.get(id) || [])) {
      const a = project(eng, l.a.px, l.a.py, l.a.pz);
      const b = project(eng, l.b.px, l.b.py, l.b.pz);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
    }
  }
  ctx.setLineDash(NO_DASH);
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = eng.themeColors.egoLink;
  ctx.stroke();
}

// Segundo traco do path das constelacoes: dash curto + gap longo = pacotes
// de luz coursando os links na direcao a->b. egoLink (tom mais vivo do
// tema) sobre a constellation fraca; lineDashOffset anima o deslize.
// W3: chamado de dentro do save/screen-space do drawConstellations — o path
// e o transform seguem validos; dash em px de tela (sem dividir por cam.k).
function drawConstellationFlow(eng, now, buckets) {
  const { ctx } = eng;
  FLOW_DASH[0] = 3;
  FLOW_DASH[1] = 13;
  ctx.setLineDash(FLOW_DASH);
  ctx.lineDashOffset = -(now * FLOW_DASH_PXMS);
  ctx.strokeStyle = eng.themeColors.egoLink;
  // o fluxo acompanha o fade de borda: forte no interior, fraco saindo.
  ctx.globalAlpha = 0.35;
  ctx.stroke(buckets[0]);
  ctx.globalAlpha = 0.2;
  ctx.stroke(buckets[1]);
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
}

// Raios cruzados do nucleo: sprite baked, rotacao lentissima por frame
// (transform de canvas, custo de 1 drawImage por galaxia). W3: recebe ponto
// JA projetado em tela (sx,sy) e raio JA escalado pela perspectiva — o
// caller projeta o centro do sol; aqui so translada/rotaciona/desenha.
function drawSunRays(eng, sx, sy, color, radius, phase, alpha) {
  const { ctx } = eng;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(eng.time * 0.04 + phase);
  ctx.globalAlpha = alpha;
  ctx.drawImage(raysSprite(color), -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

// Céu arrumado: anel-guia tênue no raio do cinturão -> as pastas pequenas leem
// como um CINTURÃO (faixa) e não pontos soltos. Círculo-mundo em (0,0) projetado
// ponto a ponto (vira elipse sob o tilt) num único path, 1px na cor orbitRing do
// tema, alpha baixa que recua no mergulho (LOD). Só no tidy com cinturão presente
// (sem gal.belt -> retorna cedo, baseline intocado). Zero alocação por frame além
// do path; nenhum gradiente/blur.
const BELT_RING_SEGMENTS = 72;
function drawBeltRing(eng) {
  const belt = eng.universe.galaxies.find((g) => g.belt);
  if (!belt || !belt.orbitR) return;
  const { ctx, dpr } = eng;
  const lod = eng._noteLOD ?? 0;
  const r = belt.orbitR;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  for (let i = 0; i <= BELT_RING_SEGMENTS; i += 1) {
    const a = (i / BELT_RING_SEGMENTS) * TAU;
    const p = project(eng, Math.cos(a) * r, Math.sin(a) * r, 0);
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = eng.themeColors.orbitRing;
  ctx.globalAlpha = 0.06 * (1 - lod * 0.5); // tênue; recua um pouco no mergulho
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Nucleo-sol da galaxia: raios sutis + glow cacheado + disco + centro.
// Review fix F7: glow mais presente no light (o centro branco do sprite
// lava sobre o ceu claro); derivado local, theme.js intocado.
// W3: cada sol projeta o centro da galaxia (cx,cy,cz) e desenha em SCREEN
// space; todos os raios em mundo viram px de tela multiplicando por p.scale
// (perspectiva). Salva/restaura o transform para nao vazar para as camadas
// seguintes (frota/estacoes seguem na matriz-mundo).
function drawSuns(eng) {
  const { ctx, dpr } = eng;
  const dimAll = eng.search.set ? 0.4 : 1;
  const glow = getTheme() === 'light' ? 0.95 : 0.85;
  // F2/F3 LOD: zoom-out -> galaxia cresce e vira PLANETA (esfera iluminada);
  // zoom-in -> volta ao nucleo-sol da galaxia (disco + centro branco).
  const lod = eng._noteLOD ?? 1;
  const boost = 1 + (1 - lod) * 1.5;
  const planetMode = lod < 0.6;
  const center = project(eng, 0, 0, 0); // a luz da esfera aponta pra Torre (0,0)
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const gal of eng.universe.galaxies) {
    const cfade = constellationFade(eng, gal); // F-const: modulo desenha o centro B1
    if (cfade <= 0.02) continue;
    const galDim = dimAll * cfade;
    const p = project(eng, gal.cx, gal.cy, gal.cz || 0);
    const breathe = 1 + 0.05 * Math.sin(eng.time * 0.5 + gal.breathe);
    const sr = gal.sunR * boost;
    const hs = sr * STAR_PRESET.corona * breathe * p.scale; // corona/glow aditivo (preset)
    // FX luz-atividade: recente brilha mais (glow>1 + sopro quente aditivo),
    // estagnada escurece (glow<1). gal.actGlow/actWarm vêm do modelo; só aplica
    // com o kill-switch ligado (senão neutro = render idêntico ao de antes).
    const actGlow = eng._skyFx ? gal.actGlow : 1;
    const actWarm = eng._skyFx ? gal.actWarm : 0;
    if (eng.additiveBloom) ctx.globalCompositeOperation = 'lighter';
    drawSunRays(eng, p.sx, p.sy, gal.color, sr * 4.4 * breathe * p.scale, gal.breathe, 0.4 * galDim);
    ctx.globalAlpha = glow * galDim * actGlow;
    ctx.drawImage(haloSprite(gal.color), p.sx - hs, p.sy - hs, hs * 2, hs * 2);
    if (actWarm > 0) {
      ctx.globalAlpha = actWarm * 0.3 * galDim; // sopro quente da nota recente
      ctx.drawImage(haloSprite(SKYFX_WARM), p.sx - hs, p.sy - hs, hs * 2, hs * 2);
    }
    if (eng.additiveBloom) ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = galDim;
    if (eng._skyFx && gal.inbox) {
      // FX inbox-detritos: SÓ o arco de fragmentos (pátio), em QUALQUER zoom.
      // Nunca planeta NEM corpo-de-sol: a "bola cinza com manchas" que ancorava
      // no Inbox era o sunSprite do ramo não-planetMode (zoom-in). Removido aqui.
      drawDebrisBelt(eng, p, sr * 1.5 * p.scale, gal, galDim);
    } else if (planetMode) {
      const rad = sr * 1.5 * p.scale;
      // skyArt: textura semântica por pasta (baked por cor+tipo); off = nuvens.
      const type = eng._skyArt ? gal.artType : 'clouds';
      // Base: a luz aponta pra Torre. DAILY (dia/noite) gira pelo relógio real
      // em vez de mirar a Torre -> o terminador vira a hora (ver dailyTerminatorOffset).
      let rot = Math.atan2(center.sy - p.sy, center.sx - p.sx) - PLANET_LIGHT_BASE;
      if (eng._skyArt && gal.artType === 'daynight' && Number.isFinite(eng._hourFrac)) {
        rot += dailyTerminatorOffset(eng._hourFrac);
      }
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(rot);
      ctx.drawImage(planetSprite(gal.color, type), -rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    } else {
      // CORPO da estrela: sprite baked "sol de verdade" (disco definido + limbo
      // + granulacao + nucleo branco-quente). Sem circulos chapados nem
      // gradiente por frame — substitui o glow-blob antigo.
      const bodyR = sr * STAR_PRESET.body * breathe * p.scale;
      ctx.drawImage(sunSprite(gal.color), p.sx - bodyR, p.sy - bodyR, bodyR * 2, bodyR * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// W3: sol central (modo local) projeta o no (px,py,pz) e desenha em SCREEN
// space, raios em mundo × p.scale. drawLabel ja billboarda (save/restore
// proprio); o save/restore aqui isola o transform das camadas seguintes.
function drawCenterSun(eng, n) {
  const { ctx, dpr } = eng;
  const p = project(eng, n.px, n.py, n.pz);
  const breathe = 1 + 0.06 * Math.sin(eng.time * 0.6 + n.pulsePhase);
  const hs = n.r * STAR_PRESET.corona * 1.35 * breathe * p.scale; // corona (preset, escala do sol central)
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (eng.additiveBloom) ctx.globalCompositeOperation = 'lighter';
  drawSunRays(eng, p.sx, p.sy, n.color, n.r * 5 * breathe * p.scale, n.pulsePhase, 0.45);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(haloSprite(n.color), p.sx - hs, p.sy - hs, hs * 2, hs * 2);
  if (eng.additiveBloom) ctx.globalCompositeOperation = 'source-over';
  // CORPO da estrela central: mesmo sprite baked "sol de verdade".
  const bodyR = n.r * STAR_PRESET.body * 1.24 * breathe * p.scale;
  ctx.globalAlpha = 1;
  ctx.drawImage(sunSprite(n.color), p.sx - bodyR, p.sy - bodyR, bodyR * 2, bodyR * 2);
  ctx.restore();
  drawLabel(eng, n, truncate(n.label, 30), true);
}

// W3: notas em SCREEN space com perspectiva + painter's algorithm. Coleta os
// nos no scratch eng._zsort, projeta cada um, ORDENA por depth DESCENDENTE
// (longe primeiro -> perto por ultimo, far->near) e desenha. O ponto
// projetado + scale vai pra drawNoteStar (sem reprojetar). O sol central
// (modo local) sai do sort: drawCenterSun ja se projeta sozinho.
function drawNotes(eng) {
  const { ctx, dpr } = eng;
  const lod = eng._noteLOD ?? 1; // F2: notas somem afastado, voltam no zoom-in (mergulho)
  const searching = Boolean(eng.search.set);
  const flashing = eng.flashNode && eng.time < eng.flashUntil;
  const buf = eng._zsort;
  buf.length = 0;
  for (const n of eng.universe.nodes) {
    if (n.kind === 'center') {
      drawCenterSun(eng, n);
      continue;
    }
    const beaconNode =
      (eng.activeNodes && eng.activeNodes.has(n.id))
      || (searching && eng.search.set.has(n.id)) || (flashing && n === eng.flashNode);
    // Afastado (lod~0): so os planetas (sois); notas escondidas exceto beacon
    // (busca, flash OU nó ativo de agente -> sempre visível no foco Q5).
    if (lod <= 0.01 && !beaconNode) continue;
    // F-const plena (dim 0): ponto creme do modulo assume; beacons seguem
    // aqui por cima, na MESMA posicao lerpada.
    if (!beaconNode && noteConstellationDim(eng, n) <= 0) continue;
    const p = project(eng, n.px, n.py, n.pz);
    n._p = p; // cache do ponto projetado para o draw (reusado abaixo)
    buf.push(n);
  }
  if (buf.length) {
    buf.sort((a, b) => b._p.depth - a._p.depth); // far -> near (painter's)
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fs = eng.focusSet; // Q5: ativos + vizinhos; resto escurece
    for (const n of buf) {
      const active = eng.activeNodes && eng.activeNodes.has(n.id);
      const beacon =
        active || (searching && eng.search.set.has(n.id)) || (flashing && n === eng.flashNode);
      let dim = (searching && !beacon ? SEARCH_DIM : 1) * (beacon ? 1 : lod);
      if (fs && !beacon) dim *= fs.has(n.id) ? 0.8 : 0.16; // foco: vizinhos quase plenos, resto apagado
      // F-const morph: a estrela-orbita esvai enquanto o ponto creme entra.
      if (!beacon) dim *= noteConstellationDim(eng, n);
      drawNoteStar(eng, n, beacon, dim, n._p);
    }
    ctx.restore();
  }
  buf.length = 0;
  eng.ctx.globalAlpha = 1;
}

// Estrela-nota: halo via sprite cacheado por cor (nenhum gradiente por
// frame) + nucleo solido. Beacon = farol da busca ou flash de localizacao.
// W3: desenha em SCREEN space no ponto JA projetado p (p.sx,p.sy) com TODOS
// os raios-mundo escalados por p.scale (perspectiva: near maior). O caller
// (drawNotes / drawEgo) ja entrou em screen-space e projetou o no.
function drawNoteStar(eng, n, beacon, dim, p) {
  const { ctx } = eng;
  const tier = n.tier;
  const sc = p.scale;
  let haloAlpha = tier.haloAlpha;
  let haloScale = tier.halo;
  if (tier.pulse > 0) {
    haloAlpha += 0.3 * (0.5 + 0.5 * Math.sin(eng.time * 1.4 + n.pulsePhase));
  }
  const active = eng.activeNodes && eng.activeNodes.has(n.id);
  if (beacon) {
    haloAlpha = 0.75 + 0.2 * Math.sin(eng.time * 2.4 + n.pulsePhase);
    haloScale = Math.max(haloScale, 4.6);
  }
  // UI: nó SENDO TRABALHADO (editado/lido) cresce e respira -> a troca de
  // partículas tem destino VISÍVEL e vivo, não parece "info vindo do além".
  if (active) {
    haloAlpha = Math.max(haloAlpha, 0.85);
    haloScale = Math.max(haloScale, 5.6);
  }
  if (haloAlpha > 0.015 && haloScale > 0) {
    const hs = Math.max(n.r * haloScale * sc, 5);
    if (eng.additiveBloom) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(haloAlpha, 0, 1) * dim;
    ctx.drawImage(haloSprite(n.color), p.sx - hs, p.sy - hs, hs * 2, hs * 2);
    if (eng.additiveBloom) ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = clamp(tier.core + (beacon ? 0.35 : 0), 0, 1) * dim;
  ctx.fillStyle = n.color;
  ctx.beginPath();
  const grow = active
    ? 2.4 + 0.45 * Math.sin(eng.time * 2.2 + n.pulsePhase) // cresce + respira
    : (beacon ? 1.2 : 1);
  ctx.arc(p.sx, p.sy, n.r * tier.scale * grow * sc, 0, TAU);
  ctx.fill();
  // sparkle de difracao nas notas recentes (tier pulsante) e faroles:
  // 2 fillRects finos em cruz, alpha respirando -- custo ~zero. Cor =
  // cockpit do tema (ponto-brilho: quase branco no dark, tinta no light).
  if (tier.pulse > 0 || beacon) {
    const tw = eng.reduced ? 0.7 : 0.5 + 0.5 * Math.sin(eng.time * 2 + n.pulsePhase);
    const arm = n.r * (beacon ? 4.6 : 3.4) * sc;
    const w = Math.max(n.r * 0.34 * sc, 0.5);
    ctx.globalAlpha = 0.5 * tw * dim;
    ctx.fillStyle = eng.themeColors.cockpit;
    ctx.fillRect(p.sx - arm, p.sy - w / 2, arm * 2, w);
    ctx.fillRect(p.sx - w / 2, p.sy - arm, w, arm * 2);
  }
}

// Hover: overlay escuro em espaco de tela + TODAS as conexoes do no
// (inclusive entre galaxias) + vizinhos redesenhados por cima com labels.
// W3: tudo em SCREEN space — o overlay cobre a tela inteira, os links e as
// estrelas projetam via project() (com pz). lineWidth em px de tela.
function drawEgo(eng) {
  const { ctx, dpr } = eng;
  const hovered = eng.hover.node;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = eng.themeColors.egoOverlay;
  ctx.fillRect(0, 0, eng.w, eng.h);
  const links = eng.universe.adjacency.get(hovered.id) || [];
  ctx.beginPath();
  for (const l of links) {
    const a = project(eng, l.a.px, l.a.py, l.a.pz);
    const b = project(eng, l.b.px, l.b.py, l.b.pz);
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
  }
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = eng.themeColors.egoLink;
  ctx.stroke();
  let shown = 0;
  for (const l of links) {
    const nb = l.a === hovered ? l.b : l.a;
    if (nb.kind !== 'center') drawNoteStar(eng, nb, false, 1, project(eng, nb.px, nb.py, nb.pz));
    if (shown < LABEL_CAP) {
      drawLabel(eng, nb, truncate(nb.label, 24), false);
      shown += 1;
    }
  }
  if (hovered.kind !== 'center') {
    drawNoteStar(eng, hovered, true, 1, project(eng, hovered.px, hovered.py, hovered.pz));
  }
  ctx.restore();
  drawLabel(eng, hovered, truncate(hovered.label, 30), true);
  eng.ctx.globalAlpha = 1;
}

function drawSearchLabels(eng) {
  let shown = 0;
  for (const n of eng.universe.nodes) {
    if (!eng.search.set.has(n.id)) continue;
    drawLabel(eng, n, truncate(n.label, 24), false);
    shown += 1;
    if (shown >= LABEL_CAP) return;
  }
}

// Billboard: projeta o anchor da galaxia e desenha o titulo em screen-space
// (texto sempre reto/legivel sob a matriz inclinada). Offsets em px de tela.
function drawGalaxyLabels(eng) {
  const { ctx, dpr } = eng;
  const th = eng.themeColors;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const boost = 1 + (1 - (eng._noteLOD ?? 1)) * 1.5; // acompanha o planeta ampliado no zoom-out
  for (const gal of eng.universe.galaxies) {
    if (gal.belt) continue; // céu arrumado: cinturão sem label fixo (só hover/tooltip)
    const cfade = constellationFade(eng, gal); // F-const: titulo serif B1 assume
    if (cfade <= 0.02) continue;
    const p = project(eng, gal.cx, gal.cy, gal.cz || 0);
    const y = p.sy + gal.sunR * boost * p.scale + 10;
    // UI: hierarquia — nome da galaxia MAIOR (14px) que o "N notas" (9px).
    ctx.font = `bold 14px ${th.canvasFont}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.labelStroke;
    ctx.globalAlpha = (eng.search.set ? 0.45 : 0.95) * cfade;
    const text = gal.label.toUpperCase();
    ctx.strokeText(text, p.sx, y);
    ctx.fillStyle = th.label;
    ctx.fillText(text, p.sx, y);
    // barra de assinatura na cor da galaxia sob o titulo
    const barW = ctx.measureText(text).width;
    ctx.fillStyle = gal.color;
    ctx.globalAlpha = (eng.search.set ? 0.3 : 0.55) * cfade;
    ctx.fillRect(p.sx - barW / 2, y + 13.5, barW, 1.4);
    ctx.globalAlpha = (eng.search.set ? 0.45 : 0.9) * cfade;
    ctx.font = `9px ${th.canvasFont}`;
    // FX inbox-detritos: badge "N no pátio" no lugar de "N notas".
    const sub = (eng._skyFx && gal.inbox)
      ? `${gal.count} no pátio`
      : `${gal.count} nota${gal.count === 1 ? '' : 's'}`;
    const y2 = y + 16;
    ctx.strokeText(sub, p.sx, y2);
    ctx.fillStyle = th.labelDim;
    ctx.fillText(sub, p.sx, y2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Sub-aglomerados (F5.9-v2): label discreto do subgrupo na posicao do
// cluster, mesma f(t) das notas (angle0 + omega*time) — o label acompanha
// a rotacao do grumo; reduced-motion congela eng.time, fica estatico.
// So aparece com zoom proximo (k > 0.9) e cluster com 5+ notas.
function drawSubClusterLabels(eng) {
  const { ctx, dpr, cam, universe } = eng;
  const th = eng.themeColors;
  const clusters = universe.subClusters;
  if (!clusters || !clusters.length || cam.k <= SUB_LABEL_MIN_K) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `8px ${th.canvasFont}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = th.labelStroke;
  ctx.fillStyle = th.labelDim;
  const subBase = eng.search.set ? 0.45 : 0.9;
  ctx.globalAlpha = subBase;
  for (const sc of clusters) {
    // Guard de referencia stale: engine recriado pode trocar o universe
    // com um frame em voo — cluster sem galaxy valida nao desenha.
    if (!sc || !sc.galaxy || sc.count < SUB_LABEL_MIN_COUNT) continue;
    const cfade = constellationFade(eng, sc.galaxy); // F-const: serif do modulo assume
    if (cfade <= 0.02) continue;
    ctx.globalAlpha = subBase * cfade;
    const ang = sc.angle0 + sc.omega * eng.time;
    const wx = sc.galaxy.cx + Math.cos(ang) * sc.radius;
    const wy = sc.galaxy.cy + Math.sin(ang) * sc.radius;
    const p = project(eng, wx, wy, sc.galaxy.cz || 0);
    ctx.strokeText(sc.label, p.sx, p.sy);
    ctx.fillText(sc.label, p.sx, p.sy);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Billboard do label de nota (chamado de dentro do transform-mundo por
// drawCenterSun/drawEgo): salva o transform, vai pra screen-space, projeta
// o anchor e desenha reto; restaura o transform-mundo ao sair.
function drawLabel(eng, n, text, big) {
  const { ctx, dpr } = eng;
  const th = eng.themeColors;
  const p = project(eng, n.px, n.py, n.pz || 0);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${big ? 12 : 10}px ${th.canvasFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const y = p.sy + n.r * p.scale + 6;
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;
  ctx.strokeStyle = th.labelStroke;
  ctx.strokeText(text, p.sx, y);
  ctx.fillStyle = big ? th.labelStrong : th.label;
  ctx.fillText(text, p.sx, y);
  ctx.restore();
}

// Flares da API highlight() (F4: sonda achou o arquivo): halo expandindo + anel
// ripple por cima de tudo. Progresso pelo now do drawFrame; ok com reduced-motion.
function drawFlares(eng, now) {
  const ts = Number.isFinite(now) ? now : performance.now();
  for (const f of eng.flares) drawFlare(eng, f, ts);
  eng.ctx.globalAlpha = 1;
}

// W3: o flare projeta o no (px,py,pz) e desenha em SCREEN space; raios em
// mundo × pp.scale, lineWidth em px de tela. Salva/restaura o transform.
function drawFlare(eng, f, now) {
  const { ctx, dpr } = eng;
  const n = f.node;
  const pp = project(eng, n.px, n.py, n.pz || 0);
  const sc = pp.scale;
  const p = clamp((now - f.start) / f.ttl, 0, 1);
  const fade = 1 - p * p;
  const base = Math.max(n.r, 2);
  const halo = base * (3.2 + p * 1.4) * sc;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (eng.additiveBloom) ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.65 * fade;
  ctx.drawImage(haloSprite(f.color), pp.sx - halo, pp.sy - halo, halo * 2, halo * 2);
  if (eng.additiveBloom) ctx.globalCompositeOperation = 'source-over';
  const cycle = eng.reduced ? 0.45 : ((now - f.start) % FLARE_RING_MS) / FLARE_RING_MS;
  ctx.globalAlpha = (1 - cycle) * 0.85 * fade;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(pp.sx, pp.sy, base * (1.6 + cycle * 7) * sc, 0, TAU);
  ctx.stroke();
  ctx.restore();
}
