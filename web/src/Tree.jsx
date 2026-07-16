// FAROL - arvore do vault (agente M; CRUD Path 1 / Fase C).
// GET /api/tree. Glifos unicode sobrios por pasta PARA, expand/collapse imutavel
// (Set), item ativo destacado, 4-Archive dim+colapsado.
// Path 1: toolbar (nova nota / nova pasta na raiz) + menu de contexto por linha
// (nota: renomear/mover/excluir; pasta: nova nota/pasta aqui) via vaultCrud, com
// reload do /api/tree apos cada mutacao. Clique em .base abre o leitor (onOpenBase).
import { useEffect, useRef, useState } from 'react';
import { useApi } from './api.js';
import { createNote, createFolder, renameNote, deleteNote, renameFolder, deleteFolder, parentDir } from './vaultCrud.js';
import './crud.css';

const FOLDER_GLYPHS = {
  '0-Inbox': '▤', '1-Projects': '◆', '2-Areas': '◐', '3-Resources': '▣',
  '4-Archive': '▦', '5-Atlas': '◈', '6-Daily': '◔', '7-Templates': '▱', '8-System': '◎',
};
const FOLDER_TONES = {
  '0-Inbox': 'tone-inbox', '1-Projects': 'tone-projects', '2-Areas': 'tone-areas',
  '3-Resources': 'tone-resources', '4-Archive': 'tone-archive', '5-Atlas': 'tone-atlas',
  '6-Daily': 'tone-daily', '7-Templates': 'tone-templates', '8-System': 'tone-system',
};
const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf']);

export default function Tree({ activePath, onSelect, onOpenBase, onOpenCanvas }) {
  const { data, error, loading, reload } = useApi('/api/tree');
  const [expanded, setExpanded] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [opError, setOpError] = useState(null);

  useEffect(() => {
    if (!activePath) return;
    setExpanded((prev) => withAncestors(prev, activePath));
  }, [activePath]);

  function toggle(path) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function openMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }

  // Executa a mutacao do dialog; mantem aberto no erro (mostra a msg).
  async function submitDialog(value) {
    const d = dialog;
    const name = String(value || '').trim();
    if (!name) return;
    setDialog((prev) => ({ ...prev, busy: true, err: null }));
    try {
      if (d.mode === 'newNote') {
        const r = await createNote(d.dir, name);
        await reload();
        onSelect(r.path);
      } else if (d.mode === 'newFolder') {
        const r = await createFolder(d.dir, name);
        await reload();
        setExpanded((prev) => withAncestors(new Set(prev).add(r.path), r.path + '/x'));
      } else if (d.mode === 'rename') {
        const r = await renameNote(d.from, name);
        await reload();
        if (d.from === activePath) onSelect(r.path);
      } else if (d.mode === 'renameFolder') {
        const r = await renameFolder(d.from, name);
        await reload();
        // remapeia a nota aberta se estava dentro da pasta renomeada
        if (activePath && (activePath === d.from || activePath.startsWith(d.from + '/'))) {
          onSelect(r.path + activePath.slice(d.from.length));
        }
      }
      setDialog(null);
    } catch (err) {
      setDialog((prev) => ({ ...prev, busy: false, err: err.message || 'falha' }));
    }
  }

  async function doDelete(node) {
    setMenu(null);
    if (!window.confirm(`Excluir "${node.name}"? Vai para a .trash da Torre (recuperável).`)) return;
    try {
      await deleteNote(node.path);
      await reload();
      if (node.path === activePath) onSelect('');
    } catch (err) {
      setOpError(err.message || 'falha ao excluir');
    }
  }

  async function doDeleteFolder(node) {
    setMenu(null);
    if (!window.confirm(`Excluir a pasta "${node.name}" e TODO o conteúdo? Vai para a .trash da Torre (recuperável).`)) return;
    try {
      await deleteFolder(node.path);
      await reload();
      if (activePath && (activePath === node.path || activePath.startsWith(node.path + '/'))) onSelect('');
    } catch (err) {
      setOpError(err.message || 'falha ao excluir pasta');
    }
  }

  function act(action) {
    const node = menu.node;
    setMenu(null);
    setOpError(null);
    if (action === 'newNote') setDialog({ mode: 'newNote', dir: node.path, title: 'Nova nota', sub: (node.path || 'raiz') + '/', value: '' });
    else if (action === 'newFolder') setDialog({ mode: 'newFolder', dir: node.path, title: 'Nova pasta', sub: (node.path || 'raiz') + '/', value: '' });
    else if (action === 'rename') setDialog({ mode: 'rename', from: node.path, title: 'Renomear / mover', sub: 'caminho relativo (mude a pasta para mover)', value: node.path });
    else if (action === 'renameFolder') setDialog({ mode: 'renameFolder', from: node.path, title: 'Renomear / mover pasta', sub: 'caminho relativo (mude o pai para mover)', value: node.path });
    else if (action === 'deleteFolder') doDeleteFolder(node);
    else if (action === 'delete') doDelete(node);
  }

  if (loading && !data) return <TreeSkeleton />;
  if (error) return <div className="tree-msg crit mono">árvore indisponível: {error.message}</div>;

  return (
    <>
      <div className="tree-toolbar">
        <button type="button" className="tree-tool-btn" onClick={() => { setOpError(null); setDialog({ mode: 'newNote', dir: '', title: 'Nova nota', sub: 'raiz do vault — inclua a pasta no nome se quiser', value: '' }); }}>＋ Nota</button>
        <button type="button" className="tree-tool-btn" onClick={() => { setOpError(null); setDialog({ mode: 'newFolder', dir: '', title: 'Nova pasta', sub: 'raiz do vault', value: '' }); }}>＋ Pasta</button>
      </div>
      {opError && <div className="tree-op-error mono">{opError}</div>}
      {(!data || !Array.isArray(data.children) || data.children.length === 0) ? (
        <div className="tree-msg dim mono">vault vazio</div>
      ) : (
        <nav className="tree" aria-label="Árvore do vault">
          {sortNodes(data.children).map((node) => (
            <TreeNode key={node.path} node={node} depth={0} expanded={expanded}
              onToggle={toggle} activePath={activePath} onSelect={onSelect}
              onOpenBase={onOpenBase} onOpenCanvas={onOpenCanvas} onMenu={openMenu} />
          ))}
        </nav>
      )}
      {menu && <ContextMenu menu={menu} onAct={act} onClose={() => setMenu(null)} />}
      {dialog && <PromptDialog dialog={dialog} onSubmit={submitDialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function withAncestors(prevSet, path) {
  const next = new Set(prevSet);
  const parts = path.split('/');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = acc ? acc + '/' + parts[i] : parts[i];
    next.add(acc);
  }
  return next;
}

function TreeSkeleton() {
  return (
    <div className="tree-skel" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" />)}
    </div>
  );
}

function TreeNode(props) {
  if (props.node.type === 'dir') return <DirNode {...props} />;
  return <FileNode {...props} />;
}

function DirNode({ node, depth, expanded, onToggle, activePath, onSelect, onOpenBase, onOpenCanvas, onMenu }) {
  const lp = useLongPress((pt) => onMenu(synthEvt(pt), node));
  const isOpen = expanded.has(node.path);
  const isArchived = node.archived === true || node.name === '4-Archive';
  const glyph = FOLDER_GLYPHS[node.name] || '▫';
  const tone = FOLDER_TONES[node.name] || '';
  const children = Array.isArray(node.children) ? node.children : [];
  return (
    <div className={'tree-dir' + (isArchived ? ' archived' : '')}>
      <button type="button" className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}
        aria-expanded={isOpen} onClick={() => onToggle(node.path)} onContextMenu={(e) => onMenu(e, node)} {...lp}>
        <span className={'tree-chevron' + (isOpen ? ' open' : '')} aria-hidden="true">▸</span>
        <span className={'tree-glyph ' + tone} aria-hidden="true">{glyph}</span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-count dim mono">{children.length || ''}</span>
      </button>
      {isOpen && children.length > 0 && (
        <div className="tree-children">
          {sortNodes(children).map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} expanded={expanded}
              onToggle={onToggle} activePath={activePath} onSelect={onSelect}
              onOpenBase={onOpenBase} onOpenCanvas={onOpenCanvas} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileNode({ node, depth, activePath, onSelect, onOpenBase, onOpenCanvas, onMenu }) {
  const isMd = /\.md$/i.test(node.name);
  const isBase = /\.base$/i.test(node.name);
  const isCanvas = /\.canvas$/i.test(node.name);
  const lp = useLongPress((pt) => { if (isMd) onMenu(synthEvt(pt), node); });
  const isActive = node.path === activePath;
  const label = isMd ? node.name.replace(/\.md$/i, '')
    : isBase ? node.name.replace(/\.base$/i, '')
      : isCanvas ? node.name.replace(/\.canvas$/i, '') : node.name;

  function handleClick() {
    if (isMd) return onSelect(node.path);
    if (isBase) return onOpenBase && onOpenBase(node.path);
    if (isCanvas) return onOpenCanvas && onOpenCanvas(node.path);
    const ext = (node.name.split('.').pop() || '').toLowerCase();
    if (ASSET_EXTS.has(ext)) window.open('/api/asset?path=' + encodeURIComponent(node.path), '_blank', 'noopener');
  }

  return (
    <button type="button"
      className={'tree-row tree-file' + (isActive ? ' active' : '') + (isMd || isBase || isCanvas ? '' : ' asset')}
      style={{ paddingLeft: 8 + depth * 14 + 14 }} title={node.path}
      onClick={handleClick} onContextMenu={isMd ? (e) => onMenu(e, node) : undefined} {...(isMd ? lp : {})}>
      <span className={'tree-dot' + (isBase || isCanvas ? ' base' : '')} aria-hidden="true" />
      <span className="tree-name">{label}{isBase && <span className="dim mono"> .base</span>}{isCanvas && <span className="dim mono"> .canvas</span>}</span>
    </button>
  );
}

// Long-press (toque): abre o menu de contexto onde o right-click nao existe.
function useLongPress(onLong) {
  const timer = useRef(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  return {
    onTouchStart: (e) => {
      fired.current = false;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const pt = { clientX: t.clientX, clientY: t.clientY };
      timer.current = setTimeout(() => { fired.current = true; onLong(pt); }, 500);
    },
    onTouchMove: clear,
    onTouchEnd: (e) => { clear(); if (fired.current) e.preventDefault(); },
  };
}

function synthEvt(pt) {
  return { preventDefault() {}, stopPropagation() {}, clientX: pt.clientX, clientY: pt.clientY };
}

// Menu de contexto: fecha em clique-fora / Esc / scroll. Itens dependem do tipo.
function ContextMenu({ menu, onAct, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const isDir = menu.node.type === 'dir';
  const style = { left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 160) };
  return (
    <div className="tree-ctx panel" style={style} onMouseDown={(e) => e.stopPropagation()} role="menu">
      <div className="ctx-path mono">{menu.node.path || 'raiz'}</div>
      <div className="ctx-sep" />
      {isDir ? (
        <>
          <button type="button" onClick={() => onAct('newNote')}>Nova nota aqui</button>
          <button type="button" onClick={() => onAct('newFolder')}>Nova pasta aqui</button>
          {menu.node.path.includes('/') && (
            <>
              <div className="ctx-sep" />
              <button type="button" onClick={() => onAct('renameFolder')}>Renomear / mover pasta</button>
              <button type="button" className="danger" onClick={() => onAct('deleteFolder')}>Excluir pasta</button>
            </>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={() => onAct('rename')}>Renomear / mover</button>
          <button type="button" className="danger" onClick={() => onAct('delete')}>Excluir</button>
        </>
      )}
    </div>
  );
}

// Dialog modal de input (nome/caminho). Enter envia, Esc fecha. Erro inline.
function PromptDialog({ dialog, onSubmit, onClose }) {
  const [value, setValue] = useState(dialog.value || '');
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!dialog.busy) onSubmit(value); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  return (
    <div className="tdialog-overlay" onMouseDown={onClose}>
      <div className="tdialog panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{dialog.title}</h3>
        <p className="tdialog-sub mono">{dialog.sub}</p>
        <input autoFocus type="text" value={value} spellCheck={false} disabled={dialog.busy}
          onChange={(e) => setValue(e.target.value)} onKeyDown={onKey}
          placeholder={dialog.mode === 'rename' ? '1-Projects/.../nota.md' : 'nome'} />
        {dialog.err && <p className="tdialog-err mono">{dialog.err}</p>}
        <div className="tdialog-actions">
          <button type="button" onClick={onClose} disabled={dialog.busy}>cancelar</button>
          <button type="button" className="primary" disabled={dialog.busy || !value.trim()} onClick={() => onSubmit(value)}>
            {dialog.busy ? '...' : 'confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function sortNodes(nodes) {
  return nodes
    .filter((n) => n && typeof n.name === 'string' && !n.name.startsWith('.'))
    .slice()
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
    });
}
