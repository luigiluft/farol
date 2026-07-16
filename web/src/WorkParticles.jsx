// FAROL - WorkParticles (Q4-C + Q5): integra a FROTA com o GRAFO sem tocar
// no render loop do engine. Usa SÓ a api pública do universo (worldToScreen,
// shipScreenPoint, hasNode, highlight) num overlay-canvas com rAF próprio —
// mesmo padrão de resiliência do FleetOverlay (pausa com aba oculta; re-checa
// de leve quando o engine não devolve pontos).
//   Q4-C: cada SUBAGENTE ativo vira uma partícula que viaja da nave do agente
//         até o NÓ do vault que ele edita (currentAction.vaultPath). Mostra o
//         trabalho fluindo do agente pro vault.
//   Q5:   o nó que está sendo trabalhado PULSA na cor do projeto, via a api
//         highlight() (halo + anel já testados no engine), re-disparada num
//         intervalo pra ficar aceso enquanto o agente trabalha ali.
// Regras: canvas anima sozinho; pointer-events none (não rouba clique dos
// chips); zero alocação por frame (pools em refs); guard total na api.
import { useEffect, useRef } from 'react';
import { projectColor, isAwaiting } from './roomData.js';
import { swarmSessions } from './swarm-model.js';

const PARTICLE_CAP = 6;        // partículas por sessão (1 por subagente, teto)
const SPEED_PXMS = 0.00045;    // fração do caminho por ms (~2.2s ponta a ponta)
const HIGHLIGHT_TTL_MS = 1500; // duração de cada flare do nó ativo
const HIGHLIGHT_EVERY_MS = 1100; // re-dispara o flare (mantém o nó aceso)
const ENGINE_RETRY_MS = 500;
const SWARM_OMEGA = 0.0006;   // rad/ms da orbita do enxame
const TAU = Math.PI * 2;

// Sessões TRABALHANDO (ativa, não esperando) cujo vaultPath existe no grafo.
function workNodes(sessions, api) {
  const out = [];
  if (!Array.isArray(sessions) || !api || typeof api.hasNode !== 'function') return out;
  for (const s of sessions) {
    if (!s || s.state !== 'ativa' || isAwaiting(s)) continue;
    const vp = s.currentAction && s.currentAction.vaultPath;
    if (!vp) continue;
    let ok = false;
    try { ok = api.hasNode(vp); } catch { ok = false; }
    if (!ok) continue;
    const subs = (Array.isArray(s.subagents) ? s.subagents : []).filter((x) => x && x.active !== false).length;
    out.push({ id: s.id, vaultPath: vp, color: projectColor(s.project), subs });
  }
  return out;
}

function safePoint(fn, arg) {
  if (typeof fn !== 'function') return null;
  try {
    const p = fn(arg);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.onScreen !== false ? p : null;
  } catch {
    return null;
  }
}

// easing suave nas pontas (parte devagar da nave, chega devagar no nó).
function ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// Ajusta o pool de partículas de uma sessão pro alvo (1 por subagente, teto),
// com fase escalonada pra elas não saírem todas grudadas.
function fitPool(pool, target) {
  while (pool.length < target) {
    pool.push({ t: pool.length / Math.max(1, target), v: 0.85 + (pool.length % 3) * 0.12 });
  }
  if (pool.length > target) pool.length = target;
  return pool;
}

// Um frame: pra cada sessão trabalhando, desenha as partículas nave->nó.
function drawParticles(ctx, dpr, sessions, api, pools, dtMs) {
  const nodes = workNodes(sessions, api);
  const live = new Set();
  for (const w of nodes) {
    live.add(w.id);
    const ship = safePoint(api.shipScreenPoint, w.id);
    const node = safePoint(api.worldToScreen, w.vaultPath);
    if (!ship || !node) continue;
    const target = Math.min(PARTICLE_CAP, Math.max(1, w.subs || 1));
    const pool = fitPool(pools.get(w.id) || (pools.set(w.id, []), pools.get(w.id)), target);
    for (const p of pool) {
      p.t += SPEED_PXMS * p.v * dtMs;
      if (p.t > 1) p.t -= 1;
      const e = ease(p.t);
      const x = (ship.x + (node.x - ship.x) * e) * dpr;
      const y = (ship.y + (node.y - ship.y) * e) * dpr;
      // fade nas pontas: nasce na nave, some ao tocar o nó
      const a = Math.sin(p.t * Math.PI);
      const r = (1.9 + 1.6 * a) * dpr;
      ctx.globalAlpha = 0.3 + 0.6 * a;
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      // núcleo claro
      ctx.globalAlpha = 0.5 * a;
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.4, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // limpa pools de sessões que sumiram
  for (const id of pools.keys()) if (!live.has(id)) pools.delete(id);
}

// Desenha o enxame: N drones orbitando o ponto da nave (3 aneis), verde vivo
// (ativo) vs dim (ocioso recente). Orbita deterministica por indice+tempo.
function drawSwarm(ctx, dpr, sessions, api, now) {
  for (const w of swarmSessions(sessions, isAwaiting)) {
    const ship = safePoint(api.shipScreenPoint, w.id);
    if (!ship) continue;
    const color = projectColor(w.project);
    const n = w.subs.length;
    for (let i = 0; i < n; i += 1) {
      const ring = i % 3;
      const rad = (26 + ring * 12) * dpr;
      const ang = (i / n) * TAU + now * SWARM_OMEGA * (1 - ring * 0.15);
      const x = ship.x * dpr + Math.cos(ang) * rad;
      const y = ship.y * dpr + Math.sin(ang) * rad * 0.6;
      const live = w.subs[i].active !== false;
      ctx.globalAlpha = live ? 0.95 : 0.4;
      ctx.fillStyle = live ? color : '#5d6b78';
      if (live) { ctx.shadowColor = color; ctx.shadowBlur = 6 * dpr; }
      ctx.beginPath();
      ctx.arc(x, y, (live ? 2.4 : 1.8) * dpr, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
}

export default function WorkParticles({ sessions, apiRef, follow = false }) {
  const canvasRef = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const poolsRef = useRef(new Map());
  const lastFocusRef = useRef(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Q5: marca os nós ativos no engine (foco: escurece o resto + arestas
  // vivas) e re-dispara o flare num intervalo (mantém o nó aceso/pulsando).
  // follow: a câmera acompanha o nó ativo PRIMÁRIO quando ele MUDA (não a
  // cada tick — não briga com pan/zoom do usuário); some o foco quando zera.
  useEffect(() => {
    const tick = () => {
      const api = apiRef && apiRef.current;
      if (!api) return;
      const nodes = workNodes(sessionsRef.current, api);
      if (typeof api.setActiveNodes === 'function') {
        try { api.setActiveNodes(nodes.map((w) => w.vaultPath)); } catch { /* api parcial */ }
      }
      if (typeof api.highlight === 'function') {
        for (const w of nodes) {
          try { api.highlight(w.vaultPath, { color: w.color, ttlMs: HIGHLIGHT_TTL_MS }); } catch { /* api parcial */ }
        }
      }
      if (followRef.current && typeof api.focus === 'function') {
        const primary = nodes.length ? nodes.map((w) => w.vaultPath).sort()[0] : null;
        if (primary !== lastFocusRef.current) {
          lastFocusRef.current = primary;
          if (primary) { try { api.focus(primary, { zoom: 1.4 }); } catch { /* api parcial */ } }
        }
      }
    };
    tick();
    const t = setInterval(tick, HIGHLIGHT_EVERY_MS);
    return () => clearInterval(t);
  }, [apiRef]);

  // Q4-C: rAF próprio do overlay de partículas (resiliente como o FleetOverlay).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let timer = 0;
    let stopped = false;
    let last = performance.now();

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      return dpr;
    };

    function frame(now) {
      raf = 0;
      const api = apiRef && apiRef.current;
      if (!api || typeof api.listShipPoints !== 'function' || api.listShipPoints() === null) {
        timer = setTimeout(arm, ENGINE_RETRY_MS); // engine morto: re-checa leve
        return;
      }
      const dt = Math.min(64, now - last);
      last = now;
      const dpr = sizeCanvas();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawParticles(ctx, dpr, sessionsRef.current, api, poolsRef.current, dt);
      drawSwarm(ctx, dpr, sessionsRef.current, api, now);
      arm();
    }
    function arm() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (stopped || raf || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function onVis() {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else arm();
    }
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [apiRef]);

  return (
    <canvas
      ref={canvasRef}
      className="work-particles"
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 2,
      }}
    />
  );
}
