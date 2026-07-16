// FAROL - shell MOBILE (monitoramento remoto via Tailscale).
// Renderizado pelo App quando viewport <= 700px (ou rota /m): NADA do
// shell desktop monta. Navegacao por abas na base (padrao de app):
//   torre  = operacoes + cards de agente + feed (monitor, default)
//   notas  = busca fuzzy + arvore do vault; nota abre em overlay
//   agenda = view Agenda reusada (lazy)
//   grafo  = universo canvas reusado (so monta quando a aba abre)
// Mesmo SessionsProvider/SSE do desktop: zero fetch novo no monitor.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  useSessions, projectColor, rowStatus, fmtTokens, flightTime,
  shortModel, contextPct, flightCode, activityLabel,
} from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import MiniAvatar from './MiniAvatar.jsx';
import { fetchJson, normalizeSearchResults } from './api.js';
import StatsBar from './StatsBar.jsx';
import Feed from './Feed.jsx';
import Dossier from './Dossier.jsx';
import Tree from './Tree.jsx';
import NoteView from './NoteView.jsx';
import BaseView from './BaseView.jsx';
import CanvasView from './CanvasView.jsx';
import Diary from './Diary.jsx';
import Graph from './Graph.jsx';
import Toasts from './Toasts.jsx';
import { useSessionNotifications } from './notify.js';
import AwaitingStrip from './mobile-fila.jsx';
import MobileHoje from './mobile-hoje.jsx';
import MobileCockpit from './mobile-cockpit.jsx';
import Uso from './Uso.jsx';
import PerfHud from './PerfHud.jsx';
import { getTheme, setTheme, onThemeChange } from './theme.js';
import './mobile.css';

const Agenda = lazy(() => import('./Agenda.jsx'));
// Terminal PTY interativo: reusa o LocalPane do desktop (xterm ~300KB, LAZY).
const LocalPane = lazy(() => import('./LocalTerm.jsx'));

// LocalPane exige onStatus; no mobile o proprio painel ja mostra o status no
// header, entao passamos um handler estavel e inerte (evita re-run do efeito).
const NOOP = () => {};

// refactor v2 F3: barra espelha a nav desktop consolidada — Diario/Agenda
// moram no HOJE (tiles com link); 9 tabs cortavam letra em tela estreita.
const TABS = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'torre', label: 'Torre' },
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'uso', label: 'Uso' },
  { id: 'terminal', label: 'Shell' },
  { id: 'notas', label: 'Notas' },
  { id: 'grafo', label: 'Grafo' },
];

// Relogio compartilhado dos cards (tempo de sessao vivo).
function useNowTicker(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ThemeButton() {
  const [theme, setLocal] = useState(getTheme);
  useEffect(() => onThemeChange(setLocal), []);
  const isLight = theme === 'light';
  return (
    <button
      type="button"
      className="mb-theme"
      aria-label={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
    >
      {isLight ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.4 9.6a5.6 5.6 0 0 1-7-7 5.9 5.9 0 1 0 7 7Z" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" />
        </svg>
      )}
    </button>
  );
}

// ------------------------------------------------------------------
// aba TORRE: cards de agente (tudo visivel sem hover) + feed
// ------------------------------------------------------------------

function AgentCard({ s, now, onSelect }) {
  const st = rowStatus(s);
  const color = projectColor(s.project);
  const pct = contextPct(s);
  const subs = Array.isArray(s.subagents) ? s.subagents : [];
  const subsActive = subs.filter((x) => x && x.active).length;
  return (
    <li>
      <button
        type="button"
        className={`mb-card${s.state === 'dormindo' ? ' mb-card-dorm' : ''}`}
        style={{ '--mb-accent': color }}
        onClick={() => onSelect({ type: 'session', sessionId: s.id })}
      >
        <span className="mb-card-top">
          <span className={`mb-dot ${st.cls}`} aria-hidden="true" />
          <MiniAvatar session={s} width={18} />
          <span className="mb-call">{callsign(s.id)}</span>
          <span className="mb-code">{flightCode(s.id)}</span>
          <span className={`mb-status ${st.cls}`}>{st.label}</span>
        </span>
        <span className="mb-card-mid">
          <span className="mb-proj">{s.project || 'sessao'}</span>
          <span className="mb-model">{shortModel(s.model)}</span>
        </span>
        <span className="mb-action">{actionPhrase(s) || 'pensando...'}</span>
        <span className="mb-card-foot">
          {pct !== null ? (
            <span className="mb-foot-item" aria-label={`contexto ${pct}%`}>
              <span className="mb-ctx-bar">
                <span
                  className={`mb-ctx-fill${pct >= 90 ? ' crit' : pct >= 70 ? ' warn' : ''}`}
                  style={{ transform: `scaleX(${pct / 100})` }}
                />
              </span>
              {pct}%
            </span>
          ) : null}
          <span className="mb-foot-item">{fmtTokens(s.tokensOut)} tok</span>
          <span className="mb-foot-item">{flightTime(s.startedTs, now)}</span>
          {subs.length > 0 ? (
            <span className="mb-foot-item">
              {subsActive > 0 ? `${subsActive}/${subs.length}` : subs.length} sub
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function MonitorTab({ sessions, error, now, onSelect }) {
  const list = Array.isArray(sessions) ? sessions : null;
  return (
    <div className="mb-body">
      <AwaitingStrip sessions={sessions} now={now} onSelect={onSelect} />
      <StatsBar />
      <section className="mb-section" aria-label="Agentes Claude Code">
        <h2 className="mb-section-title">
          agentes
          <span className="mb-section-meta">
            {list === null ? 'sincronizando...' : activityLabel(list)}
          </span>
        </h2>
        <ol className="mb-cards">
          {(list || []).map((s) => (
            <AgentCard key={s.id} s={s} now={now} onSelect={onSelect} />
          ))}
        </ol>
        {list !== null && list.length === 0 ? (
          <div className="mb-empty">nenhum agente nas ultimas 4h</div>
        ) : null}
      </section>
      <Feed />
      {error ? <div className="mb-error">monitor offline: {error}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------
// aba NOTAS: busca fuzzy + arvore do vault (nota abre em overlay)
// ------------------------------------------------------------------

function NotesTab({ activePath, onOpen, onOpenBase, onOpenCanvas }) {
  const seqRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const seq = (seqRef.current += 1);
      try {
        const data = await fetchJson('/api/search?q=' + encodeURIComponent(q));
        if (seq === seqRef.current) setResults(normalizeSearchResults(data));
      } catch {
        if (seq === seqRef.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mb-body mb-notes">
      <input
        className="mb-search"
        type="search"
        value={query}
        placeholder="Buscar no vault"
        aria-label="Buscar no vault"
        onChange={(e) => setQuery(e.target.value)}
      />
      {results !== null ? (
        <ol className="mb-results">
          {results.length === 0 ? <li className="mb-empty">nada encontrado</li> : null}
          {results.map((r, i) => (
            <li key={r.path + '#' + i}>
              <button type="button" className="mb-result" onClick={() => onOpen(r.path)}>
                <span className="mb-result-title">{r.title}</span>
                <span className="mb-result-path">{r.path}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mb-tree">
          <Tree activePath={activePath} onSelect={onOpen} onOpenBase={onOpenBase} onOpenCanvas={onOpenCanvas} />
        </div>
      )}
    </div>
  );
}

// Overlay fullscreen: nota / base / canvas reusados + barra de voltar.
function ContentOverlay({ overlay, onClose, onNavigate }) {
  if (!overlay) return null;
  const { type, path } = overlay;
  const name = path.replace(/\.(md|base|canvas)$/i, '').split('/').pop();
  return (
    <div className="mb-note-overlay">
      <header className="mb-note-bar">
        <button type="button" className="mb-back" onClick={onClose}>
          ‹ voltar
        </button>
        <span className="mb-note-name" title={path}>{name}</span>
      </header>
      <div className="mb-note-body">
        {type === 'base' ? <BaseView path={path} onOpenNote={onNavigate} />
          : type === 'canvas' ? <CanvasView path={path} onOpenNote={onNavigate} />
            : <NoteView path={path} onNavigate={onNavigate} onTagClick={() => {}} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// retomar: picker visual (versao tap do comando `resume`)
// ------------------------------------------------------------------

const UUID_RE = /^[A-Za-z0-9-]+$/;

// Monta `cd <cwd>; claude.cmd --resume <id>`. claude.cmd (com extensao) pula o
// wrapper `function claude {..exit 0}` do profile; aspas simples do cwd escapadas.
function buildResumeCmd(s) {
  if (!s || !s.cwd || !UUID_RE.test(String(s.id || ''))) return null;
  const cwd = String(s.cwd).replace(/'/g, "''");
  return `Set-Location -LiteralPath '${cwd}'; claude.cmd --resume ${s.id}`;
}

function ResumePicker({ onPick, onClose }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchJson('/api/resumable')
      .then((d) => { if (alive) setList(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="mb-resume">
      <header className="mb-resume-head">
        <span className="mb-resume-title">retomar sessão</span>
        <button type="button" className="mb-resume-x" onClick={onClose} aria-label="Fechar">✕</button>
      </header>
      <div className="mb-resume-list">
        {list === null ? (
          <div className="mb-empty">carregando sessões...</div>
        ) : list.length === 0 ? (
          <div className="mb-empty">nenhuma sessão retomável</div>
        ) : (
          list.map((s) => (
            <button type="button" key={s.id} className="mb-resume-card" onClick={() => onPick(s)}>
              <span className="mb-resume-row">
                <span className="mb-resume-proj">{s.project}</span>
                <span className="mb-resume-age">{s.age}{s.live ? ' · ativa' : ''}</span>
              </span>
              <span className="mb-resume-label">{s.label}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// shell
// ------------------------------------------------------------------

export default function MobileShell() {
  const { sessions, error } = useSessions();
  const [tab, setTab] = useState('hoje');
  const [selected, setSelected] = useState(null); // dossie de agente
  const [overlay, setOverlay] = useState(null); // { type:'note'|'base'|'canvas', path }
  const [graphMounted, setGraphMounted] = useState(false);
  const [termMounted, setTermMounted] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [pendingCmd, setPendingCmd] = useState(null);
  const now = useNowTicker(1000);
  // Notificacoes: MESMO diff de estados do desktop (esperando/terminou). Toast
  // in-app funciona sempre; Web Notification no iOS so como PWA instalada (16.4+).
  const { toasts, dismiss } = useSessionNotifications(sessions);
  const openNote = (p) => p && setOverlay({ type: 'note', path: p });
  const openBase = (p) => p && setOverlay({ type: 'base', path: p });
  const openCanvas = (p) => p && setOverlay({ type: 'canvas', path: p });

  useEffect(() => {
    if (tab === 'grafo') setGraphMounted(true);
    if (tab === 'terminal') setTermMounted(true);
  }, [tab]);

  return (
    <div className="mobile-root">
      <header className="mb-head">
        <span className="mb-logo">FAROL</span>
        <span className="mb-head-meta">
          {Array.isArray(sessions) ? activityLabel(sessions) : 'sync...'}
        </span>
        <ThemeButton />
      </header>

      {tab === 'hoje' ? (
        <MobileHoje now={now} onSelect={setSelected} onOpenNote={openNote} />
      ) : null}
      {tab === 'torre' ? (
        <MonitorTab sessions={sessions} error={error} now={now} onSelect={setSelected} />
      ) : null}
      {tab === 'cockpit' ? (
        <MobileCockpit now={now} />
      ) : null}
      {tab === 'uso' ? (
        <div className="mb-body mb-uso">
          <Uso onAgent={setSelected} />
        </div>
      ) : null}
      {tab === 'diario' ? (
        <div className="mb-body">
          <Diary onOpenNote={openNote} />
        </div>
      ) : null}
      {tab === 'notas' ? (
        <NotesTab
          activePath={overlay && overlay.type === 'note' ? overlay.path : null}
          onOpen={openNote}
          onOpenBase={openBase}
          onOpenCanvas={openCanvas}
        />
      ) : null}
      {tab === 'agenda' ? (
        <div className="mb-body mb-agenda">
          <Suspense fallback={<div className="mb-empty">carregando agenda...</div>}>
            <Agenda onOpenNote={openNote} />
          </Suspense>
        </div>
      ) : null}
      {graphMounted ? (
        <div className={`mb-graph${tab === 'grafo' ? '' : ' mb-hidden'}`}>
          <Graph scope="global" path={null} onOpen={openNote} />
          <PerfHud />
        </div>
      ) : null}
      {termMounted ? (
        <div className={`mb-term${tab === 'terminal' ? '' : ' mb-hidden'}`}>
          <button type="button" className="mb-resume-open" onClick={() => setResumeOpen(true)}>
            ↺ retomar
          </button>
          <Suspense fallback={<div className="mb-empty">carregando terminal...</div>}>
            <LocalPane
              visible={tab === 'terminal'}
              onStatus={NOOP}
              touchKeys
              pendingCmd={pendingCmd}
              onCmdSent={() => setPendingCmd(null)}
            />
          </Suspense>
          {resumeOpen ? (
            <ResumePicker
              onClose={() => setResumeOpen(false)}
              onPick={(s) => {
                const cmd = buildResumeCmd(s);
                if (cmd) setPendingCmd(cmd);
                setResumeOpen(false);
              }}
            />
          ) : null}
        </div>
      ) : null}

      <nav className="mb-nav" aria-label="Navegacao">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mb-nav-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <ContentOverlay overlay={overlay} onClose={() => setOverlay(null)} onNavigate={openNote} />
      <div className="dossier-host">
        <Dossier
          selected={selected}
          sessions={sessions}
          apiRef={null}
          onClose={() => setSelected(null)}
          onOpenNote={undefined}
          onSelect={setSelected}
        />
      </div>

      {/* toasts acima da tab bar (safe-area iOS); tap abre o dossie da sessao */}
      <Toasts
        toasts={toasts}
        onDismiss={dismiss}
        onSelect={(sessionId) => setSelected({ type: 'session', sessionId })}
      />
    </div>
  );
}
