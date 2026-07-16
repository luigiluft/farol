// FAROL - command palette Ctrl+K (A3, F2).
// Modal central com resultados mistos: notas (fuzzy enquanto digita; semantica
// via toggle cerebro + item "buscar semanticamente" no Enter) + acoes rapidas
// (ir para view, abrir nota atual no Obsidian via obsidian://, alternar tema).
// Setas navegam, Enter executa, Esc fecha, clique no backdrop fecha.
// Animacao: backdrop fade + painel scale 0.98 -> 1 (so transform/opacity).
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, normalizeSearchResults } from './api.js';
import { getTheme, setTheme } from './theme.js';
import './palette.css';

const OBSIDIAN_VAULT = 'Obsidian Vault';
const FUZZY_DEBOUNCE_MS = 180;

export default function Palette(props) {
  if (!props.open) return null;
  return <PaletteModal {...props} />;
}

function PaletteModal({ onClose, notePath, views, onGoView, onOpenNote }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const search = usePaletteSearch(query, semantic);
  const items = useMemo(
    () => buildItems({ query, semantic, notes: search.notes, views, notePath }),
    [query, semantic, search.notes, views, notePath],
  );
  const [sel, setSel] = usePaletteSelection(items.length, query, semantic, listRef);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  function execute(item) {
    if (!item) return;
    if (item.id === 'run-semantic') {
      search.run('/api/search/semantic?q=' + encodeURIComponent(query.trim()));
      return;
    }
    if (item.kind === 'nota') onOpenNote(item.path);
    else if (item.id.startsWith('view-')) onGoView(item.id.slice(5));
    else if (item.id === 'obsidian') openInObsidian(notePath);
    else if (item.id === 'theme') setTheme(getTheme() === 'light' ? 'dark' : 'light');
    onClose();
  }

  const onKeyDown = makeKeyHandler({ items, sel, setSel, execute, onClose });
  return (
    <div className="pal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="pal-panel panel"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
      >
        <PaletteInput
          inputRef={inputRef}
          query={query}
          semantic={semantic}
          onQuery={setQuery}
          onToggleSemantic={() => setSemantic((s) => !s)}
        />
        <PaletteList
          listRef={listRef}
          items={items}
          busy={search.busy}
          error={search.error}
          sel={sel}
          onHover={setSel}
          onPick={execute}
        />
        <div className="pal-foot mono dim">setas navegam · Enter abre · Esc fecha</div>
      </div>
    </div>
  );
}

// Setas movem a selecao (com wrap), Enter executa, Esc fecha. O handler e
// recriado a cada render, entao fecha sobre o sel corrente sem ler o DOM.
function makeKeyHandler({ items, sel, setSel, execute, onClose }) {
  return function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSel((s) => (s + delta + items.length) % items.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      execute(items[sel]);
    }
  };
}

// Busca fuzzy com debounce (fora do modo semantico); modo semantico so roda
// via item "buscar semanticamente" (run). seq descarta respostas atrasadas.
function usePaletteSearch(query, semantic) {
  const seqRef = useRef(0);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(url) {
    const seq = (seqRef.current += 1);
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson(url);
      if (seq !== seqRef.current) return;
      setNotes(normalizeSearchResults(data));
    } catch (err) {
      if (seq !== seqRef.current) return;
      setNotes([]);
      setError(err.message || 'erro na busca');
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (semantic || q.length < 2) {
      setNotes(null);
      setError(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      run('/api/search?q=' + encodeURIComponent(q));
    }, FUZZY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, semantic]);

  return { notes, busy, error, run };
}

// Selecao por teclado: reseta na query, clampa quando a lista muda e mantem
// o item selecionado visivel no scroll.
function usePaletteSelection(count, query, semantic, listRef) {
  const [sel, setSel] = useState(0);

  useEffect(() => {
    setSel(0);
  }, [query, semantic]);

  useEffect(() => {
    if (sel > count - 1) setSel(Math.max(0, count - 1));
  }, [count, sel]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('.pal-item.selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [sel, count, listRef]);

  return [sel, setSel];
}

function PaletteInput({ inputRef, query, semantic, onQuery, onToggleSemantic }) {
  return (
    <div className="pal-input-row">
      <input
        ref={inputRef}
        className="pal-input"
        type="text"
        value={query}
        placeholder={semantic ? 'Busca semântica (Enter executa)' : 'Buscar notas ou ações...'}
        aria-label="Buscar notas ou ações"
        autoComplete="off"
        onChange={(e) => onQuery(e.target.value)}
      />
      <button
        type="button"
        className={'pal-brain' + (semantic ? ' on' : '')}
        title={semantic ? 'Busca semântica ativa' : 'Ativar busca semântica'}
        aria-pressed={semantic}
        onClick={onToggleSemantic}
      >
        <PalBrainIcon />
      </button>
    </div>
  );
}

function PaletteList({ listRef, items, busy, error, sel, onHover, onPick }) {
  return (
    <div className="pal-list" ref={listRef}>
      {busy && <div className="pal-status dim mono">buscando...</div>}
      {error && !busy && <div className="pal-status crit mono">{error}</div>}
      {!busy && !error && items.length === 0 && (
        <div className="pal-status dim mono">nada encontrado</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          className={'pal-item' + (i === sel ? ' selected' : '')}
          title={item.sub || item.label}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
        >
          <span className={'pal-kind kind-' + item.kind} aria-hidden="true">
            {item.kind}
          </span>
          <span className="pal-label">{item.label}</span>
          {item.sub && <span className="pal-sub">{item.sub}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// montagem da lista (busca semantica + notas + acoes filtradas)
// ---------------------------------------------------------------
function buildItems({ query, semantic, notes, views, notePath }) {
  const q = query.trim().toLowerCase();
  const head = [];
  if (semantic && q.length >= 2) {
    head.push({
      id: 'run-semantic',
      kind: 'busca',
      label: 'Buscar semanticamente: "' + query.trim() + '"',
    });
  }
  const noteItems = (notes || []).map((n) => ({
    id: 'note:' + n.path,
    kind: 'nota',
    label: n.title,
    sub: n.path,
    path: n.path,
  }));
  const actions = buildActions({ views, notePath }).filter(
    (a) => !q || a.label.toLowerCase().includes(q),
  );
  return [...head, ...noteItems, ...actions];
}

function buildActions({ views, notePath }) {
  const actions = views.map((v) => ({
    id: 'view-' + v.id,
    kind: 'acao',
    label: 'Ir para ' + v.label,
  }));
  if (notePath) {
    actions.push({ id: 'obsidian', kind: 'acao', label: 'Abrir nota atual no Obsidian' });
  }
  actions.push({ id: 'theme', kind: 'acao', label: 'Alternar tema claro/escuro' });
  return actions;
}

function openInObsidian(notePath) {
  if (typeof notePath !== 'string' || !notePath) return;
  const file = notePath.replace(/\.md$/i, '');
  window.location.href =
    'obsidian://open?vault=' +
    encodeURIComponent(OBSIDIAN_VAULT) +
    '&file=' +
    encodeURIComponent(file);
}

// Icone cerebro: SVG inline monocromatico (mesmo desenho da busca da sidebar;
// duplicado de proposito para nao criar import circular com App.jsx).
function PalBrainIcon() {
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
