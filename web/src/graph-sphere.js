// FAROL - CEREBRO esfera (refactor v2, F2a). Engine canvas 2D puro:
// notas do vault na CASCA de uma esfera 3D (fibonacci quase-uniforme em
// bandas por cluster PARA), links reais do grafo + malha-textura fraca
// intra-cluster, rotacao lenta com inercia, intro stagger, e movimento
// SO por evento real: arco viajante agente->nota, onda geodesica na
// chegada, pulso/flash. Agentes = marcadores ambar (rosa = esperando)
// ancorados no no do currentAction.vaultPath (sem path mapeado = sem
// marcador; nunca arco pra lugar errado — pin r3 do cross-review).
// Dark-forced por design (precedente F3b do universo); paleta editorial
// fixa abaixo, chrome do app segue o tema.
// Regras: zero DOM, zero fetch — quem alimenta e o Sphere.jsx.

const PAL = {
  void: '#08080a',
  body: 'rgba(14,14,17,.55)',
  cream: [236, 231, 219],
  amber: [217, 167, 95],
  wait: [255, 107, 157],
};
const CLUSTER_LABELS = {
  '1-Projects': 'PROJETOS', '3-Resources': 'RECURSOS', '8-System': 'SISTEMA',
  '6-Daily': 'DIÁRIO', '0-Inbox': 'INBOX', '2-Areas': 'ÁREAS',
  '5-Atlas': 'ATLAS', '7-Templates': 'TEMPLATES',
};
const GA = Math.PI * (3 - Math.sqrt(5));
const AUTO_OMEGA = (2 * Math.PI) / 90; // 1 volta / 90s
const F_PERSP = 3.4;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function easeOutBack(t) {
  const c1 = 1.70158; const c3 = c1 + 1;
  return 1 + c3 * ((t - 1) ** 3) + c1 * ((t - 1) ** 2);
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));
  const om = Math.acos(dot);
  if (om < 1e-4) return a;
  const so = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / so;
  const kb = Math.sin(t * om) / so;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}
// prng deterministico (cena estavel entre reloads)
function mulberry(seed0) {
  let seed = seed0 | 0;
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------
// modelo: /api/graph -> pontos na casca (bandas fibonacci por cluster)
// ------------------------------------------------------------------
export function buildSphereModel(graph) {
  const rnd = mulberry(7);
  const all = Array.isArray(graph?.nodes) ? graph.nodes : [];
  // notas = ids com '/' (folder/hub pseudo-nos ficam de fora; cluster os traduz)
  const notes = all.filter((n) => n && typeof n.id === 'string' && n.id.includes('/') && !n.archived);
  // clusters ordenados por tamanho (bandas maiores primeiro = distribuicao estavel)
  const byCluster = new Map();
  for (const n of notes) {
    const g = n.group || 'outros';
    if (!byCluster.has(g)) byCluster.set(g, []);
    byCluster.get(g).push(n);
  }
  const clusters = [...byCluster.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([group, list]) => ({ group, label: CLUSTER_LABELS[group] || group.toUpperCase(), count: list.length }));
  // fibonacci uniforme; nos em ORDEM de cluster -> bandas contiguas na espiral
  const ordered = clusters.flatMap((c) => byCluster.get(c.group));
  const N = ordered.length;
  const nodes = ordered.map((n, i) => {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GA * i;
    const p = norm([
      r * Math.cos(th) + (rnd() - 0.5) * 0.05,
      y + (rnd() - 0.5) * 0.05,
      r * Math.sin(th) + (rnd() - 0.5) * 0.05,
    ]);
    const size = Number(n.size) || 1;
    return {
      id: n.id, label: n.label || n.id, group: n.group, p,
      r: 0.7 + Math.min(1.6, Math.log2(1 + size) * 0.6),
      big: size >= 3.5,
      ci: clusters.findIndex((c) => c.group === (n.group || 'outros')),
    };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  // label no NO DO MEIO da banda (media de banda grande enrola a esfera e
  // cai no centro -> labels colidem; o meio da fatia e sempre um ponto real)
  let cursor = 0;
  clusters.forEach((c) => {
    const mid = Math.min(nodes.length - 1, cursor + Math.floor(c.count / 2));
    c.dir = nodes[mid] ? [...nodes[mid].p] : [0, 1, 0];
    cursor += c.count;
  });
  // links REAIS nota<->nota com DISTANCIA geodesica pre-computada: o vault
  // tem ~2.5k wikilinks e muitos cruzam a bola inteira (hairball). Curto
  // (d<0.9rad) = visivel; longo = sussurro que so acende no hover do cluster.
  const real = [];
  for (const l of (graph.links || [])) {
    const a = idx.get(l.source); const b = idx.get(l.target);
    if (a == null || b == null || a === b) continue;
    const pa = nodes[a].p; const pb = nodes[b].p;
    const dot = Math.max(-1, Math.min(1, pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2]));
    real.push([a, b, Math.acos(dot)]);
  }
  // malha-textura: 1 vizinho mais proximo INTRA-cluster, alpha reduzido (pin r3:
  // textura visualmente distinta de dado real). O(n^2) so no build (~800 nos, ok).
  const texture = [];
  const seen = new Set(real.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
  for (let i = 0; i < nodes.length; i += 1) {
    let best = -1; let bd = Infinity;
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j || nodes[j].ci !== nodes[i].ci) continue;
      const dx = nodes[i].p[0] - nodes[j].p[0];
      const dy = nodes[i].p[1] - nodes[j].p[1];
      const dz = nodes[i].p[2] - nodes[j].p[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) {
      const k = i < best ? `${i}-${best}` : `${best}-${i}`;
      if (!seen.has(k)) { seen.add(k); texture.push([i, best]); }
    }
  }
  return { nodes, idx, clusters, real, texture };
}

// ------------------------------------------------------------------
// engine
// ------------------------------------------------------------------
export function createSphere(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const onOpenNote = typeof opts.onOpenNote === 'function' ? opts.onOpenNote : null;
  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let model = { nodes: [], idx: new Map(), clusters: [], real: [], texture: [] };
  let W = 1; let H = 1; let DPR = 1;
  let yaw = 0.4; let pitch = -0.15; let zoom = 1;
  let vyaw = 0; let vpitch = 0;
  let dragging = false; let lx = 0; let ly = 0; let moved = 0;
  let mx = -1; let my = -1;
  let hoverC = null; let hoverNode = -1;
  let raf = 0; let tPage = performance.now();
  let focusTarget = null; // {yaw, pitch} — camera navega ate o no (focusPath)
  const pulses = []; const arcs = []; const waves = []; const flashes = new Map();
  // agentes: id -> { nodeI, wait, name, prevI }
  const agents = new Map();
  let P = []; // projecoes do frame corrente (hit-test)

  function resize() {
    const host = canvas.parentElement;
    if (!host) return;
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = host.clientWidth || 1; H = host.clientHeight || 1;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  }

  function rot(p) {
    const cy = Math.cos(yaw); const sy = Math.sin(yaw);
    const cp = Math.cos(pitch); const sp = Math.sin(pitch);
    const x = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    return [x, p[1] * cp - z1 * sp, p[1] * sp + z1 * cp];
  }
  function proj(q, R, cx, cyy) {
    const s = F_PERSP / (F_PERSP - q[2]);
    return [cx + q[0] * R * s, cyy - q[1] * R * s, s, q[2]];
  }

  // ---------------- eventos reais ----------------
  function firePulse(i) { if (i >= 0) pulses.push({ i, t0: performance.now() }); }
  // menor delta angular (evita dar a volta longa no lerp da camera)
  function angleDelta(to, from) {
    let d = (to - from) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }
  // ponte rail->esfera (nota 2): pulso no no de um path; foco = camera
  // navega ate trazer o no pra frente (cancelado por drag do usuario)
  function pulsePath(path) {
    const i = model.idx.get(path);
    if (i == null) return false;
    firePulse(i);
    flashes.set(i, performance.now());
    return true;
  }
  function focusPath(path) {
    const i = model.idx.get(path);
    if (i == null) return false;
    const p = model.nodes[i].p;
    const h = Math.hypot(p[0], p[2]);
    focusTarget = {
      yaw: Math.atan2(-p[0], p[2]),
      pitch: Math.max(-1.2, Math.min(1.2, Math.atan2(p[1], h))),
    };
    firePulse(i);
    flashes.set(i, performance.now());
    return true;
  }
  function fireArc(fromI, toI) {
    if (fromI < 0 || toI < 0 || fromI === toI) { firePulse(toI); return; }
    arcs.push({ a: model.nodes[fromI].p, b: model.nodes[toI].p, to: toI, t0: performance.now(), dur: 1300 });
  }

  // sessions -> marcadores + arcos por MUDANCA real de vaultPath (pin: path
  // nao mapeado = sem arco; pulso no marcador se existir)
  function setSessions(list) {
    const alive = new Set();
    for (const s of (Array.isArray(list) ? list : [])) {
      if (!s || !s.id || s.state === 'dormindo') continue;
      alive.add(s.id);
      const vp = s.currentAction && s.currentAction.vaultPath;
      const nodeI = vp != null && model.idx.has(vp) ? model.idx.get(vp) : -1;
      const prev = agents.get(s.id);
      const wait = !!s.awaitingInput;
      const name = s.name || s.topic || 'sessao';
      if (!prev) {
        agents.set(s.id, { nodeI, wait, name, prevI: nodeI });
        if (nodeI >= 0 && !reduced) firePulse(nodeI);
      } else {
        if (nodeI >= 0 && nodeI !== prev.nodeI) {
          if (!reduced) fireArc(prev.nodeI >= 0 ? prev.nodeI : nodeI, nodeI);
          prev.prevI = prev.nodeI;
          prev.nodeI = nodeI;
        }
        prev.wait = wait; prev.name = name;
      }
    }
    for (const id of [...agents.keys()]) if (!alive.has(id)) agents.delete(id);
  }

  function setData(graph) {
    model = buildSphereModel(graph);
    tPage = performance.now(); // re-intro suave no refetch
  }

  // ---------------- input ----------------
  function onDown(e) {
    dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
    vyaw = 0; vpitch = 0;
    focusTarget = null; // drag do usuario sempre vence o foco automatico
  }
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    mx = e.clientX - rect.left; my = e.clientY - rect.top;
    if (!dragging) return;
    const dy = (e.clientX - lx) * 0.0042; const dp = (e.clientY - ly) * 0.0032;
    moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
    yaw += dy; pitch = Math.max(-1.2, Math.min(1.2, pitch + dp));
    vyaw = dy; vpitch = dp; lx = e.clientX; ly = e.clientY;
  }
  function onUp() { dragging = false; }
  function onWheel(e) {
    e.preventDefault();
    zoom = Math.max(0.7, Math.min(1.8, zoom - e.deltaY * 0.0008));
  }
  function onClick() {
    if (moved > 6) return; // era drag, nao clique
    if (hoverNode >= 0 && onOpenNote) onOpenNote(model.nodes[hoverNode].id);
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onClick);

  // ---------------- render ----------------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!dragging && focusTarget) {
      // navegando ate o no em foco (ease exponencial; chegou = solta)
      const dy = angleDelta(focusTarget.yaw, yaw);
      const dp = focusTarget.pitch - pitch;
      yaw += dy * 0.10; pitch += dp * 0.10;
      if (Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01) focusTarget = null;
    } else if (!dragging && !reduced) {
      if (Math.abs(vyaw) > 0.0004 || Math.abs(vpitch) > 0.0004) {
        yaw += vyaw; pitch = Math.max(-1.2, Math.min(1.2, pitch + vpitch));
        vyaw *= 0.94; vpitch *= 0.90;
      } else yaw += AUTO_OMEGA / 60;
    }
    const R = Math.min(W, H) * 0.36 * zoom;
    const cx = W * 0.5; const cyy = H * 0.52;
    const introLinks = reduced ? 1 : clamp01((now - tPage - 500) / 1300);

    // halo + corpo + atmosfera no limbo
    const g = ctx.createRadialGradient(cx, cyy, R * 0.55, cx, cyy, R * 1.45);
    g.addColorStop(0, 'rgba(236,231,219,.05)');
    g.addColorStop(0.72, 'rgba(236,231,219,.015)');
    g.addColorStop(1, 'rgba(236,231,219,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(cx, cyy, R, 0, 7);
    ctx.fillStyle = PAL.body; ctx.fill();
    const rim = ctx.createRadialGradient(cx, cyy, R * 0.90, cx, cyy, R * 1.16);
    rim.addColorStop(0, 'rgba(236,231,219,0)');
    rim.addColorStop(0.62, 'rgba(236,231,219,.045)');
    rim.addColorStop(0.78, 'rgba(236,231,219,.02)');
    rim.addColorStop(1, 'rgba(236,231,219,0)');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cyy, R * 1.18, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cyy, R * 1.002, 0, 7);
    ctx.strokeStyle = 'rgba(236,231,219,.09)'; ctx.lineWidth = 1.3; ctx.stroke();

    const { nodes } = model;
    if (!nodes.length) return;

    // onda geodesica: bump viaja pela casca (links usam P => ondulam junto)
    for (let k = waves.length - 1; k >= 0; k -= 1) {
      if ((now - waves[k].t0) / 1500 > 1) waves.splice(k, 1);
    }
    P = nodes.map((n) => {
      let off = 0;
      for (const w of waves) {
        const t = (now - w.t0) / 1500;
        const dot = Math.max(-1, Math.min(1, n.p[0] * w.o[0] + n.p[1] * w.o[1] + n.p[2] * w.o[2]));
        const x = (Math.acos(dot) - t * 2.3) / 0.30;
        off += 0.06 * Math.exp(-x * x) * (1 - t);
      }
      return proj(rot(off ? n.p.map((v) => v * (1 + off)) : n.p), R, cx, cyy);
    });

    // links: reais (curto = visivel, longo = sussurro anti-hairball) +
    // textura (fraca) — hover no cluster acende os dele e esmaece o resto
    const drawLinks = (list, mult, hasDist) => {
      for (const entry of list) {
        const a = entry[0]; const b = entry[1];
        const za = P[a][3]; const zb = P[b][3];
        if (za < -0.05 && zb < -0.05) continue;
        const depth = (za + zb) / 2;
        // link longo cruza a bola: quase invisivel por padrao (whisper)
        const distMult = hasDist && entry[2] > 0.9 ? 0.12 : 1;
        let al = Math.max(0, 0.04 + (depth + 1) * 0.09) * introLinks * mult * distMult;
        if (hoverC != null) {
          const inC = nodes[a].ci === hoverC && nodes[b].ci === hoverC;
          al = inC ? al * (distMult < 1 ? 12 : 2.2) : al * 0.16;
        }
        if (al <= 0.004) continue;
        ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]);
        ctx.strokeStyle = `rgba(236,231,219,${Math.min(al, 0.5)})`;
        ctx.lineWidth = 0.7; ctx.stroke();
      }
    };
    drawLinks(model.texture, 0.4, false);
    drawLinks(model.real, 1, true);

    // nos (tier log; flash de chegada; hover-cluster esmaece o resto)
    let nearest = -1; let nd = 144; // 12px^2
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      const [x, y, s, z] = P[i];
      const depth = (z + 1) / 2;
      const ki = reduced ? 1 : clamp01((now - tPage - i * 3) / 650);
      if (ki <= 0) continue;
      const fl = flashes.get(i);
      let boost = 0;
      if (fl != null) {
        const ft = (now - fl) / 600;
        if (ft > 1) flashes.delete(i); else boost = 1 - ft;
      }
      let al = (0.10 + depth * 0.85 + (n.big ? 0.06 : 0))
        * (hoverC == null ? 1 : (n.ci === hoverC ? 1 : 0.22));
      al = Math.min(1, al * ki + boost * 0.5);
      const r = n.r * (0.7 + depth * 1.1) * s * 0.9 * (reduced ? 1 : easeOutBack(ki)) + boost * 1.6;
      ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.2), 0, 7);
      ctx.fillStyle = `rgba(236,231,219,${al})`; ctx.fill();
      // hit-test do hover (so frente)
      if (z > 0 && mx >= 0) {
        const dx = mx - x; const dy2 = my - y;
        const d = dx * dx + dy2 * dy2;
        if (d < nd) { nd = d; nearest = i; }
      }
    }
    hoverNode = nearest;

    // arcos viajantes (cabeca + rastro na casca)
    for (let k = arcs.length - 1; k >= 0; k -= 1) {
      const A = arcs[k];
      const t = (now - A.t0) / A.dur;
      if (t >= 1) {
        firePulse(A.to); flashes.set(A.to, now);
        if (!reduced) waves.push({ o: nodes[A.to].p, t0: now });
        arcs.splice(k, 1);
        continue;
      }
      const head = Math.min(t * 1.15, 1);
      const tail = Math.max(0, head - 0.30);
      ctx.beginPath();
      for (let u = 0; u <= 10; u += 1) {
        const tt = tail + (head - tail) * (u / 10);
        const q = rot(slerp(A.a, A.b, tt).map((v) => v * 1.03));
        const [x, y] = proj(q, R, cx, cyy);
        if (u === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(217,167,95,${0.55 * (1 - t * 0.4)})`;
      ctx.lineWidth = 1.2; ctx.stroke();
      const hq = rot(slerp(A.a, A.b, head).map((v) => v * 1.03));
      const [hx, hy, , hz] = proj(hq, R, cx, cyy);
      if (hz > -0.2) {
        ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, 7);
        ctx.fillStyle = 'rgba(236,231,219,.95)'; ctx.fill();
      }
    }

    // labels de cluster (serif espacada) + hit-test de hover
    ctx.textAlign = 'center';
    const labelPts = [];
    for (let ciX = 0; ciX < model.clusters.length; ciX += 1) {
      const c = model.clusters[ciX];
      const q = rot(norm(c.dir).map((v) => v * 1.12));
      if (q[2] < 0.05) continue;
      const [x, y] = proj(q, R, cx, cyy);
      labelPts.push({ x, y, ci: ciX });
      const hovered = hoverC === ciX;
      ctx.font = '400 12px Fraunces, Georgia, serif';
      ctx.fillStyle = `rgba(236,231,219,${hovered ? 0.85 : Math.min(0.5, 0.12 + q[2] * 0.4)})`;
      ctx.fillText(c.label.split('').join(' '), x, y);
    }
    hoverC = null;
    let overLabel = false;
    if (mx >= 0 && !dragging) {
      for (const lp of labelPts) {
        if (Math.abs(mx - lp.x) < 56 && Math.abs(my - lp.y) < 16) {
          hoverC = lp.ci; overLabel = true; break;
        }
      }
    }
    canvas.style.cursor = overLabel || hoverNode >= 0 ? 'pointer' : (dragging ? 'grabbing' : 'grab');

    // label da nota sob o cursor (nome curto; caminho no rail/nota ao abrir)
    if (hoverNode >= 0) {
      const [x, y] = P[hoverNode];
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(236,231,219,.85)';
      ctx.fillText(nodes[hoverNode].label, x + 9, y + 3);
    }

    // agentes na casca: ambar = trabalhando, rosa pulsante = esperando voce
    ctx.textAlign = 'left';
    for (const a of agents.values()) {
      if (a.nodeI < 0) continue;
      const [x, y, , z] = P[a.nodeI];
      if (z < -0.1) continue;
      const depth = (z + 1) / 2;
      const col = a.wait ? PAL.wait : PAL.amber;
      const pulse = a.wait && !reduced ? (0.6 + 0.4 * Math.sin(now / 280)) : 1;
      ctx.beginPath(); ctx.arc(x, y, (2.6 + depth * 1.6) * pulse, 0, 7);
      ctx.fillStyle = `rgba(${col},.95)`; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, (5.5 + depth * 2) * pulse, 0, 7);
      ctx.strokeStyle = `rgba(${col},.35)`; ctx.lineWidth = 1; ctx.stroke();
      if (z > 0.25) {
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = `rgba(${col},.8)`;
        ctx.fillText(a.wait ? `${a.name} · esperando` : a.name, x + 10, y + 3);
      }
    }

    // pulsos (anel expande e some)
    for (let k = pulses.length - 1; k >= 0; k -= 1) {
      const pu = pulses[k];
      const t = (now - pu.t0) / 1100;
      if (t > 1) { pulses.splice(k, 1); continue; }
      const [x, y] = P[pu.i];
      ctx.beginPath(); ctx.arc(x, y, 4 + t * 30, 0, 7);
      ctx.strokeStyle = `rgba(217,167,95,${(1 - t) * 0.7})`;
      ctx.lineWidth = 1.1; ctx.stroke();
    }
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    setData,
    setSessions,
    pulsePath,
    focusPath,
    resize,
    // estado exposto pro verify (motion-gate: yaw anda, arcos/ondas vivem)
    debug: () => ({ yaw, zoom, nodes: model.nodes.length, links: model.real.length, arcs: arcs.length, waves: waves.length, pulses: pulses.length, agents: agents.size }),
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
    },
  };
}
