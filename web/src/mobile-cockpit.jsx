// FAROL - shell MOBILE: aba COCKPIT ("o olho da IA" no celular). Uso-matador
// do sofa: ver o que cada agente esta fazendo sem abrir o desktop. Componentes
// PROPRIOS do mobile consumindo as MESMAS rotas do Cockpit desktop (NAO importa
// Cockpit.jsx): /api/visor (indice de frames historicos) -> /api/visor/frame
// (binario), com fallback pro /api/mirror (tail do espelho) quando a sessao nao
// capturou imagem. Default = PAREDE (coluna de tiles full-width, 1 por sessao
// viva); tap no tile = FOCO fullscreen (olho grande + ultimas ~30 linhas do
// espelho + voltar). Lazy: so monta na aba ativa; poll pausa com a aba oculta;
// AbortController cancela no unmount/refresh. No FOCO, linhas 'text' (prosa
// do assistente) renderizam via ProseMd (mesmo motor do Cockpit desktop),
// respeitando o toggle md|raw persistido em torre.ckMd; scroll com deteccao
// de "colado no fim" (stick) + botao flutuante "voltar ao vivo" quando o
// usuario rola pra cima e chega linha nova (nao puxa quem esta lendo).
import {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { fetchJson } from './api.js';
import { useSessions, rowStatus, isAwaiting, projectColor } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import { fmtAgo } from './mobile-fila.jsx';
import ProseMd from './ProseMd.jsx';
import './mobile-cockpit.css';

const WALL_REFRESH_MS = 8000;   // frames da parede: refresh lento (bateria)
const FOCUS_FRAME_MS = 8000;    // olho grande no foco
const FOCUS_MIRROR_MS = 3000;   // espelho no foco: tail mais reativo
const TILE_TAIL_LINES = 3;      // linhas do espelho no tile sem frame
const FOCUS_TAIL_LINES = 30;    // linhas do espelho no foco
const MIRROR_KINDS = new Set(['user', 'text', 'tool', 'result']);
const FOCUS_STICK_EPSILON_PX = 40;
const MD_KEY = 'torre.ckMd'; // mesma chave do toggle md|raw do Cockpit desktop

function readMdPref() {
  try {
    return localStorage.getItem(MD_KEY) !== 'raw';
  } catch {
    return true;
  }
}

// Frase amigavel da acao corrente (fallback: estado cru).
function doingOf(s) {
  return actionPhrase(s) || (s && s.state) || 'sem atividade';
}

// Linha crua do /api/mirror -> texto PT-BR (tool vira frase via actionPhrase).
function mapMirrorLine(ln) {
  if (!ln || typeof ln !== 'object' || !MIRROR_KINDS.has(ln.kind)) return null;
  let text;
  if (ln.kind === 'tool') {
    const action = {
      tool: typeof ln.tool === 'string' ? ln.tool : null,
      target: typeof ln.target === 'string' ? ln.target : null,
    };
    text = actionPhrase({ ...action, currentAction: action })
      || (action.tool ? 'rodando ' + action.tool : '');
  } else {
    text = typeof ln.text === 'string' ? ln.text : '';
  }
  return text ? { kind: ln.kind, text } : null;
}

function mapTail(rawLines, max) {
  const out = [];
  const raw = Array.isArray(rawLines) ? rawLines : [];
  for (const ln of raw) {
    const m = mapMirrorLine(ln);
    if (m) out.push(m);
  }
  return out.slice(-max);
}

function lineMark(kind) {
  return kind === 'user' ? '❯' : kind === 'tool' ? '⚙' : kind === 'result' ? '↳' : ' ';
}

// ------------------------------------------------------------------ olho do tile
// Indice /api/visor (frame mais recente) e, sem frame, tail do /api/mirror.
// Re-busca a cada WALL_REFRESH_MS; AbortController cancela no unmount/refresh;
// pausa com a aba do navegador oculta.
function useTileEye(id) {
  const [frame, setFrame] = useState(null); // { idx }
  const [tail, setTail] = useState([]);

  useEffect(() => {
    setFrame(null);
    setTail([]);
    if (!id) return undefined;
    let alive = true;
    let ctrl = null;

    const load = async () => {
      if (!alive || document.hidden) return;
      ctrl = new AbortController();
      try {
        const vr = await fetch('/api/visor?session=' + encodeURIComponent(id), { signal: ctrl.signal });
        if (!vr.ok) return;
        const vd = await vr.json();
        if (!alive) return;
        const fr = Array.isArray(vd.frames) ? vd.frames : [];
        if (fr.length > 0) { setFrame(fr[fr.length - 1]); setTail([]); return; }
        setFrame(null);
        const mr = await fetch('/api/mirror?session=' + encodeURIComponent(id), { signal: ctrl.signal });
        if (!mr.ok) return;
        const md = await mr.json();
        if (!alive) return;
        setTail(mapTail(md && md.lines, TILE_TAIL_LINES));
      } catch {
        // abort ou rede indisponivel: o proximo tick tenta de novo
      }
    };

    load();
    const timer = setInterval(load, WALL_REFRESH_MS);
    return () => { alive = false; if (ctrl) ctrl.abort(); clearInterval(timer); };
  }, [id]);

  return { frame, tail };
}

function WallTile({ session, now, onFocus }) {
  const { frame, tail } = useTileEye(session.id);
  const [brokenIdx, setBrokenIdx] = useState(null); // frame que a rota nao decodou (404)
  const cs = callsign(session.id);
  const waiting = isAwaiting(session);
  const doing = doingOf(session);
  const showFrame = frame && brokenIdx !== frame.idx;
  return (
    <li>
      <button
        type="button"
        className={'mbc-tile' + (waiting ? ' waiting' : '')}
        style={{ '--mb-accent': projectColor(session.project) }}
        onClick={() => onFocus(session.id)}
      >
        <span className="mbc-tile-head">
          <span className={'mb-dot ' + rowStatus(session).cls} aria-hidden="true" />
          <span className="mbc-tile-call">{cs}</span>
          <span className="mbc-tile-proj">{session.project || 'home'}</span>
          {waiting ? <span className="mbc-tile-wait">esperando há {fmtAgo(session, now)}</span> : null}
        </span>
        <span className="mbc-eye">
          {showFrame ? (
            <img
              className="mbc-eye-img"
              loading="lazy"
              alt={doing}
              src={'/api/visor/frame?session=' + encodeURIComponent(session.id) + '&idx=' + frame.idx}
              onError={() => setBrokenIdx(frame.idx)}
            />
          ) : tail.length ? (
            <span className="mbc-eye-tail">
              {tail.map((l, i) => (
                <span key={i} className={'mbc-ln ' + l.kind}>
                  <span className="mbc-mk">{lineMark(l.kind)}</span>{l.text}
                </span>
              ))}
            </span>
          ) : (
            <span className="mbc-eye-empty">sem sinal ainda</span>
          )}
          <span className="mbc-eye-cap"><span className="mbc-rec" />{doing}</span>
        </span>
      </button>
    </li>
  );
}

function CockpitWall({ sessions, now, onFocus }) {
  if (sessions.length === 0) {
    return <div className="mb-empty">nenhuma sessão viva no momento</div>;
  }
  return (
    <ul className="mbc-wall">
      {sessions.map((s) => (
        <WallTile key={s.id} session={s} now={now} onFocus={onFocus} />
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ foco
// Olho grande: ultimo frame historico, refresh lento. Espelho: tail (sem
// cursor) re-lido a cada FOCUS_MIRROR_MS, mapeado, ultimas ~30 linhas.
function useFocusEye(id) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    setFrame(null);
    if (!id) return undefined;
    let alive = true;
    let ctrl = null;
    const load = async () => {
      if (!alive || document.hidden) return;
      ctrl = new AbortController();
      try {
        const r = await fetch('/api/visor?session=' + encodeURIComponent(id), { signal: ctrl.signal });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        const fr = Array.isArray(d.frames) ? d.frames : [];
        setFrame(fr.length ? fr[fr.length - 1] : null);
      } catch { /* proximo tick re-tenta */ }
    };
    load();
    const timer = setInterval(load, FOCUS_FRAME_MS);
    return () => { alive = false; if (ctrl) ctrl.abort(); clearInterval(timer); };
  }, [id]);
  return frame;
}

function useMirrorTail(id) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    setLines([]);
    if (!id) return undefined;
    let alive = true;
    let ctrl = null;
    // /api/mirror sem cursor sempre rele o tail inteiro do disco (server nao
    // faz delta aqui, diferente do useMirror desktop com cursor=). Sem essa
    // assinatura, cada poll de 3s troca a REFERENCIA de `lines` mesmo sem
    // conteudo novo -> o efeito [lines] do CockpitFocus dispara hasNew a
    // toa. Espelha a semantica do desktop (`if (!fresh.length) return`)
    // comparando o payload em vez do tamanho do array mapeado.
    let lastSig = null;
    const load = async () => {
      if (!alive || document.hidden) return;
      ctrl = new AbortController();
      try {
        const r = await fetch('/api/mirror?session=' + encodeURIComponent(id), { signal: ctrl.signal });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        const next = mapTail(d && d.lines, FOCUS_TAIL_LINES);
        const sig = d && Number.isFinite(d.cursor)
          ? 'c' + d.cursor
          : next.length + '|' + (next.length ? next[next.length - 1].text : '');
        if (sig === lastSig) return;
        lastSig = sig;
        setLines(next);
      } catch { /* proximo tick re-tenta */ }
    };
    load();
    const timer = setInterval(load, FOCUS_MIRROR_MS);
    return () => { alive = false; if (ctrl) ctrl.abort(); clearInterval(timer); };
  }, [id]);
  return lines;
}

function CockpitFocus({ session, now, onBack }) {
  const frame = useFocusEye(session.id);
  const lines = useMirrorTail(session.id);
  const [brokenIdx, setBrokenIdx] = useState(null);
  const [md] = useState(readMdPref);
  const focusRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const [hasNew, setHasNew] = useState(false);
  const cs = callsign(session.id);
  const waiting = isAwaiting(session);
  const showFrame = frame && brokenIdx !== frame.idx;

  // Trava a altura do FOCO no viewport disponivel (100dvh - topo real do
  // elemento), medido em runtime: .mobile-root/#root do shell so tem
  // min-height (crescem com o conteudo), entao sem isso o .mbc-focus-mirror
  // (flex:1+overflow-y:auto) nunca fica de fato limitado - com prosa rica
  // (multi-linha/tabela) o conteudo excedente fica so CORTADO por causa do
  // body{overflow:hidden} do shell, inalcancavel por scroll nenhum. Trava
  // local (so este componente) resolve sem tocar mobile.css (fora do escopo).
  useLayoutEffect(() => {
    const el = focusRef.current;
    if (!el) return undefined;
    const apply = () => {
      const top = el.getBoundingClientRect().top;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      el.style.height = Math.max(0, vh - top) + 'px';
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.visualViewport?.removeEventListener('resize', apply);
    };
  }, []);

  // Cola no fim SO quando o usuario ja esta no fim (leitura de tail -f);
  // senao arma o botao flutuante "voltar ao vivo" — nao puxa quem esta lendo
  // pra cima. Roda depois do commit do DOM (markdown ja mediu sua altura).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || lines.length === 0) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else setHasNew(true);
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOCUS_STICK_EPSILON_PX;
    stickRef.current = atBottom;
    if (atBottom) setHasNew(false);
  };

  const jumpToEnd = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setHasNew(false);
  };

  return (
    <div ref={focusRef} className="mbc-focus" style={{ '--mb-accent': projectColor(session.project) }}>
      <header className="mbc-focus-bar">
        <button type="button" className="mb-back" onClick={onBack}>‹ parede</button>
        <span className={'mb-dot ' + rowStatus(session).cls} aria-hidden="true" />
        <span className="mbc-focus-call">{cs}</span>
        <span className="mbc-focus-proj">{session.project || 'home'}</span>
        {waiting ? (
          <span className="mbc-focus-wait">esperando há {fmtAgo(session, now)}</span>
        ) : (
          <span className="mbc-focus-doing">{doingOf(session)}</span>
        )}
      </header>
      <div className="mbc-focus-eye">
        {showFrame ? (
          <img
            className="mbc-focus-img"
            alt={doingOf(session)}
            src={'/api/visor/frame?session=' + encodeURIComponent(session.id) + '&idx=' + frame.idx}
            onError={() => setBrokenIdx(frame.idx)}
          />
        ) : (
          <span className="mbc-eye-empty">esta sessão ainda não capturou nada</span>
        )}
      </div>
      <div className="mbc-focus-mirror" ref={scrollRef} onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="mbc-ln meta"><span className="mbc-mk"> </span>aguardando atividade…</div>
        ) : lines.map((l, i) => (
          l.kind === 'text' ? (
            <div key={i} className="mbc-ln text mbc-ln-prose">
              <span className="mbc-mk">{lineMark(l.kind)}</span>
              {md ? <ProseMd text={l.text} /> : <span className="mbc-prose-raw">{l.text}</span>}
            </div>
          ) : (
            <div key={i} className={'mbc-ln ' + l.kind}>
              <span className="mbc-mk">{lineMark(l.kind)}</span>{l.text}
            </div>
          )
        ))}
      </div>
      {hasNew && (
        <button type="button" className="mbc-back-to-live" onClick={jumpToEnd}>
          ↓ ao vivo
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shell da aba
export default function MobileCockpit({ now }) {
  const { sessions } = useSessions();
  // 1 tile por sessao VIVA (ativa/ociosa); dormindo fica fora da parede.
  const list = Array.isArray(sessions)
    ? sessions.filter((s) => s && s.id && s.state !== 'dormindo')
    : [];
  const [focusId, setFocusId] = useState(null);
  const focused = focusId ? list.find((s) => s.id === focusId) || null : null;

  // Sessao focada sumiu da janela: volta pra parede (nunca trava em id morto).
  useEffect(() => {
    if (focusId && !focused) setFocusId(null);
  }, [focusId, focused]);

  if (focused) {
    return <CockpitFocus session={focused} now={now} onBack={() => setFocusId(null)} />;
  }
  return (
    <div className="mb-body mbc-body">
      <CockpitWall sessions={list} now={now} onFocus={setFocusId} />
    </div>
  );
}
