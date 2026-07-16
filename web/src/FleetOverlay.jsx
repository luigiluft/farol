// FAROL - FleetOverlay (W4, F5.4): camada DOM sobre o canvas da frota com
// 1 CHIP por nave e no maximo 1 CARTAO DE MISSAO expandido (selectedShip).
// React renderiza o conjunto so quando sessions muda; POSICAO e opacidade
// sao aplicadas imperativamente num rAF PROPRIO que le UMA vez por frame
// apiRef.current.listShipPoints() e escreve transform/opacity em refs por
// sessionId (zero setState por frame). O rAF pausa com document.hidden
// (visibilitychange) e quando listShipPoints devolve null/undefined (engine
// morto: re-checa de leve a cada 500ms via timeout, sem frame continuo).
// Contratos consumidos (com guard total, vizinhos rodam em paralelo):
// - api do universo (W3): listShipPoints() => [{id, x, y, k, onScreen,
//   state, color}] | null; followShip(id|null) — ambos opcionais.
// - sessions (App): payload normalizado; v2 sem currentAction/vaultPath/
//   secondsSinceEvent/subagents NAO quebra nada (cada campo tem fallback).
// Callbacks: onSelectShip(id|null) — o chip SEMPRE manda o id (re-click
// na MESMA nave NAO des-seleciona: TorreView converte re-select em
// followShip; contrato "Fase 2" da SPEC); fechar cartao = [x]/Esc/
// autoclose (estes mandam null). onOpenDossier({type:'session',
// sessionId}), onFocusNode(vaultPath).
// Esc fecha o cartao (listener so com cartao aberto); se a sessao do
// selectedShip sumir do payload, o cartao fecha sozinho (effect).
// Flip horizontal do cartao: medido ao abrir E re-medido em window
// resize (listener passivo vivo SO com cartao aberto); a mutacao de
// classe acontece so quando cruza a borda direita, nunca por frame.
// Clamp vertical (fix review medium): o rodape do cartao nunca afunda
// atras da hangar bar — altura do cartao e da viewport sao medidas
// junto do flip.width (open + resize), nunca por frame.
// Regras duras: DOM anima SO transform/opacity; funcoes <50 linhas; sem
// dependencia nova; sem console.log.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  flightCode, flightTime, fmtTokens, projectColor, rowStatus, shortModel, tokenPct,
} from './roomData.js';
import { callsign, droneCallsign, actionPhrase } from './callsigns.js';
import { ToolIcon, phraseOfAction } from './Dossier.jsx';
import MiniAvatar from './MiniAvatar.jsx';
import './fleet.css';

// chips somem no zoom-out total (naves viram so pontos no canvas)
const CHIP_MIN_K = 0.22;
// nave PARADA (ociosa/dormindo na doca) so ganha chip no MERGULHO real:
// no fit os chips das paradas empilhavam na DOCA (refino da decisao
// ship-hero de 02/07). 2.0 fica entre o fit (~1.0-1.35) e o alvo do dive
// (2.2); ativa/esperando seguem a regra geral.
const CHIP_PARKED_MIN_K = 2.0;
// chip paira ACIMA da nave (px de tela; SPEC: translate3d(x, y-28, 0))
const CHIP_OFFSET_Y = -28;
// espelha FLEET_CAPS.SHIPS do fleet-model (W1): nunca ha mais de 12 naves;
// sessions ja chegam ordenadas com a MESMA prioridade do model (api.js)
const CHIP_MAX = 12;
const CHIP_DIM_OPACITY = 0.45;
const CARD_W = 300;
const CARD_GAP_X = 16;
const CARD_GAP_Y = 14;
const CARD_EDGE_PAD = 8;
// clamp vertical do cartao: faixa reservada da hangar bar + folga
const HANGAR_H = 64;
const CARD_BOTTOM_PAD = 8;
// engine ausente/morto: rAF pausa e re-checa de leve
const ENGINE_RETRY_MS = 500;
const LOG_MAX = 10;
const DRONES_MAX = 12;

// tool -> classe de cor do badge do subagent (espelha o painel AgentOps):
// cyan leitura/web-fetch/mcp, violeta busca/skill, accent escrita, amber shell.
function droneToolClass(tool) {
  if (!tool) return 'st-idle';
  if (tool === 'WebSearch' || tool === 'Skill') return 'st-search';
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return 'st-write';
  if (tool === 'Bash' || tool === 'PowerShell') return 'st-shell';
  return 'st-read';
}

// ------------------------------------------------------------------
// helpers puros
// ------------------------------------------------------------------

// Leitura defensiva da api: pode nao existir, ser parcial ou lancar.
function safeListPoints(apiRef) {
  const api = apiRef ? apiRef.current : null;
  if (!api || typeof api.listShipPoints !== 'function') return null;
  try {
    const pts = api.listShipPoints();
    return Array.isArray(pts) ? pts : null;
  } catch {
    return null;
  }
}

function findPoint(pts, id) {
  if (!pts || !id) return null;
  for (let i = 0; i < pts.length; i += 1) {
    const pt = pts[i];
    if (pt && pt.id === id && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      return pt;
    }
  }
  return null;
}

function followShip(apiRef, id) {
  const api = apiRef ? apiRef.current : null;
  if (!api || typeof api.followShip !== 'function') return;
  try {
    api.followShip(id);
  } catch {
    // api parcial (W3 em paralelo): seguir e opcional, nada quebra
  }
}

// "ha 12s" / "ha 3min" / "ha 2h"; string vazia sem dado (payload v2).
function fmtAgo(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s)) return '';
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `ha ${v}s`;
  if (v < 3600) return `ha ${Math.floor(v / 60)}min`;
  return `ha ${Math.floor(v / 3600)}h`;
}

function fmtAgoTs(ts, now) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return '';
  return fmtAgo((now - t) / 1000);
}

// ------------------------------------------------------------------
// escrita imperativa por frame (transform/opacity only)
// ------------------------------------------------------------------

function chipOpacity(pt) {
  if (pt.onScreen === false) return 0;
  const k = Number(pt.k);
  if (Number.isFinite(k) && k < CHIP_MIN_K) return 0;
  const parked = pt.state === 'ociosa' || pt.state === 'dormindo';
  if (parked && Number.isFinite(k) && k < CHIP_PARKED_MIN_K) return 0;
  return pt.state === 'dormindo' ? CHIP_DIM_OPACITY : 1;
}

// So escreve no DOM quando o valor muda (cache por sessionId); chip
// invisivel nao pode capturar clique (pointer-events junto).
function setChipOpacity(el, id, value, cache) {
  if (cache.get(id) === value) return;
  cache.set(id, value);
  el.style.opacity = String(value);
  el.style.pointerEvents = value > 0 ? 'auto' : 'none';
}

function moveChip(el, pt) {
  // -50%/-100% centra o chip e ancora a base dele acima da nave
  el.style.transform = `translate3d(${pt.x.toFixed(1)}px, `
    + `${(pt.y + CHIP_OFFSET_Y).toFixed(1)}px, 0) translate(-50%, -100%)`;
}

// UI: chip nunca corta na borda da tela. Recebe o box JA medido (track.box,
// no ponto pt) + as dimensoes do overlay (track.rootW/H); devolve pt deslocado
// pra caixa caber inteira na vista. Sem dims medidas => pt cru.
const CHIP_EDGE_PAD = 6;
function clampChip(pt, box, track) {
  const W = track.rootW || 0;
  const H = track.rootH || 0;
  if (!W || !H) return pt;
  let dx = 0;
  let dy = 0;
  if (box.l < CHIP_EDGE_PAD) dx = CHIP_EDGE_PAD - box.l;
  else if (box.r > W - CHIP_EDGE_PAD) dx = (W - CHIP_EDGE_PAD) - box.r;
  if (box.t < CHIP_EDGE_PAD) dy = CHIP_EDGE_PAD - box.t;
  if (box.b > H - CHIP_EDGE_PAD) dy = Math.min(dy, (H - CHIP_EDGE_PAD) - box.b);
  return dx || dy ? { ...pt, x: pt.x + dx, y: pt.y + dy } : pt;
}

// Mede as dimensoes usadas pelo flip/clamp do cartao: largura/altura
// da viewport do overlay e altura REAL do cartao aberto. Roda SO no
// open e no resize (forca layout; nunca por frame).
function measureCard(flip, rootEl, cardEl) {
  flip.width = (rootEl && rootEl.clientWidth) || window.innerWidth;
  flip.viewH = (rootEl && rootEl.clientHeight) || window.innerHeight;
  flip.height = (cardEl && cardEl.offsetHeight) || 0;
}

// Clamp vertical (fix review medium): nave na faixa baixa empurrava o
// rodape do cartao pra tras da hangar bar. Sem medida valida (cartao
// ainda montando) devolve o ty cru; viewport menor que o cartao encosta
// no topo (CARD_EDGE_PAD) em vez de fugir pra cima.
function clampCardY(ty, flip) {
  if (!(flip.height > 0) || !(flip.viewH > 0)) return ty;
  const maxTy = flip.viewH - HANGAR_H - flip.height - CARD_BOTTOM_PAD;
  return Math.min(ty, Math.max(maxTy, CARD_EDGE_PAD));
}

// Flip horizontal: a comparacao e barata por frame, mas a mutacao de
// classe/lado SO acontece quando o estado de borda cruza (SPEC F5.4).
function placeCard(el, pt, flip) {
  const overflow = pt.x + CARD_GAP_X + CARD_W > flip.width - CARD_EDGE_PAD;
  if (overflow !== flip.flipped) {
    flip.flipped = overflow;
    el.classList.toggle('flip', overflow);
  }
  const tx = flip.flipped ? pt.x - CARD_W - CARD_GAP_X : pt.x + CARD_GAP_X;
  const ty = clampCardY(pt.y - CARD_GAP_Y, flip);
  el.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
}

// FB: caixa (px de tela) do chip -- ancorado em (pt.x, pt.y-28), centro
// inferior (translate -50%/-100%). offsetWidth nao sofre reflow por
// transform/opacity (as unicas escritas do rAF), entao medir e barato.
function chipBox(el, pt, out) {
  const w = el.offsetWidth || 120;
  const h = el.offsetHeight || 18;
  const bottom = pt.y + CHIP_OFFSET_Y;
  out.l = pt.x - w / 2;
  out.r = pt.x + w / 2;
  out.t = bottom - h;
  out.b = bottom;
}

// Colisao do box contra os ja colocados neste frame (pool reusado, n itens).
function hitsPool(b, pool, n) {
  for (let i = 0; i < n; i += 1) {
    const p = pool[i];
    if (b.l < p.r && b.r > p.l && b.t < p.b && b.b > p.t) return true;
  }
  return false;
}

// Um frame do overlay: aplica pontos nos chips, esconde chips sem nave viva no
// engine, esconde chips que SE SOBREPOEM a outro ja colocado (declutter no
// zoom-out -- o selecionado tem prioridade) e arrasta o cartao da selecionada.
function syncFrame(pts, chips, cardEl, selectedId, track) {
  const seen = track.seen;
  seen.clear();
  const pool = track.pool;
  let n = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const pt = pts[i];
    if (!pt || !pt.id) continue;
    seen.add(pt.id);
    const el = chips.get(pt.id);
    if (!el) continue;
    const onPt = Number.isFinite(pt.x) && Number.isFinite(pt.y);
    const base = onPt ? chipOpacity(pt) : 0;
    if (base <= 0) {
      setChipOpacity(el, pt.id, 0, track.opacity);
    } else {
      chipBox(el, pt, track.box);
      const isSel = pt.id === selectedId;
      if (!isSel && hitsPool(track.box, pool, n)) {
        setChipOpacity(el, pt.id, 0, track.opacity);
      } else {
        moveChip(el, clampChip(pt, track.box, track));
        setChipOpacity(el, pt.id, base, track.opacity);
        let slot = pool[n];
        if (!slot) { slot = { l: 0, r: 0, t: 0, b: 0 }; pool[n] = slot; }
        slot.l = track.box.l;
        slot.r = track.box.r;
        slot.t = track.box.t;
        slot.b = track.box.b;
        n += 1;
      }
    }
    if (cardEl && pt.id === selectedId) placeCard(cardEl, pt, track.flip);
  }
  for (const [id, el] of chips) {
    if (!seen.has(id)) setChipOpacity(el, id, 0, track.opacity);
  }
}

// ------------------------------------------------------------------
// hooks do overlay
// ------------------------------------------------------------------

// rAF proprio do overlay: pausa com document.hidden e quando o engine nao
// devolve pontos (retry leve via timeout, nunca loop de rAF vazio).
function useFleetTracking({
  apiRef, chipRefs, cardRef, selRef, trackRef, rootRef,
}) {
  useEffect(() => {
    const track = trackRef.current;
    let raf = 0;
    let timer = 0;
    let stopped = false;

    function frame() {
      raf = 0;
      const pts = safeListPoints(apiRef);
      if (!pts) {
        timer = setTimeout(arm, ENGINE_RETRY_MS);
        return;
      }
      const root = rootRef && rootRef.current;
      track.rootW = (root && root.clientWidth) || window.innerWidth;
      track.rootH = (root && root.clientHeight) || window.innerHeight;
      syncFrame(pts, chipRefs.current, cardRef.current, selRef.current, track);
      arm();
    }
    function arm() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (stopped || raf || document.hidden) return;
      raf = requestAnimationFrame(frame);
    }
    function onVis() {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        arm();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [apiRef, chipRefs, cardRef, selRef, trackRef, rootRef]);
}

// Esc fecha o cartao; listener vive SO enquanto o cartao esta aberto.
function useEscClose(open, selectRef) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && typeof selectRef.current === 'function') {
        selectRef.current(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selectRef]);
}

// Sessao do cartao sumiu do payload (voo terminou): fecha sozinho.
function useAutoClose(sessions, selectedShip, selectRef) {
  useEffect(() => {
    if (!selectedShip || !Array.isArray(sessions)) return;
    const alive = sessions.some((s) => s && s.id === selectedShip);
    if (!alive && typeof selectRef.current === 'function') selectRef.current(null);
  }, [sessions, selectedShip, selectRef]);
}

// Mede borda + alturas (flip e clamp vertical) e posiciona o cartao 1x
// ANTES do paint (sem flash no canto); o rAF assume o arrasto a partir
// dai. Fallback central se a nave ainda nao existe no engine (sessao
// alem do cap de naves, engine subindo).
// open entra nas deps: se a sessao do selectedShip so aparecer no payload
// depois, o cartao monta tarde e a medida roda nessa hora (width nunca 0).
function useCardOpenPlacement({ open, selectedShip, apiRef, rootRef, cardRef, trackRef }) {
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!open || !selectedShip || !el) return;
    const flip = trackRef.current.flip;
    flip.flipped = false;
    el.classList.remove('flip');
    measureCard(flip, rootRef.current, el);
    const pt = findPoint(safeListPoints(apiRef), selectedShip);
    if (pt) {
      placeCard(el, pt, flip);
    } else {
      const x = Math.max(CARD_EDGE_PAD, flip.width / 2 - CARD_W / 2);
      el.style.transform = `translate3d(${x.toFixed(1)}px, 64px, 0)`;
    }
  }, [open, selectedShip, apiRef, rootRef, cardRef, trackRef]);
}

// Janela mudou de tamanho com o cartao aberto: borda direita, altura da
// viewport e altura do cartao medidas no open ficaram stale — re-mede e
// re-avalia flip + clamp vertical na hora (placeCard so muta classe
// quando o estado de borda cruza). Listener passivo, vivo SO enquanto o
// cartao existe; cleanup remove sempre.
function useCardResize({ open, selectedShip, apiRef, rootRef, cardRef, trackRef }) {
  useEffect(() => {
    if (!open || !selectedShip) return undefined;
    function onResize() {
      const el = cardRef.current;
      if (!el) return;
      const flip = trackRef.current.flip;
      measureCard(flip, rootRef.current, el);
      const pt = findPoint(safeListPoints(apiRef), selectedShip);
      if (pt) placeCard(el, pt, flip);
    }
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [open, selectedShip, apiRef, rootRef, cardRef, trackRef]);
}

// ------------------------------------------------------------------
// chip de nave (colapsado): [dot estado][CALLSIGN][frase amigavel]
// ex.: "Vega · lendo NoteView.jsx" (F7)
// ------------------------------------------------------------------

function ShipChip({ session, selected, chipRefs, trackRef, onSelectShip, onHoverShip }) {
  const id = session.id;
  const setRef = useCallback((el) => {
    if (el) chipRefs.current.set(id, el);
    else chipRefs.current.delete(id);
    // chip que (re)monta nao pode herdar a opacity cacheada da vida
    // anterior (cache=1 + CSS opacity 0 = chip preso invisivel/pisca):
    // zera a entrada e o proximo frame do rAF escreve o valor fresco.
    trackRef.current.opacity.delete(id);
  }, [chipRefs, trackRef, id]);
  const st = rowStatus(session);
  const ticker = actionPhrase(session);
  return (
    <button
      type="button"
      ref={setRef}
      className={`fleet-chip${selected ? ' sel' : ''}${st.cls === 'fb-st-espera' ? ' awaiting' : ''}`}
      style={{ borderColor: projectColor(session.project) }}
      title={session.promptPreview || session.project || ''}
      aria-label={`Agente ${callsign(id)} ${session.project || 'sessao'}`}
      onClick={() => onSelectShip(id)}
      onMouseEnter={() => onHoverShip && onHoverShip(id)}
      onMouseLeave={() => onHoverShip && onHoverShip(null)}
    >
      <span className={`fc-dot ${st.cls}`} aria-hidden="true" />
      <MiniAvatar session={session} width={14} />
      <span className="fc-call">{callsign(id)}</span>
      {ticker ? <span className="fc-sep" aria-hidden="true">{'·'}</span> : null}
      {ticker ? <span className="fc-ticker">{ticker}</span> : null}
    </button>
  );
}

// ------------------------------------------------------------------
// cartao de missao (expandido, max 1)
// ------------------------------------------------------------------

function CardHeader({ session, now }) {
  const st = rowStatus(session);
  const project = session.project || 'sessao';
  return (
    <header className="fm-head">
      <div className="fm-head-main">
        <span className="fm-call">{callsign(session.id)}</span>
        <span className="fm-code" title="id da sessao">{flightCode(session.id)}</span>
        <span className="fm-time">{flightTime(session.startedTs, now)}</span>
      </div>
      <div className="fm-head-sub">
        <span className="fm-project" style={{ '--proj-color': projectColor(session.project) }} title={project}>
          {project}
        </span>
        <span className={`fm-badge ${st.cls}`}>{st.label}</span>
        <span className="fm-model">{shortModel(session.model)}</span>
      </div>
    </header>
  );
}

function CardMission({ session }) {
  return (
    <div className="fm-sec">
      <h4 className="fm-sec-title">missao</h4>
      <p className="fm-prompt" title={session.promptPreview || ''}>
        {session.promptPreview || 'sem briefing registrado'}
      </p>
    </div>
  );
}

function CardNow({ session }) {
  const tool = session.currentAction ? session.currentAction.tool : session.lastTool;
  return (
    <div className="fm-sec">
      <h4 className="fm-sec-title">agora</h4>
      <div className="fm-now">
        <ToolIcon tool={tool} className="fm-tool-icon" />
        <span className="fm-now-text">{actionPhrase(session) || 'pensando...'}</span>
        <span className="fm-ago">{fmtAgo(session.secondsSinceEvent)}</span>
      </div>
    </div>
  );
}

// Secao I/O (F7): entrada/saida de tokens em linguagem humana, com barra
// em escala log (tokenPct) -- entrada accent, saida cyan. Barra anima so
// transform (scaleX via custom property).
function IoRow({ dir, label, tokens, hint }) {
  return (
    <div className="fm-io-row" title={hint}>
      <span className="fm-io-label">
        <span aria-hidden="true">{dir === 'in' ? '↓' : '↑'}</span> {label}
      </span>
      <span className="fm-io-num">{fmtTokens(tokens)} tok</span>
      <span className="fm-io-bar">
        <span
          className={`fm-io-fill ${dir}`}
          style={{ transform: `scaleX(${tokenPct(tokens).toFixed(3)})` }}
        />
      </span>
    </div>
  );
}

function CardIO({ session }) {
  return (
    <div className="fm-sec">
      <h4 className="fm-sec-title">i/o</h4>
      <div className="fm-io">
        <IoRow
          dir="in"
          label="entrada"
          tokens={session.tokensIn}
          hint="tokens de entrada: contexto que a sessao ja leu (escala log)"
        />
        <IoRow
          dir="out"
          label="saida"
          tokens={session.tokensOut}
          hint="tokens de saida: texto e codigo que a sessao gerou (escala log)"
        />
      </div>
    </div>
  );
}

function LogRow({ action, now, onFocusNode }) {
  const raw = action.target ? `${action.tool} > ${action.target}` : String(action.tool || '');
  const text = phraseOfAction(action) || raw;
  const body = (
    <>
      <ToolIcon tool={action.tool} className="fm-tool-icon" />
      <span className="fm-log-text" title={raw}>{text}</span>
      <span className="fm-ago">{fmtAgoTs(action.ts, now)}</span>
    </>
  );
  if (action.vaultPath && typeof onFocusNode === 'function') {
    return (
      <li>
        <button
          type="button"
          className="fm-log-row is-link"
          title={`Focar no universo: ${action.vaultPath}`}
          onClick={() => onFocusNode(action.vaultPath)}
        >
          {body}
        </button>
      </li>
    );
  }
  return <li><span className="fm-log-row">{body}</span></li>;
}

function CardLog({ session, now, onFocusNode }) {
  const recent = Array.isArray(session.recentActions) ? session.recentActions : [];
  // reverso: mais novo primeiro, ate LOG_MAX linhas
  const rows = recent.filter(Boolean).slice(-LOG_MAX).reverse();
  if (rows.length === 0) return null;
  return (
    <div className="fm-sec">
      <h4 className="fm-sec-title">log</h4>
      <ol className="fm-log">
        {rows.map((a, i) => (
          // ts pode colidir (acoes no mesmo segundo): tool entra na key
          <LogRow key={`${a.ts || 'a'}#${a.tool || 't'}#${i}`} action={a} now={now} onFocusNode={onFocusNode} />
        ))}
      </ol>
    </div>
  );
}

function DroneRow({ sub }) {
  const tool = sub.currentAction ? sub.currentAction.tool : sub.lastTool;
  return (
    <li className={`fm-drone${sub.active ? ' on' : ''}`}>
      <span className={`fm-led${sub.active ? ' on' : ''}`} aria-hidden="true" />
      <span className="fm-drone-label" title={sub.label || sub.id}>
        {droneCallsign(sub.id)}
      </span>
      <span className="fm-drone-type">{sub.agentType || sub.label || ''}</span>
      {tool ? <span className={`fm-drone-tool ${droneToolClass(tool)}`}>{tool}</span> : null}
      <span className="fm-drone-action">{actionPhrase(sub) || 'sem acao'}</span>
    </li>
  );
}

function CardDrones({ session }) {
  const subs = (Array.isArray(session.subagents) ? session.subagents : [])
    .filter((x) => x && x.id);
  if (subs.length === 0) return null;
  const shown = subs.slice(0, DRONES_MAX);
  const extra = subs.length - shown.length;
  const live = subs.filter((x) => x.active !== false).length;
  return (
    <div className="fm-sec">
      <h4 className="fm-sec-title" title="subagentes despachados por esta sessao">
        subagentes <span className="fm-sec-count">{live}/{subs.length} ativos</span>
      </h4>
      <ol className="fm-drones">
        {shown.map((sub) => <DroneRow key={sub.id} sub={sub} />)}
      </ol>
      {extra > 0 ? <div className="fm-drones-more">+{extra} subagentes</div> : null}
    </div>
  );
}

function CardFooter({ session, apiRef, onSelectShip, onOpenDossier }) {
  return (
    <footer className="fm-foot">
      {session.transcriptKb != null ? (
        <span className="fm-kb" title="tamanho do transcript">{session.transcriptKb}kb</span>
      ) : null}
      <span className="fm-foot-spacer" />
      <button type="button" className="fm-btn" title="Camera segue o subagente" onClick={() => followShip(apiRef, session.id)}>
        seguir
      </button>
      <button
        type="button"
        className="fm-btn"
        title="Abrir o painel completo do agente (missao, acoes, tokens, subagentes)"
        onClick={() => {
          if (typeof onOpenDossier === 'function') {
            onOpenDossier({ type: 'session', sessionId: session.id });
          }
        }}
      >
        detalhes
      </button>
      <button type="button" className="fm-btn fm-btn-x" title="Fechar cartao (Esc)" onClick={() => onSelectShip(null)}>
        x
      </button>
    </footer>
  );
}

// Relogio de 1s vive AQUI (componente montado = cartao aberto): o tick nao
// re-renderiza os chips, so o cartao.
function MissionCard({ session, apiRef, onSelectShip, onOpenDossier, onFocusNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="fleet-card" role="dialog" aria-label={`Cartao de missao ${callsign(session.id)}`}>
      <CardHeader session={session} now={now} />
      <CardMission session={session} />
      <CardNow session={session} />
      <CardIO session={session} />
      <CardLog session={session} now={now} onFocusNode={onFocusNode} />
      <CardDrones session={session} />
      <CardFooter
        session={session}
        apiRef={apiRef}
        onSelectShip={onSelectShip}
        onOpenDossier={onOpenDossier}
      />
    </section>
  );
}

// Anchor do cartao: o rAF move ESTE elemento (translate3d); o cartao
// interno anima a entrada via CSS sem brigar com o transform do anchor.
function CardAnchor({ cardRef, session, apiRef, onSelectShip, onOpenDossier, onFocusNode }) {
  return (
    <div
      ref={cardRef}
      className="fleet-card-anchor"
      style={{ '--fleet-accent': projectColor(session.project) }}
    >
      <MissionCard
        key={session.id}
        session={session}
        apiRef={apiRef}
        onSelectShip={onSelectShip}
        onOpenDossier={onOpenDossier}
        onFocusNode={onFocusNode}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// overlay raiz
// ------------------------------------------------------------------

export default function FleetOverlay({
  sessions, apiRef, selectedShip, onSelectShip, onHoverShip, onOpenDossier, onFocusNode,
}) {
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const chipRefs = useRef(new Map());
  const selRef = useRef(selectedShip);
  selRef.current = selectedShip;
  const selectRef = useRef(onSelectShip);
  selectRef.current = onSelectShip;
  // scratch compartilhado do rAF: Set/Map reusados, zero alocacao por frame
  const trackRef = useRef(null);
  if (!trackRef.current) {
    trackRef.current = {
      seen: new Set(),
      opacity: new Map(),
      flip: { flipped: false, width: 0, height: 0, viewH: 0 },
      pool: [], // FB: caixas dos chips ja colocados (anti-sobreposicao)
      box: { l: 0, r: 0, t: 0, b: 0 }, // scratch do box do chip corrente
      rootW: 0, // dims do overlay (UI: clamp do chip na viewport)
      rootH: 0,
    };
  }

  const list = Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [];
  const shown = list.slice(0, CHIP_MAX);
  const selSession = selectedShip
    ? list.find((s) => s.id === selectedShip) || null
    : null;

  useEscClose(Boolean(selSession), selectRef);
  useAutoClose(sessions, selectedShip, selectRef);
  useCardOpenPlacement({
    open: Boolean(selSession), selectedShip, apiRef, rootRef, cardRef, trackRef,
  });
  useCardResize({
    open: Boolean(selSession), selectedShip, apiRef, rootRef, cardRef, trackRef,
  });
  useFleetTracking({
    apiRef, chipRefs, cardRef, selRef, trackRef, rootRef,
  });

  return (
    <div ref={rootRef} className="fleet-overlay">
      {shown.map((s) => (
        <ShipChip
          key={s.id}
          session={s}
          selected={s.id === selectedShip}
          chipRefs={chipRefs}
          trackRef={trackRef}
          onSelectShip={onSelectShip}
          onHoverShip={onHoverShip}
        />
      ))}
      {selSession ? (
        <CardAnchor
          cardRef={cardRef}
          session={selSession}
          apiRef={apiRef}
          onSelectShip={onSelectShip}
          onOpenDossier={onOpenDossier}
          onFocusNode={onFocusNode}
        />
      ) : null}
    </div>
  );
}
