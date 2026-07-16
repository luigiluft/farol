// FAROL - Cockpit: pane TRILHA v2 = ledger da sessao (viu/acessou/criou/
// rodou) com mídia inline COMPACTA em destaque (thumb 96px + ⤢; clique
// expande no Lightbox). Fontes: /api/ledger + /api/visor + /api/assets.
// Design validado por mock (spec 2026-07-10-cockpit-assets-design.md).
import { useEffect, useState, useCallback } from 'react';
import { fetchJson } from './api.js';
import { mergeLedger } from './cockpit-model.js';
import Lightbox from './Lightbox.jsx';
import './cockpit-trilha.css';

const AUTO_MS = 20000;
const CATS = [
  ['tudo', 'tudo'], ['criou', 'criou'], ['viu', 'viu'],
  ['acessou', 'acessou'], ['rodou', 'rodou'], ['midia', '★ mídia'],
];
const CAT_LABEL = { criou: 'criou', viu: 'viu', acessou: 'acessou', rodou: 'rodou' };

function hhmm(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function TrilhaPane({ session }) {
  const id = session?.id;
  const [events, setEvents] = useState([]);
  const [frames, setFrames] = useState([]);
  const [gens, setGens] = useState([]);
  const [err, setErr] = useState(null);
  const [cat, setCat] = useState('tudo');
  const [lb, setLb] = useState(null);

  const load = useCallback((isAlive) => {
    if (!id) return;
    const q = encodeURIComponent(id);
    Promise.allSettled([
      fetchJson(`/api/ledger?id=${q}`),
      fetchJson(`/api/visor?session=${q}`),
      fetchJson(`/api/assets?session=${q}`),
    ]).then(([le, vi, as]) => {
      if (!isAlive()) return;
      if (le.status === 'fulfilled') setEvents(le.value.events || []);
      if (vi.status === 'fulfilled') {
        setFrames((vi.value.frames || []).map((f) => ({
          ...f, src: `/api/visor/frame?session=${q}&idx=${f.idx}`,
        })));
      }
      if (as.status === 'fulfilled') setGens(as.value.gens || []);
      setErr(le.status === 'rejected' ? String(le.reason?.message || le.reason) : null);
    });
  }, [id]);

  useEffect(() => {
    let alive = true;
    setEvents([]); setFrames([]); setGens([]); setErr(null); setCat('tudo');
    load(() => alive);
    return () => { alive = false; };
  }, [load]);
  useEffect(() => {
    let alive = true;
    const t = setInterval(() => { if (!document.hidden) load(() => alive); }, AUTO_MS);
    return () => { alive = false; clearInterval(t); };
  }, [load]);

  const rows = mergeLedger(events, frames, gens);
  const vis = rows.filter((r) => cat === 'tudo' || (cat === 'midia' ? Boolean(r.media) : r.cat === cat));
  const totals = {};
  for (const r of rows) totals[r.cat] = (totals[r.cat] || 0) + 1;
  const mediaRows = vis.filter((r) => r.media);
  const strip = mediaRows.filter((r) => !r.media.video)
    .map((r) => ({ key: r.media.src, src: r.media.src, full: r.media.full, href: r.media.full, caption: r.media.cap }));

  const openMedia = (r) => setLb({
    src: r.media.full, video: r.media.video || undefined, href: r.media.full,
    caption: [r.verb, r.target, r.media.cap].filter(Boolean).join(' · '),
  });

  if (!id) return <div className="ck-trilha panel"><div className="ck-trilha-empty">sem sessão em foco</div></div>;
  return (
    <div className="ck-trilha panel">
      <div className="ck-trilha-head">
        <span className="ck-trilha-title">TRILHA</span>
        <span className="ckt-totals">
          {Object.entries(CAT_LABEL).map(([k, l]) => (
            <span key={k} className={'ckt-tot ' + k}><b>{totals[k] || 0}</b> {l}</span>
          ))}
        </span>
      </div>
      <div className="ckt-filters" role="group" aria-label="filtro do ledger">
        {CATS.map(([k, l]) => (
          <button
            key={k} type="button"
            className={'ckt-chip' + (cat === k ? ' on' : '')}
            onClick={() => setCat(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {err && <div className="ck-trilha-empty">erro: {err}</div>}
      {!err && vis.length === 0 && <div className="ck-trilha-empty">nada registrado ainda</div>}
      <div className="ckt-ledger">
        {vis.map((r, i) => (
          <div key={r.ts + ':' + i} className={'ckt-row' + (r.media ? ' media' : '')} data-cat={r.cat}>
            <span className="ckt-t">{hhmm(r.ts)}</span>
            <span className={'ckt-badge ' + r.cat}>{CAT_LABEL[r.cat] || r.cat}</span>
            <span className="ckt-what">
              <span className="ckt-verb">{r.verb}</span>{' '}
              <span className="ckt-tgt">{r.target}</span>
              {r.media && (
                <button type="button" className="ckt-mth" onClick={() => openMedia(r)} title="expandir">
                  {r.media.video
                    ? <video src={r.media.video} preload="metadata" muted />
                    : <img src={r.media.src} loading="lazy" alt="" />}
                  <span className="ckt-mcap">{r.media.cap}</span>
                  <span className="ckt-mex" aria-hidden="true">⤢</span>
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <Lightbox
        open={Boolean(lb)} item={lb} filmstrip={strip} onClose={() => setLb(null)}
        onNav={(nav) => {
          const open = (s) => setLb({ src: s.full || s.src, href: s.href || s.full || s.src, caption: s.caption });
          if (typeof nav === 'object') return open(nav);
          if (!strip.length) return;
          const i = strip.findIndex((s) => (s.full || s.src) === lb?.src);
          const next = strip[(i + nav + strip.length) % strip.length];
          if (next) open(next);
        }}
      />
    </div>
  );
}
