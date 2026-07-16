// FAROL - viewer read-only de JSON Canvas (.canvas) (Path 1 / deferido).
// GET /api/canvas. Plano pan (arraste) + zoom (scroll); nós text/file/group/link,
// edges como linhas. Clique em nó de arquivo .md abre a nota. Theme-safe.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from './api.js';
import './canvas.css';

const CANVAS_PALETTE = { 1: '#e05252', 2: '#e0913a', 3: '#d9c23a', 4: '#5bb450', 5: '#4aa3c7', 6: '#a45bd0' };
function nodeColor(c) {
  if (!c) return null;
  if (typeof c === 'string' && c.startsWith('#')) return c;
  return CANVAS_PALETTE[c] || null;
}

export default function CanvasView({ path, onOpenNote }) {
  if (!path) return <div className="cv-empty dim">selecione um .canvas na árvore</div>;
  return <CanvasLoader key={path} path={path} onOpenNote={onOpenNote} />;
}

function CanvasLoader({ path, onOpenNote }) {
  const { data, error, loading } = useApi('/api/canvas?path=' + encodeURIComponent(path));
  const wrapRef = useRef(null);
  const drag = useRef(null);
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const bounds = useMemo(() => computeBounds(data && data.nodes), [data]);

  useEffect(() => {
    if (!bounds || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const pad = 80;
    const k = Math.max(0.1, Math.min(1.2, Math.min((r.width - pad) / bounds.w, (r.height - pad) / bounds.h) || 1));
    setView({ k, tx: r.width / 2 - (bounds.x + bounds.w / 2) * k, ty: r.height / 2 - (bounds.y + bounds.h / 2) * k });
  }, [bounds]);

  if (loading && !data) return <div className="cv-state dim">carregando canvas...</div>;
  if (error) return <div className="cv-state crit mono">não consegui abrir o canvas: {error.message}</div>;
  const nodes = (data && data.nodes) || [];
  const edges = (data && data.edges) || [];
  if (!nodes.length) return <div className="cv-state dim">canvas vazio</div>;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function onWheel(e) {
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => {
      const k = Math.max(0.1, Math.min(4, v.k * f));
      return { k, tx: mx - (mx - v.tx) * (k / v.k), ty: my - (my - v.ty) * (k / v.k) };
    });
  }
  function down(e) { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; }
  function move(e) {
    if (!drag.current) return;
    setView((v) => ({ ...v, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }));
  }
  function up() { drag.current = null; }

  // ordem: grupos atras, demais na frente
  const ordered = [...nodes].sort((a, b) => (a.type === 'group' ? -1 : 0) - (b.type === 'group' ? -1 : 0));

  return (
    <div className="cv-wrap" ref={wrapRef} onWheel={onWheel}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
      <div className="cv-plane" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}>
        <svg className="cv-edges" style={{ left: bounds.x, top: bounds.y }} width={bounds.w} height={bounds.h}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}>
          {edges.map((ed, i) => {
            const a = byId.get(ed.fromNode);
            const b = byId.get(ed.toNode);
            if (!a || !b) return null;
            return <line key={ed.id || i} className="cv-edge"
              x1={a.x + a.width / 2} y1={a.y + a.height / 2} x2={b.x + b.width / 2} y2={b.y + b.height / 2} />;
          })}
        </svg>
        {ordered.map((n) => <CanvasNode key={n.id} n={n} onOpenNote={onOpenNote} />)}
      </div>
      <div className="cv-hint dim mono">arraste pra mover · scroll pra zoom</div>
    </div>
  );
}

function CanvasNode({ n, onOpenNote }) {
  const col = nodeColor(n.color);
  const style = { left: n.x, top: n.y, width: n.width, height: n.height };
  if (col) style.borderColor = col;
  if (n.type === 'group') {
    return <div className="cv-node cv-group" style={style}>{n.label ? <span className="cv-group-label">{n.label}</span> : null}</div>;
  }
  if (n.type === 'file') {
    const isMd = /\.md$/i.test(n.file || '');
    const name = String(n.file || '').split('/').pop().replace(/\.md$/i, '');
    return (
      <button type="button" className="cv-node cv-file" style={style} title={n.file}
        onClick={() => isMd && onOpenNote && onOpenNote(n.file)}>
        <span className="cv-file-name">{name}</span>
        <span className="cv-file-path dim mono">{n.file}</span>
      </button>
    );
  }
  if (n.type === 'link') {
    return <a className="cv-node cv-link" style={style} href={n.url} target="_blank" rel="noopener noreferrer">{n.url}</a>;
  }
  return <div className="cv-node cv-text" style={style}>{n.text || ''}</div>;
}

function computeBounds(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (n.width || 0));
    maxY = Math.max(maxY, n.y + (n.height || 0));
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
