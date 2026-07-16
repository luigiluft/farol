// FAROL - Cockpit v2: OLHO DA IA multi-modal ("o olho nunca fica preto").
// Maquina do palco: frame PINADO (inspecionar tela) > live CDP > frame fresco
// (<15min) > ARTEFATO do que a sessao processa (pergunta/arquivo/arvore/
// output/busca via /api/peek) > card AGORA. Screenshot velho nunca e
// protagonista: vira ghost-thumb datada. Selo de frescor sempre no header:
// AO VIVO / VIU HA X (verde<2min, ambar<15min, cinza) / NUNCA VIU TELA.
import { useEffect, useState } from 'react';
import { fetchJson } from './api.js';
import { actionPhrase } from './callsigns.js';
import {
  seloOf, artifactPlanOf, domainOf, fmtAge, fmtClock, fmtTok, fmtDur,
  isBrowserAction, webSupersedesFrame,
  bornOf, genJobOf, actionsPerMin, thumbSrcOf,
} from './cockpit-model.js';
import Lightbox from './Lightbox.jsx';

const LIVE_STATUS_MS = 4000;
const LIVE_FRAME_MS = 1000;
const PEEK_POLL_MS = 5000;
const GENS_POLL_MS = 20000;

// Frase amigavel da acao corrente da sessao (fallback: estado cru).
export function doingOf(session) {
  const phrase = actionPhrase(session);
  if (phrase) return phrase;
  if (session && session.state) return session.state;
  return 'sem atividade registrada';
}

// ---------------------------------------------------------------- hooks ----

export function useLiveStatus() {
  const [status, setStatus] = useState({ available: false, targets: [] });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await fetchJson('/api/live/status');
        if (alive && s && typeof s === 'object') {
          setStatus({ available: !!s.available, targets: Array.isArray(s.targets) ? s.targets : [] });
        }
      } catch {
        if (alive) setStatus({ available: false, targets: [] });
      }
    };
    load();
    const timer = setInterval(load, LIVE_STATUS_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return status;
}

// Indice dos frames historicos da sessao (metadados; binario vem lazy por img).
export function useVisorFrames(id) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    setFrames([]);
    if (!id) return undefined;
    let alive = true;
    fetchJson('/api/visor?session=' + encodeURIComponent(id))
      .then((d) => { if (alive && d && Array.isArray(d.frames)) setFrames(d.frames); })
      .catch(() => { if (alive) setFrames([]); });
    return () => { alive = false; };
  }, [id]);
  return frames;
}

// Peek do artefato (arquivo/arvore reais). So quando o plano pede; 403/404 =>
// null e o palco cai no card AGORA.
export function usePeek(plan, pollMs) {
  const [data, setData] = useState(null);
  const key = plan ? plan.mode + ':' + (plan.path || '') : '';
  useEffect(() => {
    setData(null);
    if (!plan || (plan.mode !== 'file' && plan.mode !== 'dir')) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const url = plan.mode === 'file'
          ? '/api/peek/file?path=' + encodeURIComponent(plan.path) + (plan.line ? '&line=' + plan.line : '')
          : '/api/peek/dir?path=' + encodeURIComponent(plan.path);
        const d = await fetchJson(url);
        if (alive) setData(d && !d.error ? d : null);
      } catch {
        if (alive) setData(null);
      }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, pollMs || PEEK_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs]);
  return data;
}

// Gerações MCP da sessão (para as camadas NASCEU AGORA / JOB RODANDO).
export function useSessionGens(id) {
  const [gens, setGens] = useState([]);
  useEffect(() => {
    setGens([]);
    if (!id) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const d = await fetchJson('/api/assets?session=' + encodeURIComponent(id));
        if (alive && d && Array.isArray(d.gens)) setGens(d.gens);
      } catch { /* rota indisponível: camadas born/job só não acendem */ }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, GENS_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);
  return gens;
}

// ------------------------------------------------------------ artefatos ----

export function FileArt({ data, doing, mini }) {
  if (!data) return null;
  return (
    <div className={'ck-art' + (mini ? ' mini' : '')}>
      <div className="ck-art-h">{'⌨ '}{doing || 'codando'}{' — '}<b>{data.name}</b></div>
      <div className="ck-art-code">
        {data.lines.map((l) => (
          <div key={l.n} className={'ck-cd-ln' + (data.line === l.n ? ' hot' : '')}>
            <span className="ck-cd-n">{l.n}</span>
            <span className="ck-cd-t">{l.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DirArt({ data, mini }) {
  if (!data) return null;
  return (
    <div className={'ck-art' + (mini ? ' mini' : '')}>
      <div className="ck-art-h">{'🗂 navegando — '}<b>{data.name}</b></div>
      <div className="ck-art-tree">
        {data.items.map((it) => (
          <div key={it.name} className="ck-tr-ln">{it.dir ? '▸ ' : '· '}{it.name}</div>
        ))}
      </div>
    </div>
  );
}

export function OutputArt({ session, plan, mini }) {
  const acts = Array.isArray(session.recentActions) ? session.recentActions.slice(-6) : [];
  return (
    <div className={'ck-art' + (mini ? ' mini' : '')}>
      <div className="ck-art-h">{'▸ rodando — '}<b>{plan.cmd || 'comando'}</b></div>
      <div className="ck-art-out">
        {acts.map((a, i) => (
          <div key={i}>{actionPhrase({ ...a, currentAction: a }) || a.tool}</div>
        ))}
      </div>
    </div>
  );
}

export function SearchArt({ session, plan, mini }) {
  const acts = Array.isArray(session.recentActions) ? session.recentActions.slice(-6) : [];
  return (
    <div className={'ck-art' + (mini ? ' mini' : '')}>
      <div className="ck-art-h">{'🔍 procurando — '}<b>{plan.pattern || ''}</b></div>
      <div className="ck-art-out">
        {acts.map((a, i) => (
          <div key={i}>{actionPhrase({ ...a, currentAction: a }) || a.tool}</div>
        ))}
      </div>
    </div>
  );
}

// Palco WEB: a sessao esta num navegador — mostra ONDE ela esta AGORA
// (URL/host da ultima navegacao, moldura de browser) + acoes web recentes.
// Nasceu do bug "olho mostrando ML com a sessao ja na OLX": print velho
// nunca representa navegacao mais nova (vira ghost; webSupersedesFrame).
export function WebArt({ session, plan, mini }) {
  const acts = (Array.isArray(session.recentActions) ? session.recentActions : [])
    .filter(isBrowserAction).slice(-5);
  const doing = doingOf(session);
  return (
    <div className={'ck-art ck-art-web' + (mini ? ' mini' : '')}>
      <div className="ck-web-bar">
        <span className="ck-web-dot" /><span className="ck-web-dot" /><span className="ck-web-dot" />
        <span className="ck-web-url">{plan.url || plan.host || 'página ainda não registrada'}</span>
      </div>
      <div className="ck-art-h">
        {'🌐 '}{doing}
        {plan.host && !doing.includes(plan.host) ? <>{' — '}<b>{plan.host}</b></> : null}
      </div>
      <div className="ck-art-out">
        {acts.map((a, i) => (
          <div key={i}>{actionPhrase({ currentAction: a }) || a.tool}</div>
        ))}
      </div>
    </div>
  );
}

// Linha "nesta sessao: 242k tok · 20min" (dados do payload).
export function DoneStats({ session }) {
  const tok = (session.tokensIn || 0) + (session.tokensOut || 0);
  const dur = Date.parse(session.lastActivityTs || '') - Date.parse(session.startedTs || '');
  return (
    <div className="ck-ndone">
      nesta sessão: <b>{fmtTok(tok)} tok</b>
      {Number.isFinite(dur) && dur > 0 && <>{' · '}<b>{fmtDur(dur)}</b></>}
    </div>
  );
}

export function QuestionArt({ session, color }) {
  return (
    <div className="ck-nowcard ck-nowcard-q" style={{ '--idc': color }}>
      <div className="ck-nk">esperando você — ela perguntou:</div>
      <div className="ck-nq">{'“'}{session.pendingQuestion}{'”'}</div>
      <DoneStats session={session} />
    </div>
  );
}

export function NowCard({ session, color }) {
  return (
    <div className="ck-nowcard" style={{ '--idc': color }}>
      <div className="ck-nk">agora</div>
      <div className="ck-nact">{doingOf(session)}</div>
      <div className="ck-nmi">{session.promptPreview || session.mission || ''}</div>
      <DoneStats session={session} />
    </div>
  );
}

// Palco NASCEU AGORA: asset MCP recém-completado toma o palco (vídeo dá play).
export function BornStage({ born }) {
  const g = born.gen;
  return (
    <div className="ck-stage ck-stage-born">
      {g.type === 'video'
        ? <video className="ck-born-media" src={g.url} autoPlay muted loop playsInline />
        : <img className="ck-born-media" src={thumbSrcOf(g)} alt="" />}
      <span className="ck-caption ck-born-selo">
        <span className="ck-rec" />
        <span>{born.ageSec < 8 ? 'nasceu agora' : 'nasceu há ' + fmtAge(born.ageSec)}
          {g.model ? ' · ' + g.model : ''}</span>
      </span>
      {g.prompt && <span className="ck-born-prompt">{String(g.prompt).slice(0, 120)}</span>}
    </div>
  );
}

// Card JOB RODANDO: geração em andamento (sem resultado ainda).
export function GenJobArt({ job, now }) {
  const sec = Math.max(0, Math.round((now - job.sinceTs) / 1000));
  return (
    <div className="ck-art ck-genjob">
      <div className="ck-art-h">{'✦ gerando — '}<b>{job.label}</b></div>
      <div className="ck-genjob-bar"><i /></div>
      <div className="ck-genjob-t">{'há ' + fmtAge(sec) + ' · higgsfield'}</div>
    </div>
  );
}

// AÇÃO VIVA: fallback final — o palco pulsa com as ações reais da sessão.
export function ActionFeed({ session, color, mini }) {
  const acts = (Array.isArray(session.recentActions) ? session.recentActions : []).slice(-8).reverse();
  const apm = actionsPerMin(session, Date.now());
  const cur = acts[0] || null;
  return (
    <div className={'ck-feed' + (mini ? ' mini' : '')} style={{ '--idc': color }}>
      <div className="ck-feed-hb">
        <span className="ck-feed-pulse" />
        <span>ação viva</span>
        <span className="ck-feed-apm"><b>{apm}</b> ações/min</span>
      </div>
      {cur ? (
        <div className="ck-feed-now" key={(cur.ts || '') + (cur.tool || '')}>
          <div className="ck-feed-verb">{actionPhrase({ currentAction: cur }) || cur.tool}</div>
          {cur.target && <div className="ck-feed-tgt">{String(cur.target).slice(0, 90)}</div>}
        </div>
      ) : (
        <div className="ck-feed-now"><div className="ck-feed-verb">{doingOf(session)}</div></div>
      )}
      <div className="ck-feed-tail">
        {acts.slice(1).map((a, i) => (
          <div key={i} className="ck-feed-tr">{actionPhrase({ currentAction: a }) || a.tool}</div>
        ))}
      </div>
      <div className="ck-feed-mi">{session.promptPreview || session.mission || ''}</div>
    </div>
  );
}

// Palco do artefato (compartilhado com o tile da parede via mini).
export function ArtifactStage({ session, color, plan, peek, mini }) {
  if (plan.mode === 'question') return <QuestionArt session={session} color={color} />;
  if (plan.mode === 'web') return <WebArt session={session} plan={plan} mini={mini} />;
  if (plan.mode === 'file' && peek) return <FileArt data={peek} doing={doingOf(session)} mini={mini} />;
  if (plan.mode === 'dir' && peek) return <DirArt data={peek} mini={mini} />;
  if (plan.mode === 'output') return <OutputArt session={session} plan={plan} mini={mini} />;
  if (plan.mode === 'search') return <SearchArt session={session} plan={plan} mini={mini} />;
  return <ActionFeed session={session} color={color} mini={mini} />;
}

// --------------------------------------------------------------- EyePane ----

function frameUrl(sid, idx) {
  return '/api/visor/frame?session=' + encodeURIComponent(sid) + '&idx=' + idx;
}

// Legenda do ⛶ (Lightbox): "tool · verbo" quando o frame historico tem tool.
function frameCaption(f) {
  return [f.tool, f.verb].filter(Boolean).join(' · ');
}

export default function EyePane({ session, color }) {
  const status = useLiveStatus();
  const sid = session ? session.id : '';
  const frames = useVisorFrames(sid || null);
  const [pinnedIdx, setPinnedIdx] = useState(null);
  const [liveTick, setLiveTick] = useState(0);
  const [deadIdx, setDeadIdx] = useState(null);
  const [lbItem, setLbItem] = useState(null); // ⛶: estado local, independente do artifactPlanOf
  const now = Date.now();
  const gens = useSessionGens(sid || null);
  const born = bornOf(gens, frames, now);
  const genJob = born ? null : genJobOf(session || {}, gens, now);

  const liveOn = status.available && status.targets.length > 0;
  const target = liveOn ? status.targets[0] : null;
  const selo = seloOf({ frames, liveOn, now });
  const plan = artifactPlanOf(session || {});
  const peek = usePeek(plan);
  const dom = domainOf(session || {});
  const last = frames.length ? frames[frames.length - 1] : null;

  useEffect(() => { setPinnedIdx(null); setDeadIdx(null); setLbItem(null); }, [sid]);

  const pinned = pinnedIdx !== null ? frames.find((f) => f.idx === pinnedIdx) || null : null;
  const showLive = liveOn && !pinned;
  // Navegacao mais nova que o ultimo frame => o print nao representa mais o
  // agora: palco vira WebArt e o frame vai de ghost (nunca protagonista).
  const freshShot = !pinned && !showLive && last && last.idx !== deadIdx
    && (selo.cls === 'fresh' || selo.cls === 'warm')
    && !webSupersedesFrame(plan, last);

  useEffect(() => {
    if (!showLive) return undefined;
    const timer = setInterval(() => setLiveTick((n) => n + 1), LIVE_FRAME_MS);
    return () => clearInterval(timer);
  }, [showLive]);

  // ⛶: so existe quando o palco atual E um frame de imagem (CDP ao vivo, frame
  // pinado ou print fresco do visor) — nunca nos modos ArtifactStage (card).
  const currentFrame = pinned
    ? { src: frameUrl(sid, pinned.idx), caption: frameCaption(pinned) }
    : showLive
      ? { src: '/api/live/frame?target=' + encodeURIComponent(target.id) + '&t=' + liveTick, caption: 'ao vivo' + (target?.url ? ' — ' + target.url : '') }
      : freshShot
        ? { src: frameUrl(sid, last.idx), caption: frameCaption(last) }
        : null;
  // Recente primeiro (esquerda): o filmstrip do Lightbox e o strip visivel
  // invertem a ordem cronologica de `frames` (asc do server) pra o que a sessao
  // viu por ULTIMO aparecer de cara; rolar pra direita = voltar no tempo.
  // `last`/`freshShot`/ghost seguem em `frames` (mais recente = frames[len-1]).
  const framesDesc = frames.slice().reverse();
  const filmstrip = framesDesc.map((f) => ({ key: f.idx, src: frameUrl(sid, f.idx), caption: frameCaption(f) }));
  const openLightbox = () => { if (currentFrame) setLbItem(currentFrame); };
  const navLightbox = (nav) => {
    if (typeof nav === 'object') { setLbItem(nav); return; }
    if (!filmstrip.length) return;
    const i = filmstrip.findIndex((f) => f.src === lbItem?.src);
    const next = filmstrip[(i + nav + filmstrip.length) % filmstrip.length];
    if (next) setLbItem(next);
  };

  let stage;
  if (pinned) {
    const age = pinned.ts ? fmtAge((now - Date.parse(pinned.ts)) / 1000) : '?';
    stage = (
      <div className="ck-stage ck-stage-pin">
        <img
          className="ck-hist-img"
          alt={pinned.verb}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          src={frameUrl(sid, pinned.idx)}
        />
        <span className="ck-caption">
          <span className="ck-rec" />
          <span>{'tela de há ' + age + ' · ' + pinned.verb + (pinned.target ? ' — ' + pinned.target : '')}</span>
        </span>
      </div>
    );
  } else if (showLive) {
    stage = (
      <div className="ck-stage">
        <img
          className="ck-live-img"
          alt="olho ao vivo"
          src={'/api/live/frame?target=' + encodeURIComponent(target.id) + '&t=' + liveTick}
        />
        <span className="ck-caption"><span className="ck-rec" /><span>{doingOf(session)}</span></span>
      </div>
    );
  } else if (born) {
    stage = <BornStage born={born} />;
  } else if (genJob) {
    stage = (
      <div className="ck-stage ck-stage-art">
        <GenJobArt job={genJob} now={now} />
      </div>
    );
  } else if (freshShot) {
    stage = (
      <div className="ck-stage">
        <img
          className="ck-hist-img"
          alt=""
          onError={() => setDeadIdx(last.idx)}
          src={frameUrl(sid, last.idx)}
        />
        <span className="ck-caption"><span className="ck-rec" /><span>{doingOf(session)}</span></span>
      </div>
    );
  } else {
    const ghost = last && last.idx !== deadIdx && Number.isFinite(selo.ageSec) ? (
      <button type="button" className="ck-ghost" onClick={() => setPinnedIdx(last.idx)}>
        <img alt="" onError={() => setDeadIdx(last.idx)} src={frameUrl(sid, last.idx)} />
        <span className="ck-ghost-cap">{'última tela · há ' + fmtAge(selo.ageSec)}</span>
      </button>
    ) : null;
    stage = (
      <div className="ck-stage ck-stage-art">
        <ArtifactStage session={session || {}} color={color} plan={plan} peek={peek} mini={false} />
        {ghost}
      </div>
    );
  }

  return (
    <section className="ck-pane ck-eye-pane" style={{ '--idc': color }}>
      <div className="ck-pane-h">
        <span className="ck-ico eye">{'◉'}</span>
        <span className="ck-pane-name">OLHO DA IA</span>
        <span className="ck-tagset">
          <span className="ck-tag" style={{ color: dom.color }}>{dom.label}</span>
          <span className={'ck-tag ck-selo ' + selo.cls}>
            {selo.cls === 'live' && <span className="ck-rec" />}
            {selo.label}
          </span>
          {pinned && (
            <button type="button" className="ck-back-live" onClick={() => setPinnedIdx(null)}>
              voltar ao agora
            </button>
          )}
          {currentFrame && (
            <button type="button" className="ck-expand-btn" onClick={openLightbox} title="expandir (⛶)" aria-label="expandir imagem">
              {'⛶'}
            </button>
          )}
        </span>
      </div>
      {showLive && target && (
        <div className="ck-urlbar">
          <span className="ck-url-lbl">url</span>
          <span className="ck-url">{target.url || target.title || '(sem titulo)'}</span>
        </div>
      )}
      {stage}
      {frames.length > 0 && (
        <div className="ck-strip-wrap">
          <div className="ck-strip-h">histórico — o que esta sessão viu (recentes primeiro)</div>
          <div className="ck-strip">
            {framesDesc.map((f) => {
              const age = f.ts ? fmtAge((now - Date.parse(f.ts)) / 1000) : '?';
              return (
                <button
                  key={f.idx}
                  type="button"
                  className={'ck-fr' + (pinned && f.idx === pinned.idx ? ' on' : '')}
                  onClick={() => setPinnedIdx(f.idx)}
                  title={f.verb + (f.target ? ' - ' + f.target : '')}
                >
                  <span className="ck-fr-im">
                    <img
                      loading="lazy"
                      alt=""
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      src={frameUrl(sid, f.idx)}
                    />
                  </span>
                  <span className="ck-fr-cp">{'há ' + age + ' · ' + f.verb}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Lightbox
        open={Boolean(lbItem)} item={lbItem} filmstrip={filmstrip}
        onClose={() => setLbItem(null)} onNav={navLightbox}
      />
    </section>
  );
}
