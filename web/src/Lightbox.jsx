// FAROL - Lightbox compartilhado: zoom (wheel) + pan (drag) + filmstrip +
// navegacao por teclado (Esc fecha, setas navegam). Consumido pela TRILHA
// (imagens citadas/produzidas) e pelo OLHO (frame do visor em ⛶).
import { useEffect, useCallback, useState, useRef } from 'react';
import './lightbox.css';

export default function Lightbox({ open, item, filmstrip = [], onClose, onNav }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const [imgDead, setImgDead] = useState(false);
  // pan largado fora do body resolve o click no backdrop — sem o guard, fechava no meio do arrasto
  const dragMoved = useRef(false);

  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  useEffect(() => { reset(); setImgDead(false); }, [item?.src, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft') onNav?.(-1);
      if (e.key === 'ArrowRight') onNav?.(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onNav]);

  if (!open || !item) return null;
  return (
    <div
      className="lb-backdrop"
      onClick={(e) => {
        const wasDrag = dragMoved.current;
        dragMoved.current = false;
        if (!wasDrag && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="lb-body" onClick={(e) => e.stopPropagation()}>
        <div className="lb-head">
          <span className="lb-caption">{item.caption}</span>
          <span className="lb-zoom">{Math.round(zoom * 100)}%</span>
          {item.href && (
            <a className="lb-btn" href={item.href} target="_blank" rel="noreferrer" title="abrir original">↗</a>
          )}
          <button className="lb-btn" onClick={reset} title="ajustar" aria-label="ajustar zoom">⤢</button>
          <button className="lb-btn" onClick={onClose} title="fechar (Esc)" aria-label="fechar">✕</button>
        </div>
        <div
          className="lb-stage"
          onWheel={(e) => setZoom((z) => Math.min(8, Math.max(0.25, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))))}
          onMouseDown={(e) => { dragMoved.current = false; setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y }); }}
          onMouseMove={(e) => { if (drag) { dragMoved.current = true; setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y }); } }}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
        >
          {item.video ? (
            <video
              src={item.video} controls autoPlay muted loop playsInline
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
          ) : imgDead ? (
            <div className="lb-dead">imagem indisponível (removida, movida ou grande demais)</div>
          ) : (
            <img
              src={item.src} alt={item.caption || 'artefato'} draggable={false}
              onError={() => setImgDead(true)}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            />
          )}
        </div>
        {filmstrip.length > 1 && (
          <div className="lb-strip">
            {filmstrip.map((f) => (
              <img
                key={f.key} src={f.src} alt="" title={f.caption} draggable={false}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className={f.src === item.src ? 'on' : ''}
                onClick={() => onNav?.(f)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
