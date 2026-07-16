// FAROL - graph-constellation.js (F-const): drill-down de galaxia em modo
// CONSTELACAO estilo B1 (mock aprovado em web/mock-constelacao/variant-b.js).
// Sub-clusters por subpasta radiais ao redor do hub da galaxia (disco
// girassol por cluster), TODOS os wikilinks reais intra-galaxia visiveis
// (3 tiers de alpha da B1), nos neutros creme com hub na cor da galaxia,
// rotulos serif caps, marca-d'agua gigante e grade pontilhada.
//
// LAYOUT: puro e deterministico (mesmo input -> mesmo output), memoizado por
// galaxia (WeakMap) -- NUNCA recomputado por frame. layoutConstellation() nao
// toca DOM/storage e roda em Node (check em mock-constelacao/check-constellation.mjs).
// DRAW: chamado pelo drawFrame (graph-draw.js) nos pontos certos; recebe a
// project() do engine por parametro (importar graph-engine aqui puxaria
// fleet-draw, que registra listener de tema no import -> quebraria o check Node).
// Kill-switch: localStorage torre.skyConstellation='off' (default ON) devolve
// o rendering atual exato -- todos os ramos integrados sao no-op com ct=0.
// Performance: nenhum gradiente/blur por frame; grade baked em sprite por
// viewport/tema; halos via haloSprite cacheado; poucos Path2D por frame.
import { TAU, clamp, hash32, mulberry32, haloSprite, hexToRgba } from './graph-universe.js';
import { getTheme } from './theme.js';

// ---------------------------------------------------------------- flag

// Espelha o padrao isTidySky (graph-universe): default ON, so 'off' desliga;
// try/catch porque storage pode lancar (modo privado) -> cai no default.
export function isSkyConstellationOn() {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('torre.skyConstellation') !== 'off';
  } catch (err) {
    return true;
  }
}

// Forca 0..1 do modo constelacao: entra na MESMA proximidade do planetMode do
// drawSuns (lod 0.6, onde o planeta vira sol) e chega a 1 com as notas plenas
// (lod 1). Zoom-out => 0 => ceu identico ao atual.
const CONST_START_LOD = 0.6;
export function constellationStrength(eng) {
  if (!isSkyConstellationOn()) return 0;
  if (!eng.universe || eng.universe.mode !== 'global') return 0;
  const lod = eng._noteLOD ?? 0;
  return clamp((lod - CONST_START_LOD) / (1 - CONST_START_LOD), 0, 1);
}

// Constelacao NAO se aplica ao Inbox (patio de detritos em qualquer zoom).
export function isConstellationGalaxy(gal) {
  return Boolean(gal) && !gal.inbox;
}

// ---------------------------------------------------------------- paleta

// Nos neutros: creme B1 no dark; no light o creme some no ceu claro, entao os
// nos viram tom ink/ardosia (mesma familia dos tokens label do canvas light).
// NOTA: hoje o drawFrame forca render dark (F3b) -- o ramo light fica pronto
// para o dia em que o override cair, seguindo o padrao das LIGHT_* do draw.
const PALETTES = {
  dark: {
    node: '232, 226, 212', // #e8e2d4 creme dessaturado (B1)
    cross: '139, 155, 170',
    text: '#c9d4dd',
    dim: '#5d6b78',
    title: '#e8eef3',
    grid: 'rgba(232, 238, 243, 0.028)',
    watermark: 'rgba(232, 238, 243, 0.05)',
  },
  light: {
    node: '42, 58, 74', // ink/ardosia: legivel sobre ceu claro
    cross: '70, 90, 110',
    text: '#3a4a5a',
    dim: '#67768a',
    title: '#15212e',
    grid: 'rgba(21, 33, 46, 0.05)',
    watermark: 'rgba(21, 33, 46, 0.06)',
  },
};

export function constellationPalette(theme) {
  return PALETTES[theme] || PALETTES.dark;
}

// ---------------------------------------------------------------- layout puro

// Constantes em "px de mock" (a B1 foi desenhada num viewport 1600x950); o
// layout inteiro e re-escalado no final para caber no disco da galaxia
// (gal.radius), guardando o fator em unit para o draw escalar os raios.
const MIN_CLUSTER = 2; // subpasta com < 2 notas cai no cluster "outros"
const GOLDEN = 2.399963267;
const CL_R_BASE = 24;
const CL_R_SQRT = 13;
const CL_DIST = 170;
const CL_GAP = 46;
const CL_CENTER_MIN = 150;
const CL_WEIGHT_PAD = 55;
// Alongamento horizontal leve em mundo: com o tilt da camera (~0.85 em y) a
// razao em TELA fica ~1.65, o mesmo enquadramento eliptico da B1 (1.62/0.98).
const STRETCH_X = 1.4;
const STRETCH_Y = 1.0;
const RELAX_ITERS = 160;
const EXTENT_PAD = 34; // respiro pros rotulos na borda do disco

export function subfolderOf(group, id) {
  const norm = String(id).replace(/\\/g, '/');
  if (!norm.startsWith(`${group}/`)) return '(raiz)';
  const rest = norm.slice(group.length + 1);
  const cut = rest.indexOf('/');
  return cut === -1 ? '(raiz)' : rest.slice(0, cut);
}

function displayName(sub) {
  return sub
    .replace(/^[_\s]+/, '')
    .replace(/[-_]+/g, ' ')
    .toUpperCase();
}

// Raio do ponto-nota em px de mock (B1 noteRadius), derivado do raio-mundo
// n.r (1.6..7.5) em vez do row.size cru (que o universo ja consumiu).
function noteDotRadius(r) {
  const rr = Number(r) || 1.6;
  return clamp(1.7 + (rr - 1.6) * 0.42, 1.7, 4.2);
}

function clusterRadius(count) {
  return CL_R_BASE + Math.sqrt(count) * CL_R_SQRT;
}

// Clusters por subpasta (pequenas -> "outros"), hub = no de maior grau
// intra-galaxia (desempate por raio e id, deterministico).
function buildClusters(group, notes, links) {
  const degree = new Map();
  for (const l of links) {
    degree.set(l.a, (degree.get(l.a) || 0) + 1);
    degree.set(l.b, (degree.get(l.b) || 0) + 1);
  }
  const bySub = new Map();
  for (const n of notes) {
    const sub = subfolderOf(group, n.id);
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub).push(n);
  }
  const merged = new Map();
  for (const [sub, list] of bySub) {
    const key = list.length < MIN_CLUSTER ? 'outros' : sub;
    if (!merged.has(key)) merged.set(key, []);
    merged.get(key).push(...list);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([sub, list]) => {
      const ids = new Set(list.map((n) => n.id));
      const edges = links.filter((l) => ids.has(l.a) && ids.has(l.b));
      const hub = [...list].sort(
        (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
          || (Number(b.r) || 0) - (Number(a.r) || 0)
          || (a.id < b.id ? -1 : 1),
      )[0];
      return { sub, name: displayName(sub), notes: list, ids, edges, hub };
    });
}

// Arco ponderado ao redor do centro da galaxia + relaxacao anti-sobreposicao
// + repulsao do miolo (espaco pro centro B1). Deterministico: iteracoes fixas,
// zero rng. Coordenadas locais da galaxia (origem no centro), px de mock.
function placeClusters(clusters) {
  const weights = clusters.map((c) => clusterRadius(c.notes.length) + CL_WEIGHT_PAD);
  const total = weights.reduce((s, x) => s + x, 0) || 1;
  let acc = 0;
  const placed = clusters.map((c, i) => {
    const rc = clusterRadius(c.notes.length);
    const arc = (weights[i] / total) * TAU;
    const ang = -Math.PI / 2 + acc + arc / 2;
    acc += arc;
    const dist = CL_DIST + rc;
    return {
      ...c,
      rc,
      x: Math.cos(ang) * dist * STRETCH_X,
      y: Math.sin(ang) * dist * STRETCH_Y,
    };
  });
  for (let it = 0; it < RELAX_ITERS; it += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const need = a.rc + b.rc + CL_GAP;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < need) {
          const push = (need - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
    for (const c of placed) {
      const d = Math.hypot(c.x, c.y) || 1;
      const min = CL_CENTER_MIN + c.rc;
      if (d < min) {
        c.x = (c.x / d) * min;
        c.y = (c.y / d) * min;
      }
    }
  }
  return placed;
}

// Nos do cluster em disco girassol (angulo aureo), hub no centro (B1).
function placeNotes(group, cluster, pos) {
  const rng = mulberry32(hash32(`const:${group}/${cluster.sub}`));
  const seed = rng() * TAU;
  pos.set(cluster.hub.id, { x: cluster.x, y: cluster.y, cr: noteDotRadius(cluster.hub.r) });
  const others = cluster.notes.filter((n) => n.id !== cluster.hub.id);
  others.forEach((n, i) => {
    const rr = cluster.rc * (0.3 + 0.7 * Math.sqrt((i + 1) / Math.max(others.length, 1)));
    const th = seed + i * GOLDEN + (rng() - 0.5) * 0.09;
    pos.set(n.id, {
      x: cluster.x + Math.cos(th) * rr,
      y: cluster.y + Math.sin(th) * rr * 0.88,
      cr: noteDotRadius(n.r),
    });
  });
}

// Spanning tree greedy por distancia (B1 fillTree): SO para cluster sem
// NENHUM link real -- ponte sintetica que da forma de constelacao.
function bridgeTree(notes, pos) {
  const parent = new Map(notes.map((n) => [n.id, n.id]));
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(x, r);
    return r;
  };
  const extra = [];
  for (;;) {
    const roots = new Map();
    for (const n of notes) {
      const r = find(n.id);
      if (!roots.has(r)) roots.set(r, []);
      roots.get(r).push(n);
    }
    if (roots.size <= 1) break;
    const comps = [...roots.values()];
    const base = comps[0];
    let best = null;
    for (let c = 1; c < comps.length; c += 1) {
      for (const a of base) {
        for (const b of comps[c]) {
          const pa = pos.get(a.id);
          const pb = pos.get(b.id);
          const d = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
          if (!best || d < best.d) best = { d, a: a.id, b: b.id };
        }
      }
    }
    extra.push([best.a, best.b]);
    parent.set(find(best.a), find(best.b));
  }
  return extra;
}

// Layout PURO da constelacao de uma galaxia. input:
//   { group, radius, notes: [{ id, r }], links: [{ a, b }] } (links intra-galaxia)
// output (tudo em unidades de MUNDO, origem no centro da galaxia):
//   { clusters: [{ sub, name, hubId, count, x, y, rc }],
//     pos: Map(id -> { x, y, cr }), realEdges/crossEdges/bridgeEdges: [[a,b]],
//     stats: { notes, intraLinks, clusters }, unit }
export function layoutConstellation({ group, radius, notes, links }) {
  const clusters = buildClusters(group, notes, links);
  const placed = placeClusters(clusters);
  const pos = new Map();
  const bridgeEdges = [];
  const realEdges = [];
  for (const c of placed) {
    placeNotes(group, c, pos);
    if (c.edges.length === 0 && c.notes.length >= 2) {
      bridgeEdges.push(...bridgeTree(c.notes, pos));
    }
    for (const l of c.edges) realEdges.push([l.a, l.b]);
  }
  const clusterOf = new Map();
  placed.forEach((c, i) => {
    for (const id of c.ids) clusterOf.set(id, i);
  });
  const crossEdges = [];
  for (const l of links) {
    const ca = clusterOf.get(l.a);
    const cb = clusterOf.get(l.b);
    if (ca !== undefined && cb !== undefined && ca !== cb) crossEdges.push([l.a, l.b]);
  }
  // fit: re-escala o layout inteiro pra caber no disco da galaxia.
  let extent = 1;
  for (const p of pos.values()) {
    const d = Math.hypot(p.x, p.y) + p.cr + EXTENT_PAD;
    if (d > extent) extent = d;
  }
  const unit = (Number(radius) > 0 ? radius : extent) / extent;
  for (const p of pos.values()) {
    p.x *= unit;
    p.y *= unit;
    p.cr *= unit;
  }
  const outClusters = placed.map((c) => ({
    sub: c.sub,
    name: c.name,
    hubId: c.hub.id,
    count: c.notes.length,
    x: c.x * unit,
    y: c.y * unit,
    rc: c.rc * unit,
  }));
  return {
    clusters: outClusters,
    pos,
    realEdges,
    crossEdges,
    bridgeEdges,
    stats: { notes: notes.length, intraLinks: links.length, clusters: placed.length },
    unit,
  };
}

// --------------------------------------------------- memo por galaxia (app)

// WeakMap por objeto-galaxia: rebuild do universo cria galaxias novas e o
// cache velho evapora sozinho. Decoracao dos nodes (_constX/_constY/_constR/
// _constHub) acontece UMA vez aqui; o apply por frame so lerpa.
const layoutCache = new WeakMap();

function galaxyLayout(universe, gal) {
  let lay = layoutCache.get(gal);
  if (lay) return lay;
  const noteRefs = [];
  for (const n of universe.nodes) {
    if (n.galaxy === gal && n.kind === 'note') noteRefs.push(n);
  }
  const links = [];
  for (const l of universe.links) {
    if (l.same && l.a.galaxy === gal) links.push({ a: l.a.id, b: l.b.id });
  }
  lay = layoutConstellation({
    group: gal.group,
    radius: gal.radius,
    notes: noteRefs.map((n) => ({ id: n.id, r: n.r })),
    links,
  });
  for (const n of noteRefs) {
    const p = lay.pos.get(n.id);
    n._constX = p.x;
    n._constY = p.y;
    n._constR = p.cr;
    n._constHub = false;
  }
  const byId = universe.nodeById;
  lay.noteRefs = noteRefs;
  lay.hubRefs = lay.clusters.map((c) => byId.get(c.hubId));
  for (const h of lay.hubRefs) if (h) h._constHub = true;
  const toRefs = (pairs) => pairs.map(([a, b]) => [byId.get(a), byId.get(b)]);
  lay.realEdgeRefs = toRefs(lay.realEdges);
  lay.crossEdgeRefs = toRefs(lay.crossEdges);
  lay.bridgeEdgeRefs = toRefs(lay.bridgeEdges);
  layoutCache.set(gal, lay);
  return lay;
}

// Lerp orbita -> constelacao por ct, escrito em px/py/pz (fonte que o pick,
// o tooltip, a frota e todos os draws ja leem -> tudo permanece coerente).
// updatePositions recomputa a orbita a cada frame ANTES do drawFrame, entao
// a base do lerp e sempre fresca. pz esvai: a constelacao B1 e plana.
export function applyConstellationLayout(eng) {
  const ct = eng._constT ?? 0;
  if (ct <= 0) return;
  const u = eng.universe;
  for (const gal of u.galaxies) {
    if (isConstellationGalaxy(gal)) galaxyLayout(u, gal);
  }
  const inv = 1 - ct;
  for (const n of u.nodes) {
    if (n._constX === undefined || !isConstellationGalaxy(n.galaxy)) continue;
    n.px = n.px * inv + (n.galaxy.cx + n._constX) * ct;
    n.py = n.py * inv + (n.galaxy.cy + n._constY) * ct;
    n.pz = n.pz * inv;
  }
}

// ------------------------------------------- fades das camadas substituidas

// Helpers dos fades 1-ct que o graph-draw aplica nas camadas SUBSTITUIDAS
// pela constelacao (links default, sol, estrela-nota, labels mono). Todos
// leem eng._constT e devolvem neutro (1 / no-op) com ct=0 ou galaxia fora do
// modo (ex.: Inbox) -> render identico ao ceu atual.

// Fade por-galaxia (sol, label da galaxia, sub-label): a camada antiga esvai
// com 1-ct enquanto o modulo desenha o substituto B1. Callers pulam <= 0.02.
export function constellationFade(eng, gal) {
  const ct = eng._constT ?? 0;
  return ct > 0 && isConstellationGalaxy(gal) ? 1 - ct : 1;
}

// Fade da estrela-nota (drawNotes, nao-beacon): no morph esvai com 1-ct;
// plena (ct=1) devolve 0 -> caller pula (o ponto creme do modulo assume).
export function noteConstellationDim(eng, n) {
  const ct = eng._constT ?? 0;
  return ct > 0 && isConstellationGalaxy(n.galaxy) ? 1 - ct : 1;
}

// drawConstellations: links de galaxia em constelacao saem dos buckets de
// borda (o modulo desenha as arestas B1); durante o morph (0<ct<1) esvaem
// num Path2D proprio. claim(l) = true quando o link e de galaxia em
// constelacao (e ja o acumula no path de fade, projetando aqui — project()
// devolve objeto fresco); stroke() traceja com base*(1-ct), no-op fora do morph.
export function constellationLinkFader(eng, project) {
  const ct = eng._constT ?? 0;
  const path = ct > 0 && ct < 1 ? new Path2D() : null;
  return {
    claim(l) {
      if (!(ct > 0 && l.same && isConstellationGalaxy(l.a.galaxy))) return false;
      if (path) {
        const a = project(eng, l.a.px, l.a.py, l.a.pz);
        const b = project(eng, l.b.px, l.b.py, l.b.pz);
        path.moveTo(a.sx, a.sy);
        path.lineTo(b.sx, b.sy);
      }
      return true;
    },
    stroke(ctx, base) {
      if (!path) return;
      ctx.globalAlpha = base * (1 - ct);
      ctx.stroke(path);
    },
  };
}

// ---------------------------------------------------------------- draw

const SERIF = 'Georgia, "Times New Roman", serif';
// Alphas da B1 (tiers de aresta + no neutro).
const A_REAL = 0.2;
const A_CROSS = 0.038;
const A_BRIDGE = 0.075;
const A_SPOKE = 0.07;
const A_NODE = 0.85;
const SEARCH_DIM = 0.1; // mesmo dim do drawNotes p/ nao-hits na busca
const GRID_STEP = 26;

function galaxyOnScreen(eng, pc, gal) {
  const m = gal.radius * pc.scale + 260;
  return pc.sx > -m && pc.sy > -m && pc.sx < eng.w + m && pc.sy < eng.h + m;
}

// Galaxia "primaria" do mergulho (dona da marca-d'agua e da grade): a
// seguida pelo follow do engine, senao a mais proxima do centro do viewport.
// Follow numa galaxia INELEGIVEL (Inbox) => null: mergulho no patio fica
// sem grade/marca-d'agua (constelacao nao se aplica ao Inbox).
function primaryGalaxy(eng, project) {
  const fg = eng.followGalaxy;
  if (fg) return isConstellationGalaxy(fg) ? fg : null;
  let best = null;
  let bestD = Math.min(eng.w, eng.h) * 0.5;
  for (const gal of eng.universe.galaxies) {
    if (!isConstellationGalaxy(gal)) continue;
    const p = project(eng, gal.cx, gal.cy, gal.cz || 0);
    const d = Math.hypot(p.sx - eng.w / 2, p.sy - eng.h / 2);
    if (d < bestD) {
      bestD = d;
      best = gal;
    }
  }
  return best;
}

// Grade pontilhada baked por viewport/tema/dpr (1 drawImage por frame).
let gridCache = null;
function gridSprite(w, h, dpr, theme, color) {
  const key = `${theme}:${dpr}:${Math.round(w)}x${Math.round(h)}`;
  if (gridCache && gridCache.key === key) return gridCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.fillStyle = color;
  for (let gx = GRID_STEP; gx < w; gx += GRID_STEP) {
    for (let gy = GRID_STEP; gy < h; gy += GRID_STEP) {
      x.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
    }
  }
  gridCache = { key, canvas: c };
  return c;
}

// Fit da marca-d'agua (fonte + letter-spacing) cacheado por label/largura.
const wmCache = new Map();
function watermarkFit(ctx, label, w) {
  const key = `${label}|${Math.round(w)}`;
  const hit = wmCache.get(key);
  if (hit) return hit;
  if (wmCache.size > 12) wmCache.clear();
  ctx.letterSpacing = '9px';
  ctx.font = `700 100px ${SERIF}`;
  const base = ctx.measureText(label).width || 1;
  const size = Math.min(300, (100 * w * 0.86) / base);
  const fit = { size, ls: (size * 9) / 100 };
  wmCache.set(key, fit);
  return fit;
}

// Fundo do drill-down: grade pontilhada + marca-d'agua serif gigante da
// galaxia primaria. Screen-space, antes das camadas-mundo.
export function drawConstellationBackdrop(eng, project) {
  const ct = eng._constT ?? 0;
  if (ct <= 0.02) return;
  const { ctx, dpr } = eng;
  const pal = constellationPalette(getTheme());
  const gal = primaryGalaxy(eng, project);
  if (!gal) return; // sem galaxia primaria elegivel (ex.: foco no Inbox)
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = ct;
  ctx.drawImage(gridSprite(eng.w, eng.h, dpr, getTheme(), pal.grid), 0, 0, eng.w, eng.h);
  {
    const pc = project(eng, gal.cx, gal.cy, gal.cz || 0);
    const label = String(gal.label).toUpperCase();
    const fit = watermarkFit(ctx, label, eng.w);
    ctx.letterSpacing = `${fit.ls}px`;
    ctx.font = `700 ${fit.size}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.watermark;
    ctx.fillText(label, pc.sx, pc.sy - 6);
    ctx.letterSpacing = '0px';
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function addEdges(eng, project, path, refs) {
  for (const [a, b] of refs) {
    if (!a || !b) continue;
    const pa = project(eng, a.px, a.py, a.pz);
    const pb = project(eng, b.px, b.py, b.pz);
    path.moveTo(pa.sx, pa.sy);
    path.lineTo(pb.sx, pb.sy);
  }
}

// Arestas B1 (3 tiers + raios hub->cluster), um Path2D por tier somando
// todas as galaxias visiveis; 4 strokes no total. Substitui as constelacoes
// default dessas galaxias (drawConstellations as esvai com 1-ct).
export function drawConstellationLinks(eng, project) {
  const ct = eng._constT ?? 0;
  if (ct <= 0.02) return;
  const { ctx, dpr } = eng;
  const pal = constellationPalette(getTheme());
  const spokes = new Path2D();
  const real = new Path2D();
  const cross = new Path2D();
  const bridge = new Path2D();
  let any = false;
  for (const gal of eng.universe.galaxies) {
    if (!isConstellationGalaxy(gal)) continue;
    const pc = project(eng, gal.cx, gal.cy, gal.cz || 0);
    if (!galaxyOnScreen(eng, pc, gal)) continue;
    const lay = galaxyLayout(eng.universe, gal);
    any = true;
    for (const c of lay.clusters) {
      const d = Math.hypot(c.x, c.y) || 1;
      const ux = c.x / d;
      const uy = c.y / d;
      const trim = 30 * lay.unit;
      const a = project(eng, gal.cx + ux * trim, gal.cy + uy * trim, gal.cz || 0);
      const b = project(
        eng,
        gal.cx + c.x - ux * 10 * lay.unit,
        gal.cy + c.y - uy * 10 * lay.unit,
        gal.cz || 0,
      );
      spokes.moveTo(a.sx, a.sy);
      spokes.lineTo(b.sx, b.sy);
    }
    addEdges(eng, project, real, lay.realEdgeRefs);
    addEdges(eng, project, cross, lay.crossEdgeRefs);
    addEdges(eng, project, bridge, lay.bridgeEdgeRefs);
  }
  if (!any) return;
  const dimAll = (eng.search.set ? 0.55 : 1) * ct;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${pal.node}, ${A_SPOKE})`;
  ctx.globalAlpha = dimAll;
  ctx.stroke(spokes);
  ctx.strokeStyle = `rgba(${pal.cross}, ${A_CROSS})`;
  ctx.stroke(cross);
  ctx.strokeStyle = `rgba(${pal.node}, ${A_BRIDGE})`;
  ctx.stroke(bridge);
  ctx.strokeStyle = `rgba(${pal.node}, ${A_REAL})`;
  ctx.stroke(real);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Mesmo dim do drawNotes para nao-beacons (busca + foco Q5): a constelacao
// respeita busca/foco igual ao ceu normal. Beacons seguem no drawNotes.
function dotDim(eng, n, searching, fs) {
  const beacon = (eng.activeNodes && eng.activeNodes.has(n.id))
    || (searching && eng.search.set.has(n.id))
    || (eng.flashNode === n && eng.time < eng.flashUntil);
  let dim = searching && !beacon ? SEARCH_DIM : 1;
  if (fs && !beacon) dim *= fs.has(n.id) ? 0.8 : 0.16;
  return dim;
}

function drawClusterLabel(eng, ctx, pal, pc, c, pcl, alpha, mono) {
  const dx = pcl.sx - pc.sx;
  const dy = pcl.sy - pc.sy;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const rcs = c.rc * pcl.scale;
  ctx.font = `13px ${SERIF}`;
  ctx.letterSpacing = '3.5px';
  const tw = ctx.measureText(c.name).width;
  const lx = pcl.sx + ux * (rcs + 22 + (tw / 2) * Math.abs(ux));
  const ly = pcl.sy + uy * (rcs + 30);
  // Fora do viewport: PULA (clampar pra dentro empilhava rotulos de galaxias
  // vizinhas parcialmente visiveis na borda da tela).
  if (lx < tw / 2 + 24 || lx > eng.w - tw / 2 - 24 || ly < 40 || ly > eng.h - 40) {
    ctx.letterSpacing = '0px';
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pal.text;
  ctx.fillText(c.name, lx, ly);
  ctx.letterSpacing = '0px';
  ctx.font = `9.5px ${mono}`;
  ctx.fillStyle = pal.dim;
  ctx.fillText(`${c.count} nota${c.count === 1 ? '' : 's'}`, lx, ly + 15);
}

// Centro B1 da galaxia (substitui o sol, que o drawSuns esvai com 1-ct):
// halo + ponto + 2 aneis na cor da galaxia, titulo serif e stats.
function drawCenterHub(eng, ctx, pal, gal, lay, pc, sdim, ct, mono) {
  const u = lay.unit * pc.scale;
  const hs = 60 * u;
  ctx.globalAlpha = 0.3 * sdim * ct;
  ctx.drawImage(haloSprite(gal.color), pc.sx - hs, pc.sy - hs, hs * 2, hs * 2);
  ctx.globalAlpha = sdim * ct;
  ctx.fillStyle = gal.color;
  ctx.beginPath();
  ctx.arc(pc.sx, pc.sy, 8 * u, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(gal.color, 0.4);
  ctx.beginPath();
  ctx.arc(pc.sx, pc.sy, 17 * u, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(gal.color, 0.14);
  ctx.beginPath();
  ctx.arc(pc.sx, pc.sy, 27 * u, 0, TAU);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `16px ${SERIF}`;
  ctx.letterSpacing = '6px';
  ctx.fillStyle = pal.title;
  ctx.fillText(String(gal.label).toUpperCase(), pc.sx, pc.sy + 40 * u);
  ctx.letterSpacing = '0px';
  ctx.font = `10px ${mono}`;
  ctx.fillStyle = pal.dim;
  ctx.fillText(
    `${lay.stats.notes} notas · ${lay.stats.intraLinks} links`,
    pc.sx,
    pc.sy + 62 * u,
  );
}

// Nos da constelacao: pontos neutros creme (hub de sub-cluster na cor da
// galaxia, com halo cacheado), centro B1 e rotulos serif dos clusters.
// Chamado ANTES do drawNotes: beacons (busca/flash/agente) redesenham por cima.
export function drawConstellationNodes(eng, project) {
  const ct = eng._constT ?? 0;
  if (ct <= 0.02) return;
  const { ctx, dpr } = eng;
  const pal = constellationPalette(getTheme());
  const mono = eng.themeColors ? eng.themeColors.canvasFont : 'monospace';
  const searching = Boolean(eng.search.set);
  const fs = eng.focusSet;
  const sdim = searching ? 0.4 : 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const gal of eng.universe.galaxies) {
    if (!isConstellationGalaxy(gal)) continue;
    const pc = project(eng, gal.cx, gal.cy, gal.cz || 0);
    if (!galaxyOnScreen(eng, pc, gal)) continue;
    const lay = galaxyLayout(eng.universe, gal);
    // pontos neutros (sem halo: o brilho fica pros hubs e beacons).
    // Alpha SO no globalAlpha: A_NODE no fillStyle dobrava (0.85^2=0.72).
    ctx.fillStyle = `rgba(${pal.node}, 1)`;
    for (const n of lay.noteRefs) {
      if (n._constHub) continue;
      const p = project(eng, n.px, n.py, n.pz);
      ctx.globalAlpha = A_NODE * ct * dotDim(eng, n, searching, fs);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(n._constR * p.scale, 0.8), 0, TAU);
      ctx.fill();
    }
    // hubs de sub-cluster: cor da galaxia + halo + anel
    for (const h of lay.hubRefs) {
      if (!h) continue;
      const p = project(eng, h.px, h.py, h.pz);
      const dim = ct * dotDim(eng, h, searching, fs);
      const hu = lay.unit * p.scale;
      const hs = 26 * hu;
      ctx.globalAlpha = 0.28 * dim;
      ctx.drawImage(haloSprite(gal.color), p.sx - hs, p.sy - hs, hs * 2, hs * 2);
      ctx.globalAlpha = dim;
      ctx.fillStyle = gal.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, (h._constR + 2.4 * lay.unit) * p.scale, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexToRgba(gal.color, 0.35);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, (h._constR + 7 * lay.unit) * p.scale, 0, TAU);
      ctx.stroke();
    }
    drawCenterHub(eng, ctx, pal, gal, lay, pc, sdim, ct, mono);
    // rotulos serif caps + "N notas" dim (empurrados pra fora do disco)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const la = ct * (searching ? 0.45 : 0.95);
    for (const c of lay.clusters) {
      const pcl = project(eng, gal.cx + c.x, gal.cy + c.y, gal.cz || 0);
      drawClusterLabel(eng, ctx, pal, pc, c, pcl, la, mono);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
