// FAROL - shell do app (A3 na F2; A4 e dono na F4; F7 tema + agenda).
// Layout: coluna esquerda colapsada (Opcao B) + centro em tela cheia; o
// painel OPERACOES da direita foi REMOVIDO (2026-07-10, decisao do dono —
// Cockpit/rail cobrem o glance; dossie global + toasts seguem no shell).
// F4: tab TORRE (TorreView) e a DEFAULT; App envolve tudo no
// SessionsProvider (UM fetch + UM SSE de sessoes para o app inteiro);
// titulo do document = "FAROL · N em voo" vivo.
// F2: Ctrl+K abre a command palette; troca de tab tem fade 120ms; o host do
// Terminal fica montado (display:none) para o PTY viver entre trocas.
// F7: tab Terminal INCONDICIONAL (o espelho de sessoes existe sempre;
// Terminal.jsx esconde a aba local quando o PTY nao esta disponivel);
// tab Agenda nova (lazy, recebe {onOpenNote}); toggle sol/lua de tema no
// center-header (theme.js e a fonte unica; initTheme roda no main.jsx).
// Contratos com os vizinhos: Projects recebe {onOpen}; Graph recebe
// {scope,path,onOpen}; Room recebe {fullscreen} e re-exporta FlightBoard;
// StatsBar e Feed sem props; TorreView e Agenda recebem {onOpenNote}.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Tree from './Tree.jsx';
import NoteView from './NoteView.jsx';
import BaseView from './BaseView.jsx';
import CanvasView from './CanvasView.jsx';
import Graph from './Graph.jsx';
import Projects from './Projects.jsx';
import Room from './Room.jsx';
import Palette from './Palette.jsx';
import TorreView from './TorreView.jsx';
import Cockpit from './Cockpit.jsx';
import Uso from './Uso.jsx';
import Toasts from './Toasts.jsx';
import { useSessionNotifications } from './notify.js';
import Diary from './Diary.jsx';
import Comando from './Comando.jsx';
import Esteira from './Esteira.jsx';
import Dossier from './Dossier.jsx';
import MobileShell from './MobileShell.jsx';
import Settings from './Settings.jsx';
import { getTheme, setTheme, onThemeChange } from './theme.js';
import {
  fetchJson, normalizeSearchResults, SessionsProvider, useSessionsCtx,
} from './api.js';
import './note.css';
import './motion.css';

const TerminalView = lazy(() => import('./Terminal.jsx'));
const Agenda = lazy(() => import('./Agenda.jsx'));

// Fusao de abas (2026-07-02): 'grafo' e 'terminal' SAIRAM da barra mas as
// views seguem rotaveis (renderCenterView) — Grafo abre pelo botao 'explorar'
// do HUD da Torre e por 'abrir no grafo' (Projetos/Nota); o shell LOCAL vive
// no chip do Cockpit (aba Terminal antiga = redundancia aposentada).
const BASE_VIEWS = [
  { id: 'comando', label: 'Hoje' },
  { id: 'torre', label: 'Cérebro' },
  { id: 'nota', label: 'Notas' },
  { id: 'projetos', label: 'Projetos' },
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'uso', label: 'Uso' },
  { id: 'esteira', label: 'Esteira' },
  // refactor v2 F3: fora da BARRA mas rotaveis (palette/links/HOJE) — a
  // funcao fundiu em outra tela; hidden nao aparece na nav nem persiste
  // como aba, so renderiza quando navegado.
  { id: 'diario', label: 'Diário', hidden: true },
  { id: 'agenda', label: 'Agenda', hidden: true },
  { id: 'sala', label: 'Sala', hidden: true },
];

const VIEW_FADE_MS = 120;
const MOBILE_MQ = '(max-width: 700px)';

// F-Personalizacao (Frente 2, fatia mecanica): layout salvo. Persiste a aba
// ativa em localStorage, validando contra o conjunto de views real (uma
// chave velha de view removida cai em 'torre', nunca renderiza aba morta).
const LAST_VIEW_KEY = 'torre.lastView';
const VIEW_IDS = new Set(BASE_VIEWS.map((v) => v.id));

function readStartView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return v && VIEW_IDS.has(v) ? v : 'comando';
  } catch {
    return 'comando';
  }
}

function writeLastView(view) {
  try {
    localStorage.setItem(LAST_VIEW_KEY, view);
  } catch {
    // localStorage indisponivel (modo privado/quota): persistencia e best-effort
  }
}

// Shell mobile: viewport estreito (celular via Tailscale) OU rota /m
// (forca manual p/ testar no desktop). Hook SEMPRE roda (ordem de
// hooks estavel); o App decide o shell no return.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_MQ).matches || window.location.pathname === '/m',
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const update = () => {
      setIsMobile(mq.matches || window.location.pathname === '/m');
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export default function App() {
  const [view, setView] = useState(readStartView);
  const [notePath, setNotePath] = useState(null);
  const [basePath, setBasePath] = useState(null);
  const [canvasPath, setCanvasPath] = useState(null);
  const [graphScope, setGraphScope] = useState('global');
  // dossie global: clique no painel de agentes da direita abre os
  // detalhes (missao/acoes/tokens/subagentes) em QUALQUER view.
  const [agentSel, setAgentSel] = useState(null);
  const searchControl = useRef(null);
  const centerRef = useRef(null);
  const isMobile = useIsMobile();
  const views = BASE_VIEWS.filter((v) => !v.hidden);

  useEffect(() => {
    if (centerRef.current) centerRef.current.scrollTop = 0;
  }, [notePath]);

  // Layout salvo: persiste a aba ativa a cada troca (restaurada no proximo boot).
  useEffect(() => {
    writeLastView(view);
  }, [view]);

  if (isMobile) {
    return (
      <SessionsProvider>
        <TitleSync />
        <MobileShell />
      </SessionsProvider>
    );
  }

  function openNote(path) {
    if (typeof path !== 'string') return;
    setNotePath(path || null);
    if (path) setView('nota');
  }

  function openBase(path) {
    if (typeof path !== 'string' || !path) return;
    setBasePath(path);
    setView('base');
  }

  function openCanvas(path) {
    if (typeof path !== 'string' || !path) return;
    setCanvasPath(path);
    setView('canvas');
  }

  function searchTag(tag) {
    if (searchControl.current) searchControl.current.setQuery(tag);
  }

  return (
    <SessionsProvider>
      <TitleSync />
      <div className="app-shell left-hidden">
        {/* Opcao B: notas migraram pra aba dedicada; a coluna esquerda fica
            colapsada (left-hidden) pro grafo/centro ocuparem a largura toda.
            O aside vazio segura a 1a coluna do grid (0px). */}
        <aside className="zone-left" aria-hidden="true" />
        <CenterZone
          view={view}
          setView={setView}
          views={views}
          notePath={notePath}
          basePath={basePath}
          canvasPath={canvasPath}
          centerRef={centerRef}
          openNote={openNote}
          openBase={openBase}
          openCanvas={openCanvas}
          searchControl={searchControl}
          searchTag={searchTag}
          graphScope={graphScope}
          setGraphScope={setGraphScope}
          onSelectAgent={setAgentSel}
        />
        <PaletteHost notePath={notePath} views={views} onGoView={setView} onOpenNote={openNote} />
        <GlobalDossier
          selected={agentSel}
          onClose={() => setAgentSel(null)}
          onSelect={setAgentSel}
          onOpenNote={openNote}
        />
        <NotifyHost onSelectAgent={setAgentSel} />
      </div>
    </SessionsProvider>
  );
}

// Onda 3: host de notificacoes — consome o MESMO SSE do provider; toast de
// 'esperando'/'terminou' abre o dossie da sessao no clique (contrato do
// onSelectAgent, igual Sala/painel).
function NotifyHost({ onSelectAgent }) {
  const ctx = useSessionsCtx();
  const sessions = ctx ? ctx.sessions : null;
  const { toasts, dismiss } = useSessionNotifications(sessions);
  return (
    <Toasts
      toasts={toasts}
      onDismiss={dismiss}
      onSelect={(sessionId) => onSelectAgent({ type: 'session', sessionId })}
    />
  );
}

// Dossie global por cima do shell: mesmo componente do modo TORRE,
// alimentado pelo pipeline compartilhado de sessoes. Sem apiRef do
// grafo aqui ("focar no universo" fica desabilitado fora da TORRE).
function GlobalDossier({ selected, onClose, onSelect, onOpenNote }) {
  const ctx = useSessionsCtx();
  const sessions = ctx ? ctx.sessions : null;
  return (
    <div className="dossier-host">
      <Dossier
        selected={selected}
        sessions={sessions}
        apiRef={null}
        onClose={onClose}
        onOpenNote={onOpenNote}
        onSelect={onSelect}
      />
    </div>
  );
}

// Titulo da aba do browser vivo via SSE: "FAROL · N em voo".
// Le o contexto de sessoes (mesmo pipeline da sala/voos, zero fetch extra).
function TitleSync() {
  const ctx = useSessionsCtx();
  const sessions = ctx ? ctx.sessions : null;
  useEffect(() => {
    if (!Array.isArray(sessions)) {
      document.title = 'FAROL';
      return;
    }
    const ativas = sessions.filter((s) => s && s.state === 'ativa').length;
    document.title = `FAROL · ${ativas} ${ativas === 1 ? 'agente ativo' : 'agentes ativos'}`;
  }, [sessions]);
  return null;
}

// Dono do estado da palette: Ctrl+K abre/fecha de qualquer lugar.
function PaletteHost({ notePath, views, onGoView, onOpenNote }) {
  const [open, setOpen] = useState(false);
  usePaletteHotkey(setOpen);
  return (
    <Palette
      open={open}
      onClose={() => setOpen(false)}
      notePath={notePath}
      views={views}
      onGoView={onGoView}
      onOpenNote={onOpenNote}
    />
  );
}

// ---------------------------------------------------------------
// hooks do shell
// ---------------------------------------------------------------

// Ctrl+K abre/fecha a command palette de qualquer lugar.
function usePaletteHotkey(setOpen) {
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

// Troca de view com fade: 'shown' segura a view anterior por 120ms com a
// classe .out (fade + translateY), depois troca e anima a entrada.
function useViewTransition(view) {
  const [shown, setShown] = useState(view);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (view === shown) return undefined;
    setOut(true);
    const t = setTimeout(() => {
      setShown(view);
      setOut(false);
    }, VIEW_FADE_MS);
    return () => clearTimeout(t);
  }, [view, shown]);
  return { shown, out };
}

// ---------------------------------------------------------------
// zona central: breadcrumb + tabs + view ativa com transicao
// ---------------------------------------------------------------
function CenterZone({ view, setView, views, notePath, basePath, canvasPath, centerRef, openNote, openBase, openCanvas, searchControl, searchTag, graphScope, setGraphScope, onSelectAgent }) {
  const { shown, out } = useViewTransition(view);
  const [termMounted, setTermMounted] = useState(false);

  useEffect(() => {
    if (view === 'terminal') setTermMounted(true);
  }, [view]);

  // 'nota' agora e o workspace de Notas (arvore+busca+leitor) => tela cheia.
  const isFull = shown !== 'projetos' && shown !== 'agenda' && shown !== 'diario' && shown !== 'comando' && shown !== 'base';
  const termVisible = shown === 'terminal';
  return (
    <main className="zone-center">
      <header className="center-header">
        <div className="center-head-left">
          <span className="center-logo">FAROL</span>
          <HeaderTitle view={view} notePath={notePath} basePath={basePath} canvasPath={canvasPath} />
        </div>
        {view === 'grafo' && notePath && (
          <GraphScopeTabs scope={graphScope} onChange={setGraphScope} />
        )}
        <div className="center-actions">
          <nav className="tabs" aria-label="Visualização">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                className={'btn-tab' + (view === v.id ? ' active' : '')}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </nav>
          <ThemeToggle />
          <PrefsButton />
        </div>
      </header>
      <section ref={centerRef} className={'center-body' + (isFull ? ' is-full' : '')}>
        {!termVisible && (
          <div className={'view-fade' + (out ? ' out' : '')}>
            {renderCenterView(shown, { notePath, basePath, canvasPath, openNote, openBase, openCanvas, searchControl, searchTag, graphScope, onGoView: setView, onSelectAgent })}
          </div>
        )}
        {termMounted && (
          <div className={'terminal-host' + (out ? ' out' : '') + (termVisible ? '' : ' hidden')}>
            <Suspense fallback={<div className="stub-placeholder">carregando terminal...</div>}>
              <TerminalView active={termVisible} />
            </Suspense>
          </div>
        )}
      </section>
    </main>
  );
}

// Terminal vive FORA do fade (montagem persistente via .terminal-host).
function renderCenterView(shown, { notePath, basePath, canvasPath, openNote, openBase, openCanvas, searchControl, searchTag, graphScope, onGoView, onSelectAgent }) {
  if (shown === 'base') return <BaseView path={basePath} onOpenNote={openNote} />;
  if (shown === 'canvas') return <CanvasView path={canvasPath} onOpenNote={openNote} />;
  if (shown === 'comando') return <Comando onOpenNote={openNote} onGoView={onGoView} />;
  if (shown === 'torre') return <TorreView onOpenNote={openNote} onGoView={onGoView} />;
  if (shown === 'diario') return <Diary onOpenNote={openNote} />;
  if (shown === 'nota') {
    return (
      <NotasWorkspace
        notePath={notePath}
        openNote={openNote}
        openBase={openBase}
        openCanvas={openCanvas}
        searchControl={searchControl}
        searchTag={searchTag}
      />
    );
  }
  if (shown === 'projetos') return <Projects onOpen={openNote} />;
  if (shown === 'agenda') {
    return (
      <Suspense fallback={<div className="stub-placeholder">carregando agenda...</div>}>
        <Agenda onOpenNote={openNote} />
      </Suspense>
    );
  }
  if (shown === 'grafo') {
    return <Graph scope={notePath ? graphScope : 'global'} path={notePath} onOpen={openNote} />;
  }
  if (shown === 'sala') return <Room fullscreen onSelect={onSelectAgent} />;
  if (shown === 'cockpit') return <Cockpit />;
  if (shown === 'uso') return <Uso onAgent={onSelectAgent} />;
  if (shown === 'esteira') return <Esteira />;
  return null;
}

// ---------------------------------------------------------------
// aba NOTAS dedicada (Opcao B): browser (busca + arvore) + leitor num so
// lugar. Recebe o SearchBox/Tree que viviam na coluna esquerda; a coluna
// agora fica colapsada e o grafo/centro ganham a largura toda.
// ---------------------------------------------------------------
function NotasWorkspace({ notePath, openNote, openBase, openCanvas, searchControl, searchTag }) {
  return (
    <div className="notas-workspace">
      <aside className="notas-side panel">
        <SearchBox controlRef={searchControl} onOpen={openNote} />
        <Tree activePath={notePath} onSelect={openNote} onOpenBase={openBase} onOpenCanvas={openCanvas} />
      </aside>
      <div className="notas-main">
        {notePath ? (
          <NoteView path={notePath} onNavigate={openNote} onTagClick={searchTag} />
        ) : (
          <div className="notas-empty">selecione uma nota na árvore ou busque acima</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// toggle de tema sol/lua (F7 C1.3): mostra o icone do tema DESTINO
// (lua no claro = "mudar para escuro"); theme.js persiste e avisa.
// ---------------------------------------------------------------
function ThemeToggle() {
  const [theme, setLocal] = useState(getTheme);
  useEffect(() => onThemeChange(setLocal), []);
  const isLight = theme === 'light';
  const title = isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro';
  return (
    <button
      type="button"
      className="theme-toggle"
      title={title}
      aria-label={title}
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
    >
      {isLight ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

// Botao de preferencias (Frente 2): gear no center-header abre o popover de
// personalizacao (acento + densidade). Fecha no clique-fora / Esc.
function PrefsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);
  return (
    <div className="prefs-host" ref={ref}>
      <button
        type="button"
        className="theme-toggle"
        title="Preferências"
        aria-label="Preferências"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GearIcon />
      </button>
      {open ? <Settings onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.3v1.8M8 12.9v1.8M14.7 8h-1.8M3.1 8H1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3M12.7 12.7l-1.3-1.3M4.6 4.6 3.3 3.3" />
    </svg>
  );
}

// Icones sol/lua: SVG inline monocromatico (nao emoji).
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.4 9.6a5.6 5.6 0 0 1-7-7 5.9 5.9 0 1 0 7 7Z" />
    </svg>
  );
}

function GraphScopeTabs({ scope, onChange }) {
  return (
    <nav className="tabs" aria-label="Escopo do grafo">
      <button
        type="button"
        className={'btn-tab' + (scope === 'global' ? ' active' : '')}
        onClick={() => onChange('global')}
      >
        Global
      </button>
      <button
        type="button"
        className={'btn-tab' + (scope === 'local' ? ' active' : '')}
        onClick={() => onChange('local')}
      >
        Local
      </button>
    </nav>
  );
}

// Titulo do center-header dinamico por view (F7): no Terminal o breadcrumb
// de vault nao tem relacao com o contexto — mostra o espelho com contagem
// viva de sessoes; na Agenda, rotulo proprio; demais views (nota, torre,
// projetos, grafo, sala) mantem o breadcrumb do vault como antes.
function HeaderTitle({ view, notePath, basePath, canvasPath }) {
  if (view === 'terminal') return <MirrorTitle />;
  if (view === 'agenda') return <span className="breadcrumb dim">agenda</span>;
  if (view === 'base') {
    return (
      <span className="breadcrumb" title={basePath}>
        <span className="dim">base</span>
        <span className="crumb-sep dim"> › </span>
        <span className="crumb-leaf">{(basePath || '').split('/').pop().replace(/\.base$/i, '')}</span>
      </span>
    );
  }
  if (view === 'canvas') {
    return (
      <span className="breadcrumb" title={canvasPath}>
        <span className="dim">canvas</span>
        <span className="crumb-sep dim"> › </span>
        <span className="crumb-leaf">{(canvasPath || '').split('/').pop().replace(/\.canvas$/i, '')}</span>
      </span>
    );
  }
  return <Breadcrumb notePath={notePath} />;
}

// "espelho · N em voo": mesma contagem do TitleSync, via contexto
// compartilhado de sessoes (zero fetch/SSE extra).
function MirrorTitle() {
  const ctx = useSessionsCtx();
  const sessions = ctx ? ctx.sessions : null;
  if (!Array.isArray(sessions)) return <span className="breadcrumb dim">espelho</span>;
  const ativas = sessions.filter((s) => s && s.state === 'ativa').length;
  return <span className="breadcrumb dim">{`espelho · ${ativas} ${ativas === 1 ? 'agente ativo' : 'agentes ativos'}`}</span>;
}

function Breadcrumb({ notePath }) {
  if (!notePath) return <span className="breadcrumb dim">vault</span>;
  const parts = notePath.replace(/\.md$/i, '').split('/');
  return (
    <span className="breadcrumb" title={notePath}>
      <span className="dim">vault</span>
      {parts.map((part, i) => (
        <span key={notePath + '#' + i}>
          <span className="crumb-sep dim"> › </span>
          {i === parts.length - 1 ? (
            <span className="crumb-leaf">{part}</span>
          ) : (
            <span className="dim">{part}</span>
          )}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------
// busca da sidebar: fuzzy enquanto digita, semantica (cerebro) no Enter
// (a palette Ctrl+K cobre busca + acoes; esta fica para uso com mouse)
// ---------------------------------------------------------------
function SearchBox({ controlRef, onOpen }) {
  const inputRef = useRef(null);
  const seqRef = useRef(0);
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!controlRef) return undefined;
    controlRef.current = {
      focus: () => inputRef.current && inputRef.current.focus(),
      setQuery: (q) => {
        setSemantic(false);
        setQuery(q);
        if (inputRef.current) inputRef.current.focus();
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

  useEffect(() => {
    if (semantic) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch('/api/search?q=' + encodeURIComponent(q));
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, semantic]);

  async function runSearch(url) {
    const seq = (seqRef.current += 1);
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson(url);
      if (seq !== seqRef.current) return;
      setResults(normalizeSearchResults(data));
    } catch (err) {
      if (seq !== seqRef.current) return;
      setResults([]);
      setError(err.message || 'erro na busca');
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setQuery('');
      setResults(null);
      e.target.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    const q = query.trim();
    if (!q) return;
    if (semantic) {
      runSearch('/api/search/semantic?q=' + encodeURIComponent(q));
      return;
    }
    if (results && results.length > 0) pick(results[0]);
  }

  function pick(result) {
    setQuery('');
    setResults(null);
    onOpen(result.path);
  }

  return (
    <div className="search-wrap">
      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          value={query}
          placeholder={semantic ? 'Busca semântica (Enter)' : 'Buscar no vault'}
          aria-label="Buscar no vault"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={'brain-btn' + (semantic ? ' on' : '')}
          title={semantic ? 'Busca semântica ativa' : 'Ativar busca semântica'}
          aria-pressed={semantic}
          onClick={() => setSemantic((s) => !s)}
        >
          <BrainIcon />
        </button>
      </div>
      {semantic && <div className="search-hint dim">semântica ativa: Enter para buscar</div>}
      {(results !== null || busy || error) && (
        <SearchResults results={results} busy={busy} error={error} onPick={pick} />
      )}
    </div>
  );
}

function SearchResults({ results, busy, error, onPick }) {
  return (
    <div className="search-results panel">
      {busy && <div className="search-status dim mono">buscando...</div>}
      {error && !busy && <div className="search-status crit mono">{error}</div>}
      {!busy && !error && results && results.length === 0 && (
        <div className="search-status dim mono">nada encontrado</div>
      )}
      {!busy &&
        results &&
        results.length > 0 &&
        results.map((r, i) => (
          <button
            key={r.path + '#' + i}
            type="button"
            className="result-item"
            title={r.path}
            onClick={() => onPick(r)}
          >
            <span className="result-title">{r.title}</span>
            <span className="result-path dim mono">{r.path}</span>
          </button>
        ))}
    </div>
  );
}

// Icone cerebro: SVG inline monocromatico (nao emoji), dois lobos + sulco.
function BrainIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.6 C5.6 1.4 3.4 2.9 3.7 5 C2.2 5.6 2.2 7.9 3.5 8.6 C3 10.6 4.6 12.1 6.4 11.7 C6.9 13.2 8 13.4 8 13.4" />
      <path d="M8 2.6 C10.4 1.4 12.6 2.9 12.3 5 C13.8 5.6 13.8 7.9 12.5 8.6 C13 10.6 11.4 12.1 9.6 11.7 C9.1 13.2 8 13.4 8 13.4" />
      <path d="M8 2.6 L8 13.4" />
    </svg>
  );
}
