// FAROL - leitor de .base (Path 1 / Fase C). Renderiza as views de um
// arquivo .base (GET /api/base): abas por view, tabela ou cards, agrupamento
// (groupBy) e clique numa linha abre a nota. Estados de loading/erro/vazio
// desenhados; warnings do servidor exibidos discretos.
import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import './bases.css';

export default function BaseView({ path, onOpenNote }) {
  if (!path) return <div className="base-empty dim">selecione um .base na árvore</div>;
  return <BaseLoader key={path} path={path} onOpenNote={onOpenNote} />;
}

function BaseLoader({ path, onOpenNote }) {
  const { data, error, loading } = useApi('/api/base?path=' + encodeURIComponent(path));
  const [active, setActive] = useState(0);

  if (loading && !data) return <div className="base-skel" aria-hidden="true"><div className="skel" /><div className="skel" /><div className="skel" /></div>;
  if (error) return <div className="base-state crit mono">não consegui abrir a base: {error.message}</div>;
  const views = (data && Array.isArray(data.views)) ? data.views : [];
  if (!views.length) return <div className="base-state dim">esta base não tem views renderizáveis</div>;
  const idx = Math.min(active, views.length - 1);
  const view = views[idx];

  return (
    <div className="base-view">
      <header className="base-head">
        <h1 className="base-title">{data.name}</h1>
        <nav className="base-tabs" aria-label="Views da base">
          {views.map((v, i) => (
            <button
              key={(v.name || 'view') + i}
              type="button"
              className={'btn-tab' + (i === idx ? ' active' : '')}
              onClick={() => setActive(i)}
            >
              {v.name || `View ${i + 1}`}
              <span className="base-tab-count dim mono"> {v.rows ? v.rows.length : 0}</span>
            </button>
          ))}
        </nav>
      </header>
      {view.type === 'cards'
        ? <BaseCards view={view} onOpenNote={onOpenNote} />
        : <BaseTable view={view} onOpenNote={onOpenNote} />}
      {Array.isArray(data.warnings) && data.warnings.length > 0 && (
        <details className="base-warn">
          <summary className="dim mono">{data.warnings.length} aviso(s) de avaliação</summary>
          <ul>{data.warnings.map((w, i) => <li key={i} className="dim mono">{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// Agrupa as linhas por groupBy (se houver), preservando a ordem ja resolvida.
function useGroups(view) {
  return useMemo(() => {
    const rows = Array.isArray(view.rows) ? view.rows : [];
    if (!view.groupBy) return [{ key: null, rows }];
    const map = new Map();
    for (const r of rows) {
      const k = (r.cells && r.cells[view.groupBy]) || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map.entries()].map(([key, rs]) => ({ key, rows: rs }));
  }, [view]);
}

function visibleCols(view) {
  // groupBy ja vira cabecalho de secao; nao repete como coluna.
  return (view.columns || []).filter((c) => c.id !== view.groupBy);
}

function BaseTable({ view, onOpenNote }) {
  const groups = useGroups(view);
  const cols = visibleCols(view);
  if (!view.rows || view.rows.length === 0) return <div className="base-state dim">nenhuma nota nesta view</div>;
  return (
    <div className="base-scroll">
      {groups.map((g, gi) => (
        <section key={g.key ?? gi} className="base-group">
          {g.key !== null && <h2 className="base-group-head mono">{String(g.key)} <span className="dim">({g.rows.length})</span></h2>}
          <table className="base-table">
            <thead>
              <tr>{cols.map((c) => <th key={c.id} title={c.id}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {g.rows.map((row) => (
                <tr key={row.path} className="base-row" onClick={() => onOpenNote && onOpenNote(row.path)} title={row.path}>
                  {cols.map((c) => (
                    <td key={c.id} className={c.id === 'file.name' ? 'base-cell-name' : ''}>
                      {c.id === 'file.name' ? (row.title || row.cells[c.id]) : cellText(row.cells[c.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function BaseCards({ view, onOpenNote }) {
  const groups = useGroups(view);
  const cols = visibleCols(view).filter((c) => c.id !== 'file.name');
  if (!view.rows || view.rows.length === 0) return <div className="base-state dim">nenhuma nota nesta view</div>;
  return (
    <div className="base-scroll">
      {groups.map((g, gi) => (
        <section key={g.key ?? gi} className="base-group">
          {g.key !== null && <h2 className="base-group-head mono">{String(g.key)} <span className="dim">({g.rows.length})</span></h2>}
          <div className="base-cards">
            {g.rows.map((row) => (
              <button key={row.path} type="button" className="base-card" onClick={() => onOpenNote && onOpenNote(row.path)} title={row.path}>
                <span className="base-card-title">{row.title || row.cells['file.name']}</span>
                {cols.map((c) => {
                  const v = cellText(row.cells[c.id]);
                  if (!v) return null;
                  return <span key={c.id} className="base-card-field"><span className="dim">{c.label}:</span> {v}</span>;
                })}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function cellText(v) {
  return v == null ? '' : String(v);
}
