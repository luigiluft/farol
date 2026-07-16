// FAROL - Cockpit v2: PAREDE DE OLHOS. Tile = mesma maquina do olho em
// miniatura (tile A do mock validado): frame fresco protagonista; esperando
// mostra a PERGUNTA; senao mini-artefato (peek 15s) ou card AGORA sobre a
// ultima tela apagada. Rodape = selo de frescor + "ja fez" (tokens/tempo).
// Gotcha de grid: fundo em position:absolute (NUNCA 2 itens de grid
// empilhados — o card cairia pra linha 2 invisivel).
//
// v3 (flag torre.wallV3): a parede quebra em FAIXAS por estado (lanes,
// decisao do Luigi) e cada tile ganha faixa de estado + linha de status
// persistente + rodape de vitais (contexto %, fases, tokens). Tudo reusa
// campos que o servidor ja manda; nada de backend novo. Left border segue a
// COR DE IDENTIDADE (decisao "so a faixa" — o tile nao vira alerta inteiro).
import { useEffect, useState } from 'react';
import { fetchJson } from './api.js';
import { callsign } from './callsigns.js';
import {
  idColor, initials, seloOf, artifactPlanOf, domainOf, fmtAge, fmtTok, fmtDur,
  webSupersedesFrame, wallStateOf, ctxPctOf, phaseOf, laneGroups,
} from './cockpit-model.js';
import {
  ArtifactStage, doingOf, usePeek,
} from './cockpit-eye.jsx';

const WALL_REFRESH_MS = 5000;
const TILE_PEEK_MS = 15000;

// Redesign v3 = DEFAULT. Escape hatch: localStorage.torre.wallV3='0' cai na
// parede v1 (grade sem faixas). Mesmo padrao dos outros redesigns da Torre.
function readWallV3() {
  try {
    return localStorage.getItem('torre.wallV3') !== '0';
  } catch {
    return true;
  }
}

const RIBBON_LABEL = { wait: 'esperando você', work: 'trabalhando', idle: 'ociosa', sleep: 'dormindo' };

function ribbonMeta(state, ageSec, freshShot) {
  if (state === 'wait') return Number.isFinite(ageSec) ? 'há ' + fmtAge(ageSec) : '';
  if (state === 'work') return freshShot ? 'olho ao vivo' : 'em ação';
  if (state === 'idle') return (Number.isFinite(ageSec) ? 'há ' + fmtAge(ageSec) + ' · ' : '') + 'sem tarefa';
  return 'encerrada';
}

// Linha de status persistente: sempre responde "o que ela faz agora", com ou
// sem screenshot. Glifo espelha os cabecalhos do ArtifactStage (⌨ 🗂 ▸ 🔍 🌐).
function statusOf(session, plan, state) {
  if (state === 'sleep') return { g: '💤', t: 'sessão encerrada' };
  if (plan.mode === 'question') return { g: '💬', t: 'pergunta pendente' };
  if (plan.mode === 'web') return { g: '🌐', t: doingOf(session) };
  if (plan.mode === 'file') return { g: '⌨', t: doingOf(session) };
  if (plan.mode === 'dir') return { g: '🗂', t: doingOf(session) };
  if (plan.mode === 'output') return { g: '▸', t: doingOf(session) };
  if (plan.mode === 'search') return { g: '🔍', t: doingOf(session) };
  if (state === 'idle') return { g: '✓', t: 'aguardando próxima tarefa' };
  return { g: '·', t: doingOf(session) };
}

function PhaseEl({ phase }) {
  if (phase.total <= 6) {
    const pips = [];
    for (let i = 0; i < phase.total; i += 1) pips.push(<b key={i} className={i < phase.done ? 'on' : ''} />);
    return (
      <span className="ck-ph">
        <span className="ck-ph-pips">{pips}</span>{phase.done + '/' + phase.total}
      </span>
    );
  }
  const pct = Math.round((phase.done / phase.total) * 100);
  return (
    <span className="ck-ph">
      <span className="ck-ctx-bar"><i style={{ width: pct + '%' }} /></span>{phase.done + '/' + phase.total}
    </span>
  );
}

// Indice de frames do tile (re-busca ~5s; aborta no unmount).
function useTileFrames(id) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    setFrames([]);
    if (!id) return undefined;
    let alive = true;
    let ctrl = null;
    const load = async () => {
      if (!alive) return;
      ctrl = new AbortController();
      try {
        const r = await fetch('/api/visor?session=' + encodeURIComponent(id), { signal: ctrl.signal });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setFrames(Array.isArray(d.frames) ? d.frames : []);
      } catch {
        // abort ou rede indisponivel: o proximo tick tenta de novo
      }
    };
    load();
    const timer = setInterval(load, WALL_REFRESH_MS);
    return () => { alive = false; if (ctrl) ctrl.abort(); clearInterval(timer); };
  }, [id]);
  return frames;
}

function frameUrl(sid, idx) {
  return '/api/visor/frame?session=' + encodeURIComponent(sid) + '&idx=' + idx;
}

function WallTile({ session, onExpand, v3 }) {
  const color = idColor(session.id);
  const cs = callsign(session.id);
  const dom = domainOf(session);
  const state = wallStateOf(session);
  const waiting = state === 'wait';
  const dotCls = waiting ? 'w' : session.state === 'ativa' ? 'a' : session.state === 'ociosa' ? 'o' : 'd';
  const frames = useTileFrames(session.id);
  const now = Date.now();
  const selo = seloOf({ frames, liveOn: false, now });
  const plan = artifactPlanOf(session);
  const peek = usePeek(plan, TILE_PEEK_MS);
  const [deadIdx, setDeadIdx] = useState(null);
  const last = frames.length ? frames[frames.length - 1] : null;
  const lastOk = last && last.idx !== deadIdx;
  const freshShot = !waiting && lastOk && (selo.cls === 'fresh' || selo.cls === 'warm')
    && !webSupersedesFrame(plan, last);

  const tok = (session.tokensIn || 0) + (session.tokensOut || 0);
  const dur = Date.parse(session.lastActivityTs || '') - Date.parse(session.startedTs || '');
  const actMs = Date.parse(session.lastActivityTs || '');
  const ageSec = Number.isFinite(actMs) ? (now - actMs) / 1000 : NaN;
  const ctx = ctxPctOf(session);
  const phase = phaseOf(session);
  const stat = statusOf(session, plan, state);

  let eye;
  if (freshShot) {
    eye = (
      <>
        <img
          className="ck-tile-img"
          loading="lazy"
          alt=""
          onError={() => setDeadIdx(last.idx)}
          src={frameUrl(session.id, last.idx)}
        />
        <span className="ck-tile-cap"><span className="ck-rec" /><span>{doingOf(session)}</span></span>
      </>
    );
  } else {
    eye = (
      <>
        {lastOk && (
          <img
            className="ck-tile-bg"
            loading="lazy"
            alt=""
            onError={() => setDeadIdx(last.idx)}
            src={frameUrl(session.id, last.idx)}
          />
        )}
        <ArtifactStage session={session} color={color} plan={plan} peek={peek} mini />
      </>
    );
  }

  const cls = 'ck-tile' + (v3 ? ' ck-tile-v3 st-' + state : (waiting ? ' waiting' : ''));

  return (
    <button
      type="button"
      className={cls}
      style={{ '--idc': color }}
      onClick={() => onExpand(session.id)}
      title={cs + ' - ' + doingOf(session)}
    >
      <span className="ck-tile-h">
        <span className="ck-tile-av">{initials(cs)}</span>
        <span className="ck-tile-cs">{cs}</span>
        <span className="ck-dm" style={{ color: dom.color }}>{dom.label}</span>
        <span className="ck-tile-pj">{session.project || 'home'}</span>
        <span className={'ck-d ' + dotCls} />
      </span>
      {v3 && (
        <span className="ck-trib">
          <span className="ck-trib-d" />
          <span className="ck-trib-lb">{RIBBON_LABEL[state]}</span>
          <span className="ck-trib-mt">{ribbonMeta(state, ageSec, freshShot)}</span>
          {state === 'wait' && <span className="ck-trib-cta">responder ↵</span>}
        </span>
      )}
      <span className="ck-tile-eye">{eye}</span>
      {v3 && (
        <span className="ck-tstatus">
          <span className="ck-tstatus-g">{stat.g}</span>
          <span className="ck-tstatus-t">{stat.t}</span>
        </span>
      )}
      {v3 ? (
        <span className="ck-tile-f ck-vit">
          <span className={'ck-tile-selo ' + selo.cls}>
            <span className="ck-rec" />
            {selo.label}
          </span>
          {ctx != null && (
            <span className={'ck-ctx' + (ctx >= 70 ? ' hot' : '')}>
              <span className="ck-ctx-bar"><i style={{ width: ctx + '%' }} /></span>{ctx + '%'}
            </span>
          )}
          {phase && <PhaseEl phase={phase} />}
          <span className="ck-tile-done">
            {fmtTok(tok)}{' tok'}
            {Number.isFinite(dur) && dur > 0 ? ' · ' + fmtDur(dur) : ''}
          </span>
        </span>
      ) : (
        <span className="ck-tile-f">
          <span className={'ck-tile-selo ' + selo.cls}>
            <span className="ck-rec" />
            {selo.label}
          </span>
          <span className="ck-tile-done">
            {fmtTok(tok)}{' tok'}
            {Number.isFinite(dur) && dur > 0 ? ' · ' + fmtDur(dur) : ''}
          </span>
        </span>
      )}
    </button>
  );
}

// Faixas por estado (v3): precisa de você / trabalhando / paradas. Faixa vazia
// nao aparece; dentro dela a espera mais longa fica no topo (laneGroups).
function WallLanes({ sessions, onExpand }) {
  const lanes = laneGroups(sessions);
  return (
    <div className="ck-wall-v3">
      {lanes.map((lane) => (
        <section key={lane.key} className={'ck-lane tone-' + lane.tone}>
          <div className="ck-lane-h">
            <span className="ck-lane-dot" />
            <span className="ck-lane-lb">{lane.label}</span>
            <span className="ck-lane-n">{lane.sessions.length}</span>
          </div>
          <div className="ck-wall">
            {lane.sessions.map((s) => (
              <WallTile key={s.id} session={s} onExpand={onExpand} v3 />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function EyeWall({ sessions, onExpand }) {
  if (readWallV3()) {
    return <WallLanes sessions={sessions} onExpand={onExpand} />;
  }
  return (
    <div className="ck-wall">
      {sessions.map((s) => (
        <WallTile key={s.id} session={s} onExpand={onExpand} />
      ))}
    </div>
  );
}
