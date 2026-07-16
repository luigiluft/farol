// FAROL - renderizador de nota (agente M; F2 editor in-place pelo A3).
// Frontmatter vira chips (status com cor, tags clicaveis, datas, extras),
// H1 grande, corpo via pipeline markdown, painel de backlinks no rodape.
// Estados de loading (skeleton pulsante) e erro desenhados, nunca crus.
// F2: botao "editar" (atalho E) abre textarea estilizada; Ctrl+S salva via
// POST /api/note com baseMtimeMs (GET ainda sem mtimeMs -> manda 0 e trata
// o 409), Esc cancela com confirm se sujo, banner de conflito 409 com
// recarregar/sobrescrever, contador de palavras.
// Tarefa 2.2: strip "sessoes que tocaram" apos os backlinks, consumindo o
// indice reverso de GET /api/note-sessions?path= (Tarefa 2.1). Backfill
// incremental no server: 1a chamada pode vir ready:false com sessoes
// parciais -> mostra o que veio + "indexando..." (sem polling na v1).
import { useEffect, useRef, useState } from 'react';
import { fetchJson, postJson, useApi } from './api.js';
import ObsidianMarkdown from './markdown.jsx';
import KanbanBoard from './KanbanBoard.jsx';
import { isKanbanNote } from './kanban-parse.js';
import './editor.css';
import './touched-by.css';

const DATE_KEYS = [
  'created',
  'criado',
  'criada',
  'date',
  'data',
  'updated',
  'atualizado',
  'modified',
  'modificado',
];

const STATUS_TONES = {
  done: 'ok',
  concluido: 'ok',
  concluida: 'ok',
  ativo: 'ok',
  ativa: 'ok',
  live: 'ok',
  ok: 'ok',
  wip: 'warn',
  andamento: 'warn',
  draft: 'warn',
  rascunho: 'warn',
  pausado: 'warn',
  pausada: 'warn',
  soak: 'warn',
  blocked: 'crit',
  bloqueado: 'crit',
  bloqueada: 'crit',
  morto: 'crit',
  morta: 'crit',
  cancelado: 'crit',
  cancelada: 'crit',
  arquivado: 'dim',
  arquivada: 'dim',
  archived: 'dim',
};

export default function NoteView({ path, onNavigate, onTagClick }) {
  if (!path) return <EmptyState />;
  return <NoteLoader key={path} path={path} onNavigate={onNavigate} onTagClick={onTagClick} />;
}

function NoteLoader({ path, onNavigate, onTagClick }) {
  const { data, error, loading, reload } = useApi('/api/note?path=' + encodeURIComponent(path));
  const [editing, setEditing] = useState(false);
  useEditHotkey(Boolean(data) && !editing, () => setEditing(true));

  if (loading && !data) return <NoteSkeleton />;
  if (error) return <NoteError path={path} error={error} />;
  if (!data) return <NoteError path={path} error={new Error('resposta vazia do servidor')} />;
  if (editing) {
    return (
      <NoteEditor
        note={data}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          reload();
        }}
      />
    );
  }
  return (
    <NoteContent
      note={data}
      onNavigate={onNavigate}
      onTagClick={onTagClick}
      onEdit={() => setEditing(true)}
    />
  );
}

// Atalho E entra em edicao quando ha nota aberta e nenhum input focado.
function useEditHotkey(enabled, onEdit) {
  useEffect(() => {
    if (!enabled) return undefined;
    function onKey(e) {
      if (e.key !== 'e' && e.key !== 'E') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      onEdit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onEdit]);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function NoteContent({ note, onNavigate, onTagClick, onEdit }) {
  const chips = buildChips(note.frontmatter);
  return (
    <article className="note">
      <header className="note-head">
        <div className="note-head-row">
          <h1 className="note-title">{noteTitle(note)}</h1>
          <button
            type="button"
            className="note-edit-btn mono"
            title="Editar nota (E)"
            onClick={onEdit}
          >
            editar
          </button>
        </div>
        <ChipsRow chips={chips} onTagClick={onTagClick} />
      </header>
      {isKanbanNote(note.frontmatter) ? (
        <KanbanBoard markdown={note.markdown} links={note.links} onNavigate={onNavigate} />
      ) : (
        <ObsidianMarkdown
          markdown={note.markdown}
          notePath={note.path}
          links={note.links}
          onNavigate={onNavigate}
        />
      )}
      <Backlinks backlinks={note.backlinks} onNavigate={onNavigate} />
      <TouchedBy path={note.path} />
    </article>
  );
}

// ---------------------------------------------------------------
// chips de frontmatter
// ---------------------------------------------------------------
function ChipsRow({ chips, onTagClick }) {
  const hasAny =
    chips.tags.length > 0 || chips.status || chips.dates.length > 0 || chips.extras.length > 0;
  if (!hasAny) return null;
  return (
    <div className="note-chips">
      {chips.status && (
        <span className={statusChipClass(chips.status)}>{chips.status}</span>
      )}
      {chips.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className="chip chip-tag"
          title={'Buscar por ' + tag}
          onClick={() => onTagClick && onTagClick(tag)}
        >
          #{tag}
        </button>
      ))}
      {chips.dates.map((d) => (
        <span key={d.key} className="chip chip-dim" title={d.key}>
          ◷ {d.value}
        </span>
      ))}
      {chips.extras.map((x) => (
        <span key={x.key} className="chip chip-dim">
          {x.key}: {x.value}
        </span>
      ))}
    </div>
  );
}

function buildChips(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return { tags: [], status: null, dates: [], extras: [] };
  }
  const tags = normalizeTags(frontmatter.tags);
  const status = frontmatter.status != null ? String(frontmatter.status) : null;
  const dates = DATE_KEYS.filter((k) => frontmatter[k] != null).map((k) => ({
    key: k,
    value: formatDateValue(frontmatter[k]),
  }));
  const used = new Set(['tags', 'status', 'title', ...DATE_KEYS]);
  const extras = Object.entries(frontmatter)
    .filter(([k, v]) => !used.has(k) && (typeof v === 'string' || typeof v === 'number'))
    .slice(0, 3)
    .map(([k, v]) => ({ key: k, value: String(v) }));
  return { tags, status, dates, extras };
}

function normalizeTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).replace(/^#/, '')).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, ''))
      .filter(Boolean);
  }
  return [];
}

function formatDateValue(value) {
  const text = String(value);
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : text;
}

function statusChipClass(status) {
  const tone = STATUS_TONES[String(status).toLowerCase()] || 'info';
  return tone === 'info' ? 'chip' : 'chip chip-' + tone;
}

function noteTitle(note) {
  const fm = note.frontmatter || {};
  if (typeof fm.title === 'string' && fm.title.trim()) return fm.title;
  const base = String(note.path || '').split('/').pop() || '';
  return base.replace(/\.md$/i, '') || 'sem titulo';
}

// ---------------------------------------------------------------
// backlinks
// ---------------------------------------------------------------
function Backlinks({ backlinks, onNavigate }) {
  const list = Array.isArray(backlinks) ? backlinks : [];
  return (
    <footer className="backlinks">
      <h3 className="backlinks-title mono">
        Backlinks <span className="dim">({list.length})</span>
      </h3>
      {list.length === 0 ? (
        <p className="backlinks-empty dim">nenhuma nota aponta para cá</p>
      ) : (
        <div className="backlinks-grid">
          {list.map((b) => (
            <button
              key={b.path}
              type="button"
              className="backlink-card"
              title={b.path}
              onClick={() => onNavigate && onNavigate(b.path)}
            >
              <span className="backlink-title">{b.title}</span>
              <span className="backlink-path dim mono">{b.path}</span>
            </button>
          ))}
        </div>
      )}
    </footer>
  );
}

// ---------------------------------------------------------------
// sessoes que tocaram (indice reverso, Tarefa 2.2)
// ---------------------------------------------------------------
function timeAgo(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 3600e3) return `${Math.max(1, Math.round(d / 60e3))}min`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)}h`;
  return `${Math.round(d / 86400e3)}d`;
}

// path e o rel do vault (note.path, ecoado pelo servidor em GET /api/note).
// project vem cru do server e pode ser uma cadeia aninhada longa (ex.:
// "1-Projects-MinhaLoja"); so o ultimo
// segmento vira o label do chip, o valor cheio + id + count vao no title.
function TouchedBy({ path }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (path) {
      fetchJson(`/api/note-sessions?path=${encodeURIComponent(path)}`).then(
        (d) => { if (alive) setData(d); },
        () => {},
      );
    }
    return () => { alive = false; };
  }, [path]);
  if (!data) return null;
  const sessions = data.sessions || [];
  if (sessions.length === 0 && data.ready) return null;
  return (
    <div className="touched-by">
      <div className="touched-by-title">
        SESSÕES QUE TOCARAM{' '}
        {!data.ready && <span className="touched-by-pending">indexando…</span>}
      </div>
      {sessions.length > 0 && (
        <div className="touched-by-list">
          {sessions.map((s) => (
            <span
              key={s.id}
              className="touched-by-chip"
              title={s.project + ' · ' + s.id + ' · ' + s.count + ' toques'}
            >
              {(s.project || '').split('-').pop() || 'home'} · há {timeAgo(s.lastTs)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// estados vazios / loading / erro
// ---------------------------------------------------------------
function EmptyState() {
  return (
    <div className="note-empty">
      <div className="note-empty-glyph" aria-hidden="true">
        ◈
      </div>
      <p>selecione uma nota na árvore ou busque no vault</p>
      <p className="note-empty-kbd">
        <kbd>Ctrl</kbd> + <kbd>K</kbd> <span className="dim">para buscar</span>
      </p>
    </div>
  );
}

function NoteSkeleton() {
  return (
    <div className="note-skel" aria-hidden="true">
      <div className="skel skel-title" />
      <div className="skel-chip-row">
        <div className="skel skel-chip" />
        <div className="skel skel-chip" />
        <div className="skel skel-chip" />
      </div>
      <div className="skel skel-line w-95" />
      <div className="skel skel-line w-80" />
      <div className="skel skel-line w-90" />
      <div className="skel skel-line w-60" />
      <div className="skel skel-block" />
      <div className="skel skel-line w-85" />
      <div className="skel skel-line w-70" />
    </div>
  );
}

function NoteError({ path, error }) {
  return (
    <div className="note-state">
      <div className="note-state-glyph" aria-hidden="true">
        ×
      </div>
      <h2 className="note-state-title">não consegui abrir a nota</h2>
      <p className="note-state-path mono dim">{path}</p>
      <p className="note-state-msg">{error.message}</p>
      <p className="dim note-state-hint">
        verifique se o servidor do Farol está no ar e se o caminho ainda existe no vault
      </p>
    </div>
  );
}

// ---------------------------------------------------------------
// editor in-place (F2): textarea + Ctrl+S + conflito 409
// ---------------------------------------------------------------
function NoteEditor({ note, onCancel, onSaved }) {
  const ed = useEditorState(note);
  const areaRef = useRef(null);
  const dirty = ed.text !== ed.base.text;
  const h = makeEditorHandlers({ ed, dirty, onCancel, onSaved });

  useEffect(() => {
    if (areaRef.current) areaRef.current.focus();
  }, []);

  return (
    <div className="editor" onKeyDown={h.onKeyDown}>
      <EditorBar
        note={note}
        text={ed.text}
        dirty={dirty}
        saving={ed.saving}
        onSave={h.onSave}
        onCancel={h.onCancel}
      />
      <EditorNotices ed={ed} note={note} onReload={h.onReload} onOverwrite={h.onOverwrite} />
      <textarea
        ref={areaRef}
        className="editor-area mono"
        value={ed.text}
        spellCheck={false}
        aria-label="Editor de markdown"
        onChange={(e) => ed.setText(e.target.value)}
      />
    </div>
  );
}

// Handlers do editor: salvar, cancelar com confirm se sujo, recarregar do
// disco, sobrescrever apos 409 e atalhos Ctrl+S / Esc.
function makeEditorHandlers({ ed, dirty, onCancel, onSaved }) {
  const onSave = () => {
    if (dirty && !ed.saving) ed.persist(ed.base.mtimeMs, onSaved);
  };
  const onCancelSafe = () => {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return;
    onCancel();
  };
  const onReload = () => {
    if (dirty && !window.confirm('Descartar suas alterações e recarregar a versão do disco?')) {
      return;
    }
    ed.reloadFromDisk();
  };
  const onOverwrite = () => {
    if (ed.conflict && !ed.saving) ed.persist(ed.conflict.currentMtimeMs, onSaved);
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancelSafe();
    }
  };
  return { onSave, onCancel: onCancelSafe, onReload, onOverwrite, onKeyDown };
}

function EditorNotices({ ed, note, onReload, onOverwrite }) {
  return (
    <>
      {ed.conflict && (
        <ConflictBanner saving={ed.saving} onReload={onReload} onOverwrite={onOverwrite} />
      )}
      {ed.error && <div className="editor-error mono">{ed.error}</div>}
      <FrontmatterWarning note={note} />
    </>
  );
}

// Estado do editor: texto, base (mtime do GET; 0 se servidor ainda nao manda),
// conflito 409, persistencia e recarga do disco.
function useEditorState(note) {
  const initial = noteText(note);
  const [text, setText] = useState(initial);
  const [base, setBase] = useState({ mtimeMs: numberOr(note.mtimeMs, 0), text: initial });
  const [conflict, setConflict] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function persist(baseMtimeMs, onDone) {
    setSaving(true);
    setError(null);
    try {
      const res = await postJson('/api/note', { path: note.path, markdown: text, baseMtimeMs });
      setConflict(null);
      onDone(res);
    } catch (err) {
      if (err && err.status === 409) {
        setConflict({ currentMtimeMs: numberOr(err.body && err.body.currentMtimeMs, 0) });
      } else {
        setError((err && err.message) || 'falha ao salvar');
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadFromDisk() {
    try {
      const fresh = await fetchJson('/api/note?path=' + encodeURIComponent(note.path));
      const freshText = noteText(fresh);
      setText(freshText);
      setBase({ mtimeMs: numberOr(fresh.mtimeMs, 0), text: freshText });
      setConflict(null);
      setError(null);
    } catch (err) {
      setError((err && err.message) || 'falha ao recarregar do disco');
    }
  }

  return { text, setText, base, conflict, saving, error, persist, reloadFromDisk };
}

function EditorBar({ note, text, dirty, saving, onSave, onCancel }) {
  return (
    <div className="editor-bar">
      <span className="editor-badge mono">editando</span>
      <span className="editor-path mono dim" title={note.path}>
        {note.path}
      </span>
      <span className="editor-count mono dim">
        {countWords(text)} palavras{dirty ? ' · alterado' : ''}
      </span>
      <span className="editor-hint mono dim">Ctrl+S salva · Esc cancela</span>
      <button type="button" className="editor-btn" onClick={onCancel} disabled={saving}>
        cancelar
      </button>
      <button
        type="button"
        className="editor-btn save"
        onClick={onSave}
        disabled={saving || !dirty}
      >
        {saving ? 'salvando...' : 'salvar'}
      </button>
    </div>
  );
}

function ConflictBanner({ saving, onReload, onOverwrite }) {
  return (
    <div className="editor-conflict" role="alert">
      <span className="editor-conflict-msg">
        conflito: a nota mudou no disco enquanto você editava
      </span>
      <button type="button" className="editor-btn" onClick={onReload} disabled={saving}>
        recarregar do disco
      </button>
      <button type="button" className="editor-btn danger" onClick={onOverwrite} disabled={saving}>
        sobrescrever
      </button>
    </div>
  );
}

// Aviso so quando o servidor parseia o frontmatter mas nao manda o texto cru:
// nesse caso salvar escreveria a nota sem o bloco --- ... ---.
function FrontmatterWarning({ note }) {
  const hasFm = note.frontmatter && Object.keys(note.frontmatter).length > 0;
  if (typeof note.raw === 'string' || !hasFm) return null;
  if (/^---\r?\n/.test(noteText(note))) return null;
  return (
    <div className="editor-warn mono" role="alert">
      atenção: o servidor não enviou o frontmatter desta nota; salvar pode removê-lo
    </div>
  );
}

// Prefere o texto cru do arquivo (note.raw, se o server F2 mandar); cai para
// note.markdown (que hoje vem sem frontmatter).
function noteText(data) {
  if (data && typeof data.raw === 'string') return data.raw;
  return data && typeof data.markdown === 'string' ? data.markdown : '';
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
