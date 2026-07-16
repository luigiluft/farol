// FAROL - fleet-sprites.js (HD2, F7): sprites pixel-art da frota viva.
// Geracao 5.0 "Torre Clara": SPRITE_SCALE 3 (definicao interna triplicada)
// e cores de casco lidas do canvasTheme() NO BAKE -- a chave de cache ganha
// prefixo do tema corrente (getTheme()), entao troca de tema nunca serve
// sprite do tema errado (onThemeChange tambem zera o cache inteiro).
// Redesenhos F7: nave-mae fuselada em 2 tons com canopy de vidro, faixa
// DUPLA na cor do projeto e flame de motor em 2 frames (alpha steps; o
// draw alterna o frame); cargueiro com container modular, clamps e luz de
// re; drone mini-orbe com 2 asas curtas e olho led; sonda dardo com cauda;
// runas pixel do run 'skill' (biblioteca orbital). towerSprite/satSprite
// MIGRARAM para graph-station.js (W-GRAPH) -- nao existem mais aqui.
// F-art: CLASSES de silhueta por modelo (capitania/cruzador/fragata/scout) e
// toggle de chama (moving) -- ver shipSprite. O cruzador e o paintMother
// original intocado (kill-switch torre.fleetArt=off no draw fica identico).
// SHIP_LIGHTS espelha as coordenadas logicas novas (fleet-rites escala por
// sw/spec.w). Tudo baked UMA vez em canvas offscreen e cacheado em Map por
// chave -- nenhum canvas/gradiente criado por frame.
import { hexToRgba, mulberry32 } from './graph-universe.js';
import { getTheme, canvasTheme, onThemeChange } from './theme.js';

const SPRITE_SCALE = 3;
const GLYPH_LINES = 7;
const GLYPH_LINE_STEP = 9;
// F-art: 4 classes de casco x moving/parado x cor engrossam o estado estavel
// do cache; folga maior evita clears frequentes (holoGlyphs cresce por seed).
const CACHE_MAX = 384;

const cache = new Map();

// Tag do tema corrente memoizada (getTheme pode ler localStorage): troca
// de tema invalida a tag E o cache de sprites de uma vez so.
let themeTag = '';
onThemeChange(() => {
  themeTag = '';
  cache.clear();
});

function themeKey() {
  if (!themeTag) themeTag = getTheme() || 'dark';
  return themeTag;
}

// Retangulos logicos das "luzes" (cockpit + faixa/container) por variante,
// ATUALIZADOS em tandem com paintMother/paintCargo (F7). O power-down
// (fleet-rites) pisca esses retangulos por cima do sprite; w = largura
// logica do sprite.
export const SHIP_LIGHTS = {
  mother: { w: 52, cockpit: [34, 12, 6, 3], stripe: [7, 15, 34, 4] },
  cargo: { w: 36, cockpit: [24, 8, 4, 2], stripe: [11, 4, 12, 14] },
};

// Bake generico: canvas offscreen em 3x com coordenadas logicas. Cap
// simples de cache (holoGlyphs e chaveado por seed do node e cresceria sem
// limite): ao estourar CACHE_MAX zera TUDO e recomeca -- rebake e barato.
function bake(key, w, h, paint) {
  const full = `${themeKey()}:${key}`;
  if (cache.has(full)) return cache.get(full);
  if (cache.size >= CACHE_MAX) cache.clear();
  const c = document.createElement('canvas');
  c.width = w * SPRITE_SCALE;
  c.height = h * SPRITE_SCALE;
  const ctx = c.getContext('2d');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  paint(ctx);
  cache.set(full, c);
  return c;
}

function px(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Cor defensiva: payload parcial pode entregar color invalida/ausente.
function safeColor(color, T) {
  return typeof color === 'string' && color.startsWith('#') ? color : T.fallbackShip;
}

// Blit pixel-crisp centrado: desliga o smoothing SO durante o drawImage e
// restaura o valor ANTERIOR (nunca forca true: o resto do frame decide).
export function blitSprite(ctx, img, cx, cy, w, h) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.imageSmoothingEnabled = prev;
}

// Blit de regiao (source-rect): varredura do power-down, celulas do Zzz e
// celulas de runa do run 'skill'.
export function blitSpriteRegion(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prev;
}

// Flame de motor em 2 frames (alpha steps; frame 1 = chama mais longa).
function paintJet(ctx, color, x, cy, frame) {
  if (frame === 1) {
    px(ctx, hexToRgba(color, 0.5), x, cy - 3, 1, 6);
    px(ctx, hexToRgba(color, 0.95), x, cy - 2, 2, 4);
  } else {
    px(ctx, hexToRgba(color, 0.4), x, cy - 2, 1, 4);
    px(ctx, hexToRgba(color, 0.9), x, cy - 1, 2, 2);
  }
}

// Nave-mae 52x32 (F7): silhueta fuselada em 2 tons, canopy de vidro com
// brilho, 2 nacelles com flame de 2 frames, faixa DUPLA na cor do projeto,
// fileira de janelas e antena. lit=false apaga faixa, janelas e motores.
// flame=false (F-art: nave PARADA) apaga so os jatos/bocal/glow do motor,
// mantendo cockpit/faixa/janelas acesos (a nave esta ligada, so nao empurra).
function paintMother(ctx, T, color, lit, frame, flame) {
  // nacelles gemeas com aresta superior iluminada
  px(ctx, T.hullDark, 2, 3, 16, 6);
  px(ctx, T.hullLight, 2, 3, 16, 1);
  px(ctx, T.hullDark, 2, 23, 16, 6);
  px(ctx, T.hullLight, 2, 23, 16, 1);
  if (lit && flame) {
    paintJet(ctx, color, 0, 6, frame);
    paintJet(ctx, color, 0, 26, frame);
    px(ctx, hexToRgba(color, 0.8), 16, 5, 2, 2); // bocal quente
    px(ctx, hexToRgba(color, 0.8), 16, 25, 2, 2);
  }
  // pylons
  px(ctx, T.hullDark, 12, 9, 5, 2);
  px(ctx, T.hullDark, 12, 21, 5, 2);
  // antena
  px(ctx, T.hullDark, 24, 7, 1, 4);
  px(ctx, lit ? T.cockpit : T.cockpitOff, 24, 6, 1, 1);
  // casco fuselado: rampa de 3 tons
  px(ctx, T.hull, 6, 11, 36, 10);
  px(ctx, T.hullLight, 6, 11, 36, 2);
  px(ctx, T.hullDark, 6, 19, 36, 2);
  // nariz afunilado
  px(ctx, T.hull, 42, 13, 6, 6);
  px(ctx, T.hullLight, 42, 13, 6, 1);
  px(ctx, T.hullDark, 48, 14, 3, 4);
  // faixa DUPLA do projeto
  px(ctx, lit ? color : T.hullDark, 7, 15, 34, 1);
  px(ctx, lit ? hexToRgba(color, 0.55) : T.hullDark, 7, 18, 34, 1);
  // fileira de janelas
  const winColor = lit ? T.windowLit : T.cockpitOff;
  for (let i = 0; i < 4; i += 1) px(ctx, winColor, 10 + i * 6, 13, 2, 2);
  // canopy de vidro com caixilho e brilho
  px(ctx, T.hullDark, 33, 12, 1, 3);
  px(ctx, lit ? T.cockpit : T.cockpitOff, 34, 12, 6, 3);
  if (lit) px(ctx, T.windowLit, 35, 12, 2, 1);
  if (lit && flame) {
    px(ctx, hexToRgba(color, 0.85), 4, 13, 2, 6); // motor traseiro
    px(ctx, hexToRgba(color, 0.4), 2, 14, 2, 4);
  }
}

// Cargueiro 36x24 (kind tarefa, F7): container MODULAR na cor do projeto
// com clamps de fixacao, porta com tranca, luz de re e jatos com frame.
function paintCargo(ctx, T, color, lit, frame, flame) {
  // propulsores traseiros
  px(ctx, T.hullDark, 0, 6, 8, 4);
  px(ctx, T.hullLight, 0, 6, 8, 1);
  px(ctx, T.hullDark, 0, 14, 8, 4);
  px(ctx, T.hullLight, 0, 14, 8, 1);
  if (lit && flame) {
    px(ctx, hexToRgba(color, frame === 1 ? 0.95 : 0.65), 0, 7, 1, 2);
    px(ctx, hexToRgba(color, frame === 1 ? 0.95 : 0.65), 0, 15, 1, 2);
  }
  // corpo com rampa
  px(ctx, T.hull, 4, 8, 24, 8);
  px(ctx, T.hullLight, 4, 8, 24, 1);
  px(ctx, T.hullDark, 4, 14, 24, 2);
  // luz de re no rabo
  px(ctx, lit ? T.windowLit : T.cockpitOff, 4, 10, 1, 2);
  // nariz
  px(ctx, T.hull, 28, 10, 6, 4);
  px(ctx, T.hullDark, 33, 11, 3, 2);
  // container modular (2 modulos) com corrugacao
  const box = lit ? color : T.cargoOff;
  px(ctx, box, 11, 4, 12, 14);
  px(ctx, hexToRgba(T.hullDark, 0.5), 16, 4, 1, 14); // divisa dos modulos
  px(ctx, hexToRgba(T.hullDark, 0.3), 13, 4, 1, 14);
  px(ctx, hexToRgba(T.hullDark, 0.3), 20, 4, 1, 14);
  // clamps de fixacao (4 garras com aresta)
  px(ctx, T.hullDark, 10, 3, 3, 2);
  px(ctx, T.hullDark, 21, 3, 3, 2);
  px(ctx, T.hullLight, 10, 3, 3, 1);
  px(ctx, T.hullLight, 21, 3, 3, 1);
  px(ctx, T.hullDark, 10, 17, 3, 2);
  px(ctx, T.hullDark, 21, 17, 3, 2);
  // porta do container com tranca
  px(ctx, T.hullDark, 13, 8, 5, 6);
  px(ctx, lit ? T.windowLit : T.cockpitOff, 14, 9, 1, 1);
  // cockpit
  px(ctx, lit ? T.cockpit : T.cockpitOff, 24, 8, 4, 2);
  if (lit && flame) {
    px(ctx, hexToRgba(color, 0.85), 2, 10, 2, 4);
    px(ctx, hexToRgba(color, 0.4), 0, 11, 2, 2);
  }
}

// F-art: CLASSES de silhueta por modelo (FORMA = INFORMACAO). O cruzador
// (opus) e o paintMother original -- flag OFF fica byte-a-byte igual. As
// outras 3 sao variacoes na MESMA linguagem 8-bit (2 tons de casco, canopy,
// faixa, janelas, nacelle com jato), so mudam proporcao/tamanho/nº de motores.

// CAPITANIA (fable) 60x34: a nave-mae esticada -- fuselagem mais longa, casco
// 2px mais alto, 2 nacelles afastadas, 5 janelas e nariz destacado. Le "pesada".
function paintCapitania(ctx, T, color, lit, frame, flame) {
  px(ctx, T.hullDark, 2, 3, 18, 7);
  px(ctx, T.hullLight, 2, 3, 18, 1);
  px(ctx, T.hullDark, 2, 24, 18, 7);
  px(ctx, T.hullLight, 2, 24, 18, 1);
  if (lit && flame) {
    paintJet(ctx, color, 0, 7, frame);
    paintJet(ctx, color, 0, 27, frame);
    px(ctx, hexToRgba(color, 0.8), 18, 6, 2, 2);
    px(ctx, hexToRgba(color, 0.8), 18, 26, 2, 2);
  }
  px(ctx, T.hullDark, 14, 10, 6, 2); // pylons
  px(ctx, T.hullDark, 14, 22, 6, 2);
  px(ctx, T.hullDark, 28, 7, 1, 5); // antena
  px(ctx, lit ? T.cockpit : T.cockpitOff, 28, 6, 1, 1);
  px(ctx, T.hull, 6, 12, 44, 11); // fuselagem longa
  px(ctx, T.hullLight, 6, 12, 44, 2);
  px(ctx, T.hullDark, 6, 21, 44, 2);
  px(ctx, T.hull, 50, 14, 7, 7); // nariz
  px(ctx, T.hullLight, 50, 14, 7, 1);
  px(ctx, T.hullDark, 57, 15, 3, 5);
  px(ctx, lit ? color : T.hullDark, 8, 16, 42, 1); // faixa dupla
  px(ctx, lit ? hexToRgba(color, 0.55) : T.hullDark, 8, 20, 42, 1);
  const winC = lit ? T.windowLit : T.cockpitOff;
  for (let i = 0; i < 5; i += 1) px(ctx, winC, 12 + i * 7, 14, 2, 2);
  px(ctx, T.hullDark, 40, 13, 1, 4); // canopy
  px(ctx, lit ? T.cockpit : T.cockpitOff, 41, 13, 7, 4);
  if (lit) px(ctx, T.windowLit, 42, 13, 2, 1);
  if (lit && flame) {
    px(ctx, hexToRgba(color, 0.85), 4, 14, 2, 7);
    px(ctx, hexToRgba(color, 0.4), 2, 15, 2, 5);
  }
}

// FRAGATA (sonnet) 46x26: casco mais FINO e alongado, 1 nacelle central,
// asas finas, 3 janelas, faixa unica -- le "leve/rapida" ao lado do cruzador.
function paintFragata(ctx, T, color, lit, frame, flame) {
  px(ctx, T.hullDark, 2, 10, 15, 6); // nacelle central
  px(ctx, T.hullLight, 2, 10, 15, 1);
  if (lit && flame) {
    paintJet(ctx, color, 0, 13, frame);
    px(ctx, hexToRgba(color, 0.8), 15, 12, 2, 2);
  }
  px(ctx, T.hull, 5, 9, 30, 8); // fuselagem fina
  px(ctx, T.hullLight, 5, 9, 30, 1);
  px(ctx, T.hullDark, 5, 16, 30, 1);
  px(ctx, T.hullDark, 10, 6, 12, 1); // asas finas
  px(ctx, T.hullDark, 10, 19, 12, 1);
  px(ctx, T.hull, 35, 10, 6, 6); // nariz
  px(ctx, T.hullLight, 35, 10, 6, 1);
  px(ctx, T.hullDark, 41, 11, 3, 4);
  px(ctx, lit ? color : T.hullDark, 6, 12, 29, 1); // faixa unica
  const winC = lit ? T.windowLit : T.cockpitOff;
  for (let i = 0; i < 3; i += 1) px(ctx, winC, 9 + i * 6, 11, 2, 2);
  px(ctx, T.hullDark, 28, 10, 1, 3); // canopy
  px(ctx, lit ? T.cockpit : T.cockpitOff, 29, 10, 5, 3);
  if (lit) px(ctx, T.windowLit, 30, 10, 1, 1);
  if (lit && flame) px(ctx, hexToRgba(color, 0.85), 3, 11, 2, 4);
}

// SCOUT (haiku) 32x22: minuscula e agil, 1 nacelle, aletas curtas, 2 janelas,
// sem antena. A menor silhueta -- le "leve" de longe so pelo tamanho.
function paintScout(ctx, T, color, lit, frame, flame) {
  px(ctx, T.hullDark, 2, 8, 11, 6); // nacelle
  px(ctx, T.hullLight, 2, 8, 11, 1);
  if (lit && flame) {
    paintJet(ctx, color, 0, 11, frame);
    px(ctx, hexToRgba(color, 0.8), 12, 10, 2, 2);
  }
  px(ctx, T.hull, 4, 7, 18, 8); // corpo curto
  px(ctx, T.hullLight, 4, 7, 18, 1);
  px(ctx, T.hullDark, 4, 14, 18, 1);
  px(ctx, T.hullDark, 7, 5, 7, 1); // aletas curtas
  px(ctx, T.hullDark, 7, 16, 7, 1);
  px(ctx, T.hull, 22, 8, 5, 6); // nariz
  px(ctx, T.hullDark, 27, 9, 3, 4);
  px(ctx, lit ? color : T.hullDark, 5, 10, 17, 1); // faixa
  const winC = lit ? T.windowLit : T.cockpitOff;
  for (let i = 0; i < 2; i += 1) px(ctx, winC, 8 + i * 5, 9, 2, 2);
  px(ctx, lit ? T.cockpit : T.cockpitOff, 17, 8, 4, 2); // canopy compacto
  if (lit) px(ctx, T.windowLit, 18, 8, 1, 1);
  if (lit && flame) px(ctx, hexToRgba(color, 0.85), 3, 9, 2, 4);
}

// Registro das classes NAO-cruzador: dims logicas + painter. cruzador
// (opus/desconhecido) cai no paintMother original (chave separada abaixo).
const MOTHER_SPECS = {
  capitania: { w: 60, h: 34, paint: paintCapitania },
  fragata: { w: 46, h: 26, paint: paintFragata },
  scout: { w: 32, h: 22, paint: paintScout },
};

// Escala de TAMANHO por classe (o fleet-draw multiplica o base px). Fonte
// unica compartilhada com o draw: capitania pesa (1.25x), scout e leve (0.7x).
const SHIP_CLASS_SCALE = { capitania: 1.25, cruzador: 1, fragata: 0.9, scout: 0.7 };
export function shipClassScale(cls) {
  return SHIP_CLASS_SCALE[cls] || 1;
}

// Sprite da nave por classe/variante. cls define a silhueta (mother);
// moving=false apaga a chama (nave parada). Cargo degrada elegante: UMA
// silhueta (a escala de tamanho por classe vem do draw, nao da silhueta).
// frame 0|1 so alterna a chama quando moving (baked, o draw escolhe).
export function shipSprite(color, variant, frame = 0, cls = 'cruzador', moving = true) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  const isCargo = variant === 'cargo';
  const flame = moving === true;
  const f = flame && frame === 1 ? 1 : 0; // sem chama => frame fixo 0
  const spec = MOTHER_SPECS[cls]; // undefined => cruzador (paintMother original)
  const clsKey = isCargo ? 'cargo' : (spec ? cls : 'cruzador');
  const key = `ship:${clsKey}:${col}:${flame ? 'm' : 's'}:${f}`;
  if (isCargo) return bake(key, 36, 24, (ctx) => paintCargo(ctx, T, col, true, f, flame));
  if (spec) return bake(key, spec.w, spec.h, (ctx) => spec.paint(ctx, T, col, true, f, flame));
  return bake(key, 52, 32, (ctx) => paintMother(ctx, T, col, true, f, flame));
}

// Variante adormecida: mesmo casco com todas as luzes apagadas -- independe
// da cor E da classe (degrada elegante: 1 silhueta base por variante, o que
// mantem SHIP_LIGHTS/fleet-rites validos). Chave fixa por variante.
export function shipSleepSprite(variant) {
  const T = canvasTheme();
  const isCargo = variant === 'cargo';
  const key = `ship-sleep:${isCargo ? 'cargo' : 'mother'}`;
  return isCargo
    ? bake(key, 36, 24, (ctx) => paintCargo(ctx, T, T.fallbackShip, false, 0, false))
    : bake(key, 52, 32, (ctx) => paintMother(ctx, T, T.fallbackShip, false, 0, false));
}

// Drone 16x16 (F7): mini-orbe com 2 asas curtas na cor, antena e olho led.
export function droneSprite(color) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  return bake(`drone:${col}`, 16, 16, (ctx) => {
    // asas curtas com ponta esmaecida
    px(ctx, hexToRgba(col, 0.35), 0, 6, 2, 4);
    px(ctx, hexToRgba(col, 0.8), 2, 7, 3, 2);
    px(ctx, hexToRgba(col, 0.35), 14, 6, 2, 4);
    px(ctx, hexToRgba(col, 0.8), 11, 7, 3, 2);
    // antena
    px(ctx, T.hullDark, 7, 2, 1, 2);
    px(ctx, col, 7, 1, 1, 1);
    // orbe com rampa de 3 tons (cantos arredondados em pixel)
    px(ctx, T.hull, 5, 4, 6, 8);
    px(ctx, T.hull, 4, 5, 8, 6);
    px(ctx, T.hullLight, 5, 4, 6, 1);
    px(ctx, T.hullDark, 5, 11, 6, 1);
    // olho led com brilho
    px(ctx, T.hullDark, 6, 6, 5, 4);
    px(ctx, col, 7, 7, 3, 2);
    px(ctx, T.cockpit, 7, 7, 1, 1);
  });
}

// Sonda 20x20 (F7): dardo na cor com cauda de propulsao em degraus,
// aletas, nucleo claro e ponta brilhante.
export function probeSprite(color) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  return bake(`probe:${col}`, 20, 20, (ctx) => {
    // cauda em degraus de alpha
    px(ctx, hexToRgba(col, 0.25), 0, 9, 2, 2);
    px(ctx, hexToRgba(col, 0.55), 2, 9, 3, 2);
    // aletas
    px(ctx, hexToRgba(col, 0.7), 6, 6, 3, 2);
    px(ctx, hexToRgba(col, 0.7), 6, 12, 3, 2);
    // corpo-dardo afunilando
    px(ctx, col, 5, 8, 10, 4);
    px(ctx, hexToRgba(col, 0.85), 15, 9, 3, 2);
    px(ctx, T.cockpit, 18, 9, 1, 2); // ponta
    // nucleo
    px(ctx, T.hullDark, 8, 8, 3, 4);
    px(ctx, T.cockpit, 9, 9, 2, 2);
  });
}

// 'z' pixel: barra superior, diagonal e barra inferior.
function paintZ(ctx, color, x0, y0, size) {
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, size, 1);
  for (let i = 0; i < size - 2; i += 1) {
    ctx.fillRect(x0 + size - 2 - i, y0 + 1 + i, 1, 1);
  }
  ctx.fillRect(x0, y0 + size - 1, size, 1);
}

// Zzz pixel: 3 tamanhos de 'z' em celulas horizontais de 16x16 logicos
// (6/8/10 px); o draw escolhe a celula via blitSpriteRegion
// (largura da celula = img.width / 3).
export function zzzSprite(color) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  return bake(`zzz:${col}`, 48, 16, (ctx) => {
    paintZ(ctx, col, 5, 5, 6);
    paintZ(ctx, col, 20, 4, 8);
    paintZ(ctx, col, 35, 3, 10);
  });
}

// Runa pixel por celula 12x12 (3 formas distintas, indexadas por kind).
function paintRune(ctx, color, ox, kind) {
  ctx.fillStyle = color;
  if (kind === 0) {
    // raio-runa: tres tracos em zigue
    ctx.fillRect(ox + 5, 2, 2, 3);
    ctx.fillRect(ox + 4, 5, 2, 2);
    ctx.fillRect(ox + 6, 7, 2, 3);
  } else if (kind === 1) {
    // olho-runa: losango com nucleo
    ctx.fillRect(ox + 5, 2, 2, 2);
    ctx.fillRect(ox + 3, 4, 2, 4);
    ctx.fillRect(ox + 7, 4, 2, 4);
    ctx.fillRect(ox + 5, 8, 2, 2);
    ctx.fillRect(ox + 5, 5, 2, 2);
  } else {
    // chave-runa: cruz com pe
    ctx.fillRect(ox + 5, 2, 2, 6);
    ctx.fillRect(ox + 3, 4, 6, 2);
    ctx.fillRect(ox + 4, 9, 4, 1);
  }
}

// Folha de runas 36x12 (3 celulas de 12x12) do run 'skill': o draw blita
// uma celula por glifo via blitSpriteRegion e gira via ctx.rotate.
export function runeSprite(color) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  return bake(`rune:${col}`, 36, 12, (ctx) => {
    paintRune(ctx, col, 0, 0);
    paintRune(ctx, hexToRgba(col, 0.85), 12, 1);
    paintRune(ctx, col, 24, 2);
  });
}

// Glifos do holo-livro 56x68 (v2, F7): 7 linhas de dashes pseudo-texto em
// 2 cores -- a cor do run (accent) e a cor de label do tema para os dashes
// "highlight". Larguras/gaps/alphas deterministicos por seed (mulberry32):
// mesmo node gera sempre o mesmo glifo.
export function holoGlyphs(color, seed) {
  const T = canvasTheme();
  const col = safeColor(color, T);
  const s = (Number(seed) || 0) >>> 0;
  return bake(`glyphs:${col}:${s}`, 56, 68, (ctx) => {
    const rng = mulberry32(s);
    const bright = hexToRgba(T.labelStrong, 0.92);
    for (let line = 0; line < GLYPH_LINES; line += 1) {
      const y = 8 + line * GLYPH_LINE_STEP;
      let x = 6;
      while (x < 48) {
        const w = Math.min(3 + Math.floor(rng() * 9), 50 - x);
        ctx.fillStyle = rng() < 0.16 ? bright : hexToRgba(col, 0.45 + rng() * 0.45);
        ctx.fillRect(x, y, w, 3);
        x += w + 2 + Math.floor(rng() * 4);
      }
    }
  });
}
