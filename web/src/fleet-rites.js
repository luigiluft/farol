// FAROL - fleet-rites.js (P2, F5.7): ritos de passagem da frota viva.
// Adormecer: power-down de 1.6s (cockpit/faixa piscam 2x e apagam,
// varredura vertical de escurecimento desce pelo casco, anel encolhe pro
// cinza), depois Zzz pixel continuo e ancora de luz na vaga de hangar.
// Encerrar: warp-out dramatico (charge -> stretch -> afterglow) quando a
// sessao estava ativa/ociosa, dissolve silencioso quando ja dormia.
// Tudo derivado dos timestamps do model (sleepAt/gone/goneState) -- zero
// estado proprio, zero alocacao por frame, nenhum gradiente/canvas novo
// (sprites baked de fleet-sprites + haloSprite cacheado). Consumido
// apenas por fleet-draw.js (ownership P2). Contratos: SPEC-F5.md F5.7.
// F7: BASE px espelham os novos tamanhos do fleet-draw (26/18/9) e as
// cores fixas (fallback, anel do sono, poeira, flash de cockpit) saem do
// canvasTheme() -- lookup barato por chamada, nunca por particula.
import { TAU, clamp, haloSprite } from './graph-universe.js';
import {
  shipSprite, shipSleepSprite, droneSprite, zzzSprite,
  blitSprite, blitSpriteRegion, SHIP_LIGHTS,
} from './fleet-sprites.js';
import { canvasTheme } from './theme.js';

const POWER_DOWN_MS = 1600;
const BLINK_WINDOW_MS = 600; // 2 piscas de 150ms (on/off) e apaga
const BLINK_STEP_MS = 150;
const SLEEP_ALPHA = 0.55; // espelha o estado dormindo continuo do draw
const WARP_CHARGE_MS = 500; // 0-500ms: drones sugados + halo + squash
const WARP_STRETCH_MS = 900; // 500-900ms: estica e desloca pra vaga
const WARP_END_MS = 2200; // 900-2200ms: anel de flash + residuos
const DISSOLVE_MS = 1200;
const ANCHOR_ALPHA = 0.08;
const ZZZ_CYCLE_S = 4; // ciclo ~4s por slot, fase derivada de bobPhase
const BASE_MOTHER_PX = 26; // espelha o sizing zoom-compensado do draw (F7)
const BASE_CARGO_PX = 18;
const BASE_DRONE_PX = 9;
const SIZE_MIN = 8;
const SIZE_MAX = 44;

function variantOf(ship) {
  return ship.variant === 'cargo' ? 'cargo' : 'mother';
}

function shipSize(ship, k) {
  const base = ship.variant === 'cargo' ? BASE_CARGO_PX : BASE_MOTHER_PX;
  return clamp(base / k, SIZE_MIN, SIZE_MAX);
}

// ------------------------------------------------------------- adormecer

// Power-down em andamento? (sleepAt ausente = model antigo: sem rito)
export function sleepRiteActive(ship, now) {
  return Boolean(ship.sleepAt) && now - ship.sleepAt < POWER_DOWN_MS;
}

// Multiplicador de alpha do sono: rampa 1 -> 0.55 durante o power-down,
// 0.55 fixo depois (e sempre, com reduced ou sem sleepAt).
export function sleepDim(ship, now, reduced) {
  if (reduced || !ship.sleepAt) return SLEEP_ALPHA;
  const t = clamp((now - ship.sleepAt) / POWER_DOWN_MS, 0, 1);
  return 1 - (1 - SLEEP_ALPHA) * t;
}

// Rito de adormecer (1.6s a partir de sleepAt), tudo derivado de
// now - sleepAt, zero estado extra. alpha ja vem com a rampa do sleepDim.
export function drawSleepRite(eng, ship, x, y, sw, now, alpha) {
  const { ctx } = eng;
  const t = clamp((now - ship.sleepAt) / POWER_DOWN_MS, 0, 1);
  const sprite = shipSprite(ship.color, variantOf(ship));
  const h = sw * (sprite.height / sprite.width);
  drawPowerRing(eng, ship, x, y, sw, t);
  ctx.globalAlpha = alpha;
  blitSprite(ctx, sprite, x, y, sw, h);
  drawPowerSweep(eng, ship, x, y, sw, h, t, alpha);
  const ms = now - ship.sleepAt;
  if (ms < BLINK_WINDOW_MS && Math.floor(ms / BLINK_STEP_MS) % 2 === 0) {
    drawShipLights(eng, ship, x, y, sw, h, 0.95);
  }
}

// Anel do estado anterior encolhe e esmaece enquanto o anel cinza do
// sono assume -- steps de alpha por frame, sem tween caro.
function drawPowerRing(eng, ship, x, y, sw, t) {
  const { ctx, cam } = eng;
  const T = canvasTheme();
  ctx.lineWidth = 1.2 / cam.k;
  ctx.strokeStyle = ship.color || T.fallbackShip;
  ctx.globalAlpha = 0.4 * (1 - t);
  ctx.beginPath();
  ctx.arc(x, y, sw * (0.95 - 0.29 * t), 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = T.ringSleep;
  ctx.globalAlpha = 0.15 * t;
  ctx.beginPath();
  ctx.arc(x, y, sw * 0.66, 0, TAU);
  ctx.stroke();
}

// Varredura vertical de escurecimento (janelas apagando): blit da fracao
// superior do sprite adormecido por cima do casco via source-rect --
// sem clip, sem gradiente, zero alocacao.
function drawPowerSweep(eng, ship, x, y, sw, h, t, alpha) {
  const sweep = clamp((t - 0.25) / 0.75, 0, 1);
  if (sweep <= 0) return;
  const dark = shipSleepSprite(variantOf(ship));
  const srcH = Math.max(1, Math.round(dark.height * sweep));
  eng.ctx.globalAlpha = Math.min(1, alpha + 0.2);
  blitSpriteRegion(
    eng.ctx, dark, 0, 0, dark.width, srcH,
    x - sw / 2, y - h / 2, sw, h * (srcH / dark.height),
  );
}

// Luzes do casco (cockpit + faixa/container) por cima do sprite, nos
// retangulos logicos espelhados de fleet-sprites (SHIP_LIGHTS).
function drawShipLights(eng, ship, x, y, sw, h, alpha) {
  const spec = SHIP_LIGHTS[variantOf(ship)];
  if (!spec) return;
  const { ctx } = eng;
  const T = canvasTheme();
  const u = sw / spec.w;
  const x0 = x - sw / 2;
  const y0 = y - h / 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ship.color || T.fallbackShip;
  const s = spec.stripe;
  ctx.fillRect(x0 + s[0] * u, y0 + s[1] * u, s[2] * u, s[3] * u);
  ctx.fillStyle = T.cockpit;
  const c = spec.cockpit;
  ctx.fillRect(x0 + c[0] * u, y0 + c[1] * u, c[2] * u, c[3] * u);
}

// Zzz pixel continuo: 3 slots fixos subindo em diagonal da nave, ciclo
// ~4s com fase derivada de bobPhase; celula (tamanho do z) cresce com a
// fase. Zero alocacao: sprite unico, posicao derivada de eng.time.
export function drawZzz(eng, ship, x, y, sw, alpha) {
  if (eng.reduced) return;
  const { ctx, cam } = eng;
  const img = zzzSprite(ship.color);
  const cw = img.width / 3;
  for (let i = 0; i < 3; i += 1) {
    const t = (eng.time / ZZZ_CYCLE_S + i / 3 + (ship.bobPhase || 0) / TAU) % 1;
    const cell = Math.min(2, Math.floor(t * 3));
    const s = clamp((6 + cell * 2) / cam.k, 3, 14);
    const zx = x + sw * (0.35 + t * 0.55);
    const zy = y - sw * (0.4 + t * 0.9);
    ctx.globalAlpha = alpha * 0.8 * Math.sin(t * Math.PI);
    blitSpriteRegion(ctx, img, cell * cw, 0, cw, img.height, zx - s / 2, zy - s / 2, s, s);
  }
}

// Ancora de luz: linha vertical sutil abaixo da nave atracada dormindo.
export function drawAnchor(eng, ship, x, y, sw) {
  const { ctx, cam } = eng;
  ctx.globalAlpha = ANCHOR_ALPHA;
  ctx.strokeStyle = ship.color || canvasTheme().fallbackShip;
  ctx.lineWidth = 1 / cam.k;
  ctx.beginPath();
  ctx.moveTo(x, y + sw * 0.55);
  ctx.lineTo(x, y + sw * 2.6);
  ctx.stroke();
}

// -------------------------------------------------------------- encerrar

// Rito de saida pelo estado NO MOMENTO do gone. Devolve false quando o
// model nao trouxe goneState (payload antigo): o draw faz o fade legado.
export function drawGoneRite(eng, ship, now) {
  if (ship.goneState === 'dormindo') {
    drawDissolve(eng, ship, now);
    return true;
  }
  if (ship.goneState === 'ativa' || ship.goneState === 'ociosa') {
    drawWarpOut(eng, ship, now);
    return true;
  }
  return false;
}

function drawWarpOut(eng, ship, now) {
  const ge = now - ship.gone;
  if (ge < 0 || ge >= WARP_END_MS) return;
  if (ge < WARP_CHARGE_MS) {
    drawWarpCharge(eng, ship, ge / WARP_CHARGE_MS);
  } else if (ge < WARP_STRETCH_MS) {
    drawWarpStretch(eng, ship, (ge - WARP_CHARGE_MS) / (WARP_STRETCH_MS - WARP_CHARGE_MS));
  } else {
    drawWarpAfter(eng, ship, (ge - WARP_STRETCH_MS) / (WARP_END_MS - WARP_STRETCH_MS));
  }
}

// Charge: halo da cor crescendo (sprite cacheado), drones sugados de
// volta e squash leve do casco via ctx.scale.
function drawWarpCharge(eng, ship, t) {
  const { ctx, cam } = eng;
  const sw = shipSize(ship, cam.k);
  const color = ship.color || canvasTheme().fallbackShip;
  const hs = sw * (0.7 + t * 1.1);
  ctx.globalAlpha = 0.2 + t * 0.45;
  ctx.drawImage(haloSprite(color), ship.x - hs, ship.y - hs, hs * 2, hs * 2);
  drawChargeDrones(eng, ship, sw, t);
  const sprite = shipSprite(color, variantOf(ship));
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.scale(1 + 0.08 * t, 1 - 0.08 * t);
  ctx.globalAlpha = 1;
  blitSprite(ctx, sprite, 0, 0, sw, sw * (sprite.height / sprite.width));
  ctx.restore();
}

// Drones sugados: orbita e escala -> 0 em direcao a nave durante o charge.
function drawChargeDrones(eng, ship, sw, t) {
  if (!Array.isArray(ship.drones) || !ship.drones.length) return;
  const { ctx, cam } = eng;
  const dw = clamp(BASE_DRONE_PX / cam.k, SIZE_MIN, SIZE_MAX) * (1 - t);
  if (dw <= 0.5) return;
  const orbit = sw * 1.05 * (1 - t);
  ctx.globalAlpha = 1 - t * 0.4;
  for (const d of ship.drones) {
    if (!d) continue;
    const ang = Number(d.angle) || 0;
    const dx = ship.x + Math.cos(ang) * orbit;
    const dy = ship.y + Math.sin(ang) * orbit;
    blitSprite(ctx, droneSprite(ship.color), dx, dy, dw, dw);
  }
}

// Warp: casco estica (scaleX 2.5 -> 6) com alpha caindo, deslocando na
// direcao da vaga de hangar; streak = haloSprite esticado no mesmo eixo.
function drawWarpStretch(eng, ship, t) {
  const { ctx, cam } = eng;
  const sw = shipSize(ship, cam.k);
  const color = ship.color || canvasTheme().fallbackShip;
  const dx = (Number(ship.hx) || 0) - ship.x;
  const dy = (Number(ship.hy) || 0) - ship.y;
  const ang = Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : (ship.bobPhase || 0);
  const dist = t * t * sw * 5;
  const scaleX = 2.5 + 3.5 * t;
  const alpha = 0.1 + 0.8 * (1 - t);
  const sprite = shipSprite(color, variantOf(ship));
  ctx.save();
  ctx.translate(ship.x + Math.cos(ang) * dist, ship.y + Math.sin(ang) * dist);
  ctx.rotate(ang);
  const sl = sw * scaleX * 1.4;
  const sh = sw * 0.45;
  ctx.globalAlpha = alpha * 0.6;
  ctx.drawImage(haloSprite(color), -sl, -sh, sl * 2, sh * 2);
  ctx.scale(scaleX, 0.92);
  ctx.globalAlpha = alpha;
  blitSprite(ctx, sprite, 0, 0, sw, sw * (sprite.height / sprite.width));
  ctx.restore();
}

// After: anel de flash expandindo (estetica do flare-ring) + ate 6
// particulas residuais caindo -- procedurais por bobPhase, SEM tocar o
// pool de particulas do model.
function drawWarpAfter(eng, ship, t) {
  const { ctx, cam } = eng;
  const sw = shipSize(ship, cam.k);
  const color = ship.color || canvasTheme().fallbackShip;
  const fade = 1 - t;
  ctx.globalAlpha = fade * 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / cam.k;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, sw * (0.6 + t * 4.2), 0, TAU);
  ctx.stroke();
  ctx.fillStyle = color;
  const ps = clamp(1.6 / cam.k, 0.8, 2.4);
  for (let j = 0; j < 6; j += 1) {
    const a = (ship.bobPhase || 0) + (j / 6) * TAU;
    const d = sw * (0.4 + t * (1.2 + (j % 3) * 0.4));
    const fx = ship.x + Math.cos(a) * d;
    const fy = ship.y + Math.sin(a) * d + t * t * sw * 0.9;
    ctx.globalAlpha = fade * (0.5 - (j % 3) * 0.1);
    ctx.fillRect(fx - ps / 2, fy - ps / 2, ps, ps);
  }
}

// Dissolve silencioso (goneState dormindo): 1 pisca fraco das luzes e o
// casco se desfaz em quadradinhos de poeira subindo; 1.2s, sem warp.
function drawDissolve(eng, ship, now) {
  const ge = now - ship.gone;
  if (ge < 0 || ge >= DISSOLVE_MS) return;
  const t = ge / DISSOLVE_MS;
  const { ctx, cam } = eng;
  const sw = shipSize(ship, cam.k);
  const sprite = shipSleepSprite(variantOf(ship));
  const h = sw * (sprite.height / sprite.width);
  ctx.globalAlpha = (1 - t) * SLEEP_ALPHA;
  blitSprite(ctx, sprite, ship.x, ship.y, sw, h);
  if (ge < BLINK_STEP_MS) drawShipLights(eng, ship, ship.x, ship.y, sw, h, 0.35);
  ctx.fillStyle = canvasTheme().ringSleep; // poeira do dissolve
  const ps = clamp(1.8 / cam.k, 0.8, 2.6);
  for (let j = 0; j < 5; j += 1) {
    const fx = ship.x + ((j / 4) - 0.5) * sw * 0.9;
    const fy = ship.y - t * sw * (0.5 + (j % 3) * 0.35);
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.fillRect(fx - ps / 2, fy - ps / 2, ps, ps);
  }
}
