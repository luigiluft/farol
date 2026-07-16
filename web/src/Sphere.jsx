// FAROL - Sphere.jsx (refactor v2, F2a): wrapper React do cerebro-esfera.
// Busca /api/graph 1x + refetch no ping de vault (throttle 30s — rebuild
// re-dispara intro, entao so quando o vault realmente mudou); repassa as
// sessoes vivas pro engine (marcadores/arcos). Clique em nota abre no editor.
import { useEffect, useRef } from 'react';
import { fetchJson, onVaultPing } from './api.js';
import { createSphere } from './graph-sphere.js';

const REFETCH_THROTTLE_MS = 30000;

export default function Sphere({ sessions, onOpenNote, apiRef }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const openRef = useRef(onOpenNote);
  openRef.current = onOpenNote;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const eng = createSphere(canvas, {
      onOpenNote: (path) => { if (openRef.current) openRef.current(path); },
    });
    engineRef.current = eng;
    // ponte rail->esfera (nota 2): hover pulsa, clique foca o no do path
    if (apiRef) apiRef.current = { pulsePath: eng.pulsePath, focusPath: eng.focusPath };
    // expose pro verify por playwright (mesmo padrao __diveTest do universo)
    window.__sphereDebug = eng.debug;

    let alive = true;
    let lastFetch = 0;
    const load = () => {
      lastFetch = Date.now();
      fetchJson('/api/graph')
        .then((data) => { if (alive) eng.setData(data); })
        .catch(() => { /* grafo indisponivel: esfera fica vazia, rail segue */ });
    };
    load();
    const offPing = onVaultPing(() => {
      if (Date.now() - lastFetch > REFETCH_THROTTLE_MS) load();
    });

    const ro = new ResizeObserver(() => eng.resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      alive = false;
      offPing();
      ro.disconnect();
      delete window.__sphereDebug;
      if (apiRef) apiRef.current = null;
      eng.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setSessions(sessions || []);
  }, [sessions]);

  return <canvas ref={canvasRef} className="sphere-canvas" aria-label="Cérebro: vault como esfera 3D" />;
}
