// FAROL - Cockpit GALERIA: histórico global de mídia (o que a frota gerou
// via MCP + telas que viu), agrupado dia → sessão, cards ricos. Formato
// híbrido validado por mock (spec 2026-07-10-cockpit-assets-design.md).
import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from './api.js';
import {
  idColor, fmtAge, thumbSrcOf, provenanceOf, originLabel,
} from './cockpit-model.js';
import { callsign } from './callsigns.js';
import Lightbox from './Lightbox.jsx';
import './cockpit-galeria.css';

const DAYS = 30;
const MAX_FRAME_SESSIONS = 12; // /api/visor por sessão: cap de chamadas
const POLL_MS = 15000; // enquanto ready:false (backfill andando)

function dayKey(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
function hhmm(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Itens da galeria: gens + frames normalizados num shape só.
function buildItems(gens, framesBySession) {
  const items = [];
  for (const g of gens) {
    items.push({
      key: 'g:' + g.id, kind: 'gen', type: g.type, ts: g.ts, session: g.session,
      src: thumbSrcOf(g), full: g.url || thumbSrcOf(g),
      video: g.type === 'video' ? g.url : null,
      title: g.model || (g.type === 'video' ? 'vídeo' : 'imagem'),
      sub: g.prompt || '', gen: g,
    });
  }
  for (const [sid, frames] of framesBySession) {
    for (const f of frames) {
      const ts = Date.parse(f.ts || '') || 0;
      items.push({
        key: 'f:' + sid + ':' + f.idx, kind: 'frame', type: 'tela', ts, session: sid,
        src: `/api/visor/frame?session=${encodeURIComponent(sid)}&idx=${f.idx}`,
        full: `/api/visor/frame?session=${encodeURIComponent(sid)}&idx=${f.idx}`,
        video: null, title: f.verb || 'tela', sub: f.target || '', verb: f.verb || '',
      });
    }
  }
  return items.filter((it) => it.src).sort((a, b) => b.ts - a.ts);
}

export default function GaleriaPane() {
  const [gens, setGens] = useState([]);
  const [ready, setReady] = useState(false);
  const [framesBySession, setFrames] = useState(new Map());
  const [sessMeta, setSessMeta] = useState({}); // sid -> { topic, mission }
  const [filter, setFilter] = useState('tudo');
  const [lb, setLb] = useState(null);

  // gens globais; re-polla enquanto o backfill anda
  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = async () => {
      try {
        const d = await fetchJson(`/api/assets?days=${DAYS}`);
        if (!alive) return;
        setGens(Array.isArray(d.gens) ? d.gens : []);
        setSessMeta(d.sessions && typeof d.sessions === 'object' ? d.sessions : {});
        setReady(Boolean(d.ready));
        if (!d.ready) timer = setTimeout(load, POLL_MS);
      } catch { if (alive) setReady(true); }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  // frames: das sessões que aparecem nos gens + nas mais recentes (cap 12)
  useEffect(() => {
    let alive = true;
    const sids = [...new Set(gens.map((g) => g.session))].slice(0, MAX_FRAME_SESSIONS);
    Promise.allSettled(sids.map((sid) => fetchJson(`/api/visor?session=${encodeURIComponent(sid)}`)))
      .then((rs) => {
        if (!alive) return;
        const m = new Map();
        rs.forEach((r, i) => {
          if (r.status === 'fulfilled' && Array.isArray(r.value.frames)) m.set(sids[i], r.value.frames);
        });
        setFrames(m);
      });
    return () => { alive = false; };
  }, [gens]);

  const items = useMemo(() => buildItems(gens, framesBySession), [gens, framesBySession]);
  const provKey = (it) => provenanceOf(it).key;
  const vis = items.filter((it) => filter === 'tudo' || provKey(it) === filter);
  const counts = items.reduce((acc, it) => {
    acc.tudo += 1;
    acc[provKey(it)] = (acc[provKey(it)] || 0) + 1;
    return acc;
  }, { tudo: 0, gerada: 0, vista: 0, lida: 0, enviada: 0 });

  // agrupamento dia → sessão (ordem de chegada já é DESC)
  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of vis) {
      const dk = dayKey(it.ts);
      if (!m.has(dk)) m.set(dk, new Map());
      const bySess = m.get(dk);
      if (!bySess.has(it.session)) bySess.set(it.session, []);
      bySess.get(it.session).push(it);
    }
    return m;
  }, [vis]);

  const strip = vis.filter((i) => !i.video).slice(0, 60)
    .map((i) => ({ key: i.key, src: i.src, full: i.full, href: i.full, caption: i.title }));
  const openItem = (it) => setLb({
    src: it.full, video: it.video || undefined, href: it.full,
    caption: [it.title, it.sub && it.sub.slice(0, 120), callsign(it.session)].filter(Boolean).join(' · '),
  });

  return (
    <div className="ck-galeria">
      <div className="ckg-filters" role="group" aria-label="filtro da galeria por proveniência">
        {[['tudo', 'tudo'], ['gerada', '✦ geradas'], ['vista', '◻ telas que viu'], ['lida', '⇱ lidas de arquivo'], ['enviada', '⇧ você enviou']]
          .filter(([k]) => k === 'tudo' || counts[k] > 0)
          .map(([k, l]) => (
            <button key={k} type="button" className={'ckg-chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>
              {l}<span className="ckg-n">{counts[k]}</span>
            </button>
          ))}
        {!ready && <span className="ckg-sync mono">indexando histórico…</span>}
      </div>
      {vis.length === 0 && (
        <div className="ck-wall-empty mono">{ready ? 'nada gerado/visto nos últimos 30 dias' : 'indexando…'}</div>
      )}
      <div className="ckg-scroll">
        {[...byDay.entries()].map(([dk, bySess]) => (
          <section key={dk} className="ckg-day">
            <h2>{dk}<small>{[...bySess.values()].reduce((n, a) => n + a.length, 0)} itens</small></h2>
            {[...bySess.entries()].map(([sid, arr]) => (
              <div key={sid} className="ckg-sess" style={{ '--sc': idColor(sid) }}>
                <div className="ckg-shead">
                  <span className="ckg-dot" />
                  <span className="ckg-nm">{(sessMeta[sid] && sessMeta[sid].topic) || callsign(sid)}</span>
                  {sessMeta[sid] && sessMeta[sid].mission && (
                    <span className="ckg-mission" title={sessMeta[sid].mission}>{sessMeta[sid].mission}</span>
                  )}
                  <span className="ckg-ct">
                    {arr.filter((x) => x.kind === 'gen').length} gerados · {arr.filter((x) => x.kind === 'frame').length} telas
                  </span>
                </div>
                <div className="ckg-grid">
                  {arr.map((it) => {
                    const prov = provenanceOf(it);
                    return (
                      <button key={it.key} type="button" className="ckg-card" onClick={() => openItem(it)}>
                        <span className="ckg-th">
                          {it.video
                            ? <video src={it.video} preload="metadata" muted playsInline />
                            : <img src={it.src} loading="lazy" alt="" onError={(e) => { e.currentTarget.style.opacity = 0.15; }} />}
                          <span className={'ckg-badge prov-' + prov.cls}>{prov.label}</span>
                          {it.video && <span className="ckg-play" aria-hidden="true">▶</span>}
                        </span>
                        <span className="ckg-ft">
                          <span className="ckg-l1" title={originLabel(it)}>{originLabel(it)}</span>
                          <span className="ckg-l2">{hhmm(it.ts)} · há {fmtAge((Date.now() - it.ts) / 1000)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
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
