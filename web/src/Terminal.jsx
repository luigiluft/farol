// FAROL - cockpit de terminal (A3/F2; F7 = espelho real das sessoes).
// Aba 'Local' (PTY xterm via /ws/terminal) SO quando /api/terminal/status
// devolve available:true (o check vive AQUI; a tab Terminal do App e
// incondicional na F7). +1 aba espelho por sessao viva (state!=='dormindo',
// cap 6, ordem do payload de useSessions); adormecidas ficam num dropdown
// '+N adormecidas' que abre aba sob demanda. Espelho = DOM estilo terminal
// alimentado por poll do /api/mirror por cursor (3s com aba visivel + refetch
// quando lastActivityTs muda via SSE de sessoes). Sessao que some do payload
// vira aba 'encerrada' (fecha no clique). Tema light/dark do xterm troca em
// runtime via getTheme()/onThemeChange (contrato C1.2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, useSessions } from './api.js';
import { callsign, actionPhrase } from './callsigns.js';
import { LocalPane } from './LocalTerm.jsx';
import './terminal.css';

const LIVE_TAB_CAP = 6;
const MIRROR_POLL_MS = 3000;
const MAX_MIRROR_LINES = 1500;
const STICK_EPSILON_PX = 28;
const MIRROR_KINDS = new Set(['user', 'text', 'tool', 'result']);

export default function TerminalView({ active }) {
  const { sessions } = useSessions();
  const ptyOn = usePtyStatus();
  const [activeTab, setActiveTab] = useState(null);
  const [localStatus, setLocalStatus] = useState('conectando');
  const { mirrors, dormant, endedOnly, openDormantTab, closeEnded } = useMirrorTabs(sessions);

  // tabIds memoizado com deps honestas: mirrors/endedOnly ja saem memoizados
  // de useMirrorTabs, entao a identidade so muda quando as abas mudam.
  const tabIds = useMemo(
    () => [
      ...(ptyOn ? ['local'] : []),
      ...mirrors.map((s) => s.id),
      ...endedOnly.map((e) => e.id),
    ],
    [ptyOn, mirrors, endedOnly]
  );
  useEffect(() => {
    if (activeTab && tabIds.includes(activeTab)) return;
    setActiveTab(tabIds[0] || null);
  }, [tabIds, activeTab]);

  function selectTab(id) {
    if (endedOnly.some((e) => e.id === id)) {
      closeEnded(id);
      if (activeTab === id) setActiveTab(null);
      return;
    }
    setActiveTab(id);
  }

  const panes = [
    ...mirrors.map((s) => ({ id: s.id, session: s, isEnded: false })),
    ...endedOnly.map((e) => ({ id: e.id, session: null, isEnded: true })),
  ];

  return (
    <div className="term-wrap">
      <TabStrip
        ptyOn={ptyOn}
        localStatus={localStatus}
        mirrors={mirrors}
        endedOnly={endedOnly}
        dormant={dormant}
        activeTab={activeTab}
        onSelect={selectTab}
        onPickDormant={(id) => {
          openDormantTab(id);
          setActiveTab(id);
        }}
      />
      <PaneStack
        ptyOn={ptyOn}
        panes={panes}
        active={active}
        activeTab={activeTab}
        onLocalStatus={setLocalStatus}
      />
    </div>
  );
}

// Stack de panes: tudo fica montado (display:none) para preservar scrollback,
// cursor do espelho e o PTY vivo; so a pane ativa fica visivel.
function PaneStack({ ptyOn, panes, active, activeTab, onLocalStatus }) {
  return (
    <div className="term-body">
      {ptyOn && <LocalPane visible={active && activeTab === 'local'} onStatus={onLocalStatus} />}
      {panes.map((p) => (
        <MirrorPane
          key={p.id}
          id={p.id}
          session={p.session}
          isEnded={p.isEnded}
          visible={active && activeTab === p.id}
        />
      ))}
      {!ptyOn && panes.length === 0 && (
        <div className="term-empty mono">
          nenhuma sessão em voo · o espelho abre quando uma sessão acordar
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// abas: derivacao do payload + ciclo de vida 'encerrada'
// ---------------------------------------------------------------

// Deriva as abas espelho: vivas (cap 6, ordem do proprio payload), adormecidas
// abertas sob demanda e encerradas (estavam exibidas e sumiram do payload).
function useMirrorTabs(sessions) {
  const [openedDormant, setOpenedDormant] = useState([]);
  const [ended, setEnded] = useState([]);
  const knownRef = useRef(new Map());
  const shownIdsRef = useRef([]);

  // Derivacao memoizada: referencia estavel de mirrors/dormant/endedOnly
  // alimenta o useMemo de tabIds no TerminalView sem eslint-disable.
  const { mirrors, dormant } = useMemo(() => {
    const rows = Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [];
    const live = rows.filter((s) => s.state !== 'dormindo').slice(0, LIVE_TAB_CAP);
    const liveIds = new Set(live.map((s) => s.id));
    const opened = openedDormant
      .map((id) => rows.find((s) => s.id === id))
      .filter((s) => s && !liveIds.has(s.id));
    return {
      mirrors: [...live, ...opened],
      dormant: rows.filter((s) => s.state === 'dormindo' && !openedDormant.includes(s.id)),
    };
  }, [sessions, openedDormant]);
  const endedOnly = useMemo(
    () => ended.filter((e) => !mirrors.some((s) => s.id === e.id)),
    [ended, mirrors]
  );

  // Detector: aba exibida no commit anterior que sumiu do payload => encerrada.
  // (Declarado ANTES do tracker para ler shownIdsRef do commit anterior.)
  useEffect(() => {
    if (!Array.isArray(sessions)) return;
    const payloadIds = new Set(sessions.map((s) => s && s.id).filter(Boolean));
    const gone = shownIdsRef.current.filter((sid) => !payloadIds.has(sid));
    if (!gone.length) return;
    setEnded((prev) => mergeEnded(prev, gone, knownRef.current));
    setOpenedDormant((prev) => prev.filter((sid) => !gone.includes(sid)));
  }, [sessions]);

  // Tracker: registra o que esta exibido agora (roda apos cada commit).
  useEffect(() => {
    mirrors.forEach((s) => knownRef.current.set(s.id, { project: s.project || '' }));
    shownIdsRef.current = mirrors.map((s) => s.id);
  });

  const openDormantTab = useCallback((id) => {
    setOpenedDormant((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const closeEnded = useCallback((id) => {
    setEnded((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { mirrors, dormant, endedOnly, openDormantTab, closeEnded };
}

function mergeEnded(prev, gone, known) {
  const have = new Set(prev.map((e) => e.id));
  const extra = gone
    .filter((sid) => !have.has(sid))
    .map((sid) => ({ id: sid, project: (known.get(sid) || {}).project || '' }));
  return extra.length ? [...prev, ...extra] : prev;
}

// PTY disponivel? Rota ausente/erro = sem aba local, sem erro no console.
function usePtyStatus() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchJson('/api/terminal/status')
      .then((data) => {
        if (alive) setOn(Boolean(data && data.available));
      })
      .catch(() => {
        if (alive) setOn(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

// ---------------------------------------------------------------
// strip de abas
// ---------------------------------------------------------------

function TabStrip({ ptyOn, localStatus, mirrors, endedOnly, dormant, activeTab, onSelect, onPickDormant }) {
  return (
    <div className="term-tabs mono" role="tablist" aria-label="Abas do terminal">
      {ptyOn && (
        <TermTab
          led={localStatus}
          label="Local"
          sub="powershell"
          active={activeTab === 'local'}
          onClick={() => onSelect('local')}
        />
      )}
      {mirrors.map((s) => (
        <TermTab
          key={s.id}
          led={s.state}
          label={callsignSafe(s.id)}
          sub={s.project || ''}
          active={activeTab === s.id}
          onClick={() => onSelect(s.id)}
        />
      ))}
      {endedOnly.map((e) => (
        <TermTab
          key={e.id}
          led="encerrada"
          label={callsignSafe(e.id)}
          sub={e.project}
          endedTab
          active={activeTab === e.id}
          onClick={() => onSelect(e.id)}
        />
      ))}
      {dormant.length > 0 && <DormantDrop items={dormant} onPick={onPickDormant} />}
    </div>
  );
}

function TermTab({ led, label, sub, endedTab, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={'term-tab' + (active ? ' active' : '') + (endedTab ? ' ended' : '')}
      onClick={onClick}
      title={endedTab ? 'sessão encerrada · clique para fechar' : sub || label}
    >
      <span className={'tab-led led-' + led} aria-hidden="true" />
      <span className="tab-label">{label}</span>
      {sub ? <span className="tab-sub">{sub}</span> : null}
      {endedTab ? <span className="tab-badge">encerrada</span> : null}
    </button>
  );
}

// Dropdown '+N adormecidas': abre aba espelho de sessao dormindo sob demanda.
function DormantDrop({ items, onPick }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(ev) {
      if (boxRef.current && !boxRef.current.contains(ev.target)) setOpen(false);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="term-drop" ref={boxRef}>
      <button
        type="button"
        className="term-drop-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        +{items.length} adormecidas
      </button>
      {open && (
        <div className="term-drop-menu" role="menu">
          {items.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className="term-drop-item"
              onClick={() => {
                onPick(s.id);
                setOpen(false);
              }}
            >
              <span className="tab-led led-dormindo" aria-hidden="true" />
              <span className="tab-label">{callsignSafe(s.id)}</span>
              <span className="tab-sub">{s.project || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// painel espelho (DOM estilo terminal, alimentado por /api/mirror)
// ---------------------------------------------------------------

function MirrorPane({ id, session, visible, isEnded }) {
  const [lines, setLines] = useState([]);
  const [hasNew, setHasNew] = useState(false);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);

  useMirrorPoll({ id, session, visible, isEnded, setLines });

  // Stick-to-bottom: acompanha o fim SE o usuario ja esta no fim; senao badge.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || lines.length === 0) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else setHasNew(true);
  }, [lines]);

  // display:none pode zerar o scroll: ao reexibir, recola no fim se colado.
  useEffect(() => {
    const el = scrollRef.current;
    if (visible && stickRef.current && el) el.scrollTop = el.scrollHeight;
  }, [visible]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_EPSILON_PX;
    stickRef.current = atBottom;
    if (atBottom) setHasNew(false);
  }

  function jumpToEnd() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setHasNew(false);
  }

  // Rodape de status: callsign + ultima atividade (nunca ha vazio absoluto).
  const lastSeen =
    lastClock(lines) ||
    (session && session.lastActivityTs ? formatClock(session.lastActivityTs) : '');
  const statusText = lastSeen
    ? 'última atividade ' + lastSeen
    : isEnded
      ? 'sessão encerrada'
      : 'aguardando atividade';

  return (
    <div className={'mirror-pane' + (visible ? '' : ' hidden')}>
      {isEnded && (
        <div className="mirror-ended mono">sessão encerrada · clique na aba para fechar</div>
      )}
      <div ref={scrollRef} className="mirror-scroll" onScroll={onScroll}>
        <div className="mirror-lines">
          {lines.length === 0 && (
            <div className="mir-line mir-meta">
              <span className="mir-ts" />
              <span className="mir-body">aguardando atividade da sessão...</span>
            </div>
          )}
          {lines.map((line) => (
            <MirrorLine key={line.seq} line={line} />
          ))}
        </div>
      </div>
      {hasNew && (
        <button type="button" className="mirror-newlines mono" onClick={jumpToEnd}>
          novas linhas {'↓'}
        </button>
      )}
      <div className="mirror-status mono">
        <span className="mirror-status-callsign">{callsignSafe(id)}</span>
        <span className="mirror-status-meta">{statusText}</span>
      </div>
    </div>
  );
}

// Ultimo relogio conhecido do feed (linhas meta nao carregam hora).
function lastClock(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].time) return lines[i].time;
  }
  return '';
}

function MirrorLine({ line }) {
  return (
    <div className={'mir-line mir-' + line.kind}>
      <span className="mir-ts">{line.time}</span>
      {line.kind === 'user' && (
        <span className="mir-prompt" aria-hidden="true">
          {'❯'}
        </span>
      )}
      {line.kind === 'tool' && (
        <span className="mir-gear" aria-hidden="true">
          {'⚙︎'}
        </span>
      )}
      <span className="mir-body">{line.text}</span>
    </div>
  );
}

// Poll por cursor: 3s com a aba visivel + refetch imediato quando o
// lastActivityTs da sessao muda (SSE ja chega via useSessions). O cursor vive
// em ref POR ABA; a pane fica montada (display:none) e preserva linhas/cursor.
function useMirrorPoll({ id, session, visible, isEnded, setLines }) {
  const cursorRef = useRef(null);
  const seqRef = useRef(0);
  const truncRef = useRef(false);
  const busyRef = useRef(false);

  const poll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const q = cursorRef.current === null ? '' : '&cursor=' + cursorRef.current;
      const data = await fetchJson('/api/mirror?session=' + encodeURIComponent(id) + q);
      applyMirrorChunk(data, { cursorRef, seqRef, truncRef, setLines });
    } catch {
      // rota/sessao indisponivel agora: o proximo tick tenta de novo
    } finally {
      busyRef.current = false;
    }
  }, [id, setLines]);

  useEffect(() => {
    if (!visible || isEnded) return undefined;
    poll();
    const timer = setInterval(() => {
      if (!document.hidden) poll();
    }, MIRROR_POLL_MS);
    return () => clearInterval(timer);
  }, [visible, isEnded, poll]);

  const lastTs = session ? session.lastActivityTs : null;
  useEffect(() => {
    if (visible && !isEnded && lastTs) poll();
  }, [lastTs, visible, isEnded, poll]);
}

// Aplica uma resposta do /api/mirror. Tudo defensivo: shape estranho => no-op.
function applyMirrorChunk(data, { cursorRef, seqRef, truncRef, setLines }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  if (typeof data.cursor === 'number' && Number.isFinite(data.cursor)) {
    cursorRef.current = data.cursor;
  }
  const fresh = [];
  if (data.truncated && !truncRef.current) {
    truncRef.current = true;
    seqRef.current += 1;
    fresh.push({ seq: seqRef.current, kind: 'meta', time: '', text: '... início omitido (tail)' });
  }
  const raw = Array.isArray(data.lines) ? data.lines : [];
  raw.forEach((ln) => {
    const norm = normalizeMirrorLine(ln, seqRef);
    if (norm) fresh.push(norm);
  });
  if (!fresh.length) return;
  setLines((prev) => {
    const next = prev.concat(fresh);
    return next.length > MAX_MIRROR_LINES ? next.slice(next.length - MAX_MIRROR_LINES) : next;
  });
}

function normalizeMirrorLine(ln, seqRef) {
  if (!ln || typeof ln !== 'object' || !MIRROR_KINDS.has(ln.kind)) return null;
  const text = ln.kind === 'tool' ? phraseFor(ln) : typeof ln.text === 'string' ? ln.text : '';
  if (!text) return null;
  seqRef.current += 1;
  return { seq: seqRef.current, kind: ln.kind, time: formatClock(ln.ts), text };
}

// Frase amigavel da acao (contrato C2). Passa um objeto que satisfaz tanto
// actionPhrase(sessao) quanto actionPhrase(acao); fallback cru se falhar.
function phraseFor(ln) {
  const tool = typeof ln.tool === 'string' ? ln.tool : '';
  const target = typeof ln.target === 'string' ? ln.target : '';
  const action = { tool: tool || null, target: target || null, ts: ln.ts || null };
  try {
    const phrase = actionPhrase({ ...action, currentAction: action });
    if (typeof phrase === 'string' && phrase) return phrase;
  } catch {
    // contrato em costura: cai no fallback cru
  }
  if (!tool) return '';
  // Fallback PT-BR (diretiva F7): nunca vazar nome de tool cru sem verbo.
  return 'rodando ' + tool + (target ? ' · ' + target : '');
}

function formatClock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function callsignSafe(id) {
  try {
    const name = callsign(id);
    if (typeof name === 'string' && name) return name;
  } catch {
    // callsigns.js em costura: codigo curto cobre
  }
  return String(id || '').slice(0, 6).toUpperCase();
}

// aba local (PTY xterm) vive em LocalTerm.jsx: extraido para o Cockpit poder
// carrega-lo LAZY (o chunk do xterm nao entra no bundle inicial). A aba 'Local'
// da F7 segue importando LocalPane de la, com comportamento identico.
