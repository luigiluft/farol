// FAROL - Rail operacional do CEREBRO (refactor v2, F2b). Coluna direita
// que responde o gap visual do Claude Code de relance:
//   AGORA      quem trabalha/espera, verbo, output atual (expande), ctx %
//   MOVIMENTOS o que mudou no vault (git real via /api/fluxo) + diff drawer
//   CONSUMO    tokens hoje/1h + ritmo ao vivo (sparkline por SSE stats)
//   ESTEIRA    proxima rotina, ultima ok, quebrada
//   MAQUINA    cpu/ram/disco + veredito
// Substitui HudChips+TorreFlights+PerfHud SO no modo esfera (universo antigo
// mantem os overlays historicos). Dados: payloads ja existentes + /api/fluxo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, onVaultPing } from './api.js';
import { useStats } from './StatsBar.jsx';
import { contextPct, fmtTokens } from './roomData.js';
import { actionPhrase } from './callsigns.js';
import './rail.css';

const FLUXO_POLL_MS = 30000;
const ESTEIRA_POLL_MS = 60000;
const SPARK_TICKS = 40;

// ---------------- helpers puros ----------------
export function railOrder(sessions) {
  const list = (sessions || []).filter((s) => s && s.state !== 'dormindo');
  const rank = (s) => (s.awaitingInput ? 0 : s.state === 'ativa' ? 1 : 2);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    // esperando: quem espera ha MAIS tempo primeiro; demais: mais quente primeiro
    return rank(a) === 0
      ? (a.lastActivityTs || 0) - (b.lastActivityTs || 0)
      : (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
  }).slice(0, 7);
}

function agoText(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
}

function basename(p) {
  const parts = String(p || '').split('/');
  return parts[parts.length - 1];
}
function parentDir(p) {
  const parts = String(p || '').split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

// ---------------- AGORA ----------------
function SessionRow({ s, onSelect }) {
  const [open, setOpen] = useState(false);
  const wait = !!s.awaitingInput;
  const pct = contextPct(s);
  const verb = wait
    ? `esperando você · ${(s.pendingQuestion || 'resposta pendente').slice(0, 60)}`
    : (actionPhrase(s) || s.narrative || s.promptPreview || 'sessão viva');
  const acts = Array.isArray(s.recentActions) ? s.recentActions.slice(-3).reverse() : [];
  return (
    <div className={`rl-sess${open ? ' open' : ''}${wait ? ' is-wait' : ''}`}>
      <button type="button" className="rl-l1" onClick={() => setOpen((v) => !v)}>
        <span className={`rl-dot${wait ? ' wait' : s.state === 'ativa' ? ' on' : ''}`} />
        <span
          className="rl-nm"
          title="abrir dossiê"
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'session', sessionId: s.id }); }}
        >
          {s.name || s.topic || 'sessão'}
        </span>
        <span className="rl-proj">{s.project || 'home'}</span>
        <span className="rl-car">▸</span>
      </button>
      <div className={`rl-verb${wait ? ' wait' : ''}`}>{verb}</div>
      <div className="rl-tok">
        {fmtTokens(s.tokensOut)} tokens
        {wait ? <span className="rl-ago"> · {agoText(s.lastActivityTs)}</span> : null}
        {pct !== null ? (
          <span className="rl-ctx">
            <span className="rl-ctxbar"><i className={pct >= 70 ? 'warn' : ''} style={{ width: `${pct}%` }} /></span>
            <span className={pct >= 70 ? 'rl-warn' : ''}>{pct}%</span>
          </span>
        ) : null}
      </div>
      <div className="rl-det">
        <div className="rl-out">
          <div className="hd">{wait ? 'pergunta pendente' : 'agora'}</div>
          {wait
            ? <div>{s.pendingQuestion || 'aguardando sua resposta'}</div>
            : <div>{s.narrative || s.mission || s.promptPreview || 'sem resumo ainda'}</div>}
        </div>
        {acts.length ? (
          <div className="rl-acts">
            {acts.map((a, i) => (
              <div key={a.ts ?? i}>· {a.tool} <b>{basename(a.target || a.vaultPath || '')}</b></div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------- MOVIMENTOS ----------------
function MoveBar({ adds, dels, binary }) {
  if (binary) return <span className="rl-mvn">bin</span>;
  const tot = Math.max((adds || 0) + (dels || 0), 1);
  const w = 30;
  const wa = adds ? Math.max((adds / tot) * w, 3) : 0;
  const wd = dels ? Math.max((dels / tot) * w, 3) : 0;
  return (
    <span className="rl-mvwrap">
      <span className="rl-mvbar">
        {wa ? <i className="a" style={{ width: wa }} /> : null}
        {wd ? <i className="d" style={{ width: wd }} /> : null}
      </span>
      <span className="rl-mvn">+{adds}{dels ? ` −${dels}` : ''}</span>
    </span>
  );
}

function hhmm(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- rail ----------------
export default function Rail({ sessions, onSelect, onOpenNote, sphereApi }) {
  const { stats } = useStats();
  const [fluxo, setFluxo] = useState(null);
  const [esteira, setEsteira] = useState(null);
  const [diffSel, setDiffSel] = useState(null); // {sha,path,diff,truncated,loading}
  const ticksRef = useRef([]);
  const lastOutRef = useRef(null);

  // fluxo: poll + ping de vault
  useEffect(() => {
    let alive = true;
    const load = () => fetchJson('/api/fluxo')
      .then((d) => { if (alive) setFluxo(d); })
      .catch(() => {});
    load();
    const t = setInterval(load, FLUXO_POLL_MS);
    const off = onVaultPing(load);
    return () => { alive = false; clearInterval(t); off(); };
  }, []);

  // esteira: poll lento
  useEffect(() => {
    let alive = true;
    const load = () => fetchJson('/api/esteira')
      .then((d) => { if (alive) setEsteira(d); })
      .catch(() => {});
    load();
    const t = setInterval(load, ESTEIRA_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // sparkline do ritmo: delta de usage.today.out por snapshot SSE (2s)
  const todayOut = stats?.usage?.today?.out ?? null;
  if (todayOut !== null && todayOut !== lastOutRef.current) {
    if (lastOutRef.current !== null) {
      const d = Math.max(0, todayOut - lastOutRef.current);
      ticksRef.current = [...ticksRef.current.slice(-(SPARK_TICKS - 1)), d];
    }
    lastOutRef.current = todayOut;
  }
  const ticks = ticksRef.current;
  const burn = ticks.length ? Math.round(ticks[ticks.length - 1] / 2) : null;

  const ordered = useMemo(() => railOrder(sessions), [sessions]);
  const rows = fluxo?.rows ? fluxo.rows.slice(0, 8) : [];

  const jobs = esteira?.jobs || [];
  const now = Date.now();
  const nextJob = jobs.filter((j) => j.enabled && j.nextMs > now).sort((a, b) => a.nextMs - b.nextMs)[0];
  const broken = jobs.find((j) => j.enabled && j.result !== 0);
  const lastOk = (esteira?.feed || []).find((f) => !f.fail && !f.silent) || (esteira?.feed || [])[0];

  const cpu = Math.round(Number(stats?.cpuPct) || 0);
  const ramG = (Number(stats?.memUsedMb || 0) / 1024).toFixed(1);
  const liso = stats && cpu < 92 && stats.drift !== 'crit';

  function openDiff(r) {
    setDiffSel({ sha: r.sha, path: r.path, loading: true });
    fetchJson(`/api/fluxo/diff?c=${encodeURIComponent(r.sha)}&f=${encodeURIComponent(r.path)}`)
      .then((d) => setDiffSel((cur) => (cur && cur.sha === r.sha ? { ...d, path: r.path } : cur)))
      .catch(() => setDiffSel((cur) => (cur && cur.sha === r.sha ? { ...cur, loading: false, diff: '' } : cur)));
  }

  return (
    <aside className="rail" aria-label="Rail operacional">
      <div className="rl-title">Agora <span className="rl-live" /></div>
      <div className="rl-card">
        {ordered.length === 0 ? <div className="rl-empty">nenhuma sessão viva</div>
          : ordered.map((s) => <SessionRow key={s.id} s={s} onSelect={onSelect} />)}
      </div>

      <div className="rl-title">Movimentos</div>
      <div className="rl-card rl-movs">
        {rows.length === 0 ? <div className="rl-empty">sem movimentos no git do vault</div> : rows.map((r, i) => (
          <button
            type="button"
            key={`${r.sha}-${r.path}-${i}`}
            className="rl-mv"
            onMouseEnter={() => sphereApi?.current?.pulsePath?.(r.path)}
            onClick={() => { openDiff(r); sphereApi?.current?.focusPath?.(r.path); }}
          >
            <span className="rl-mvwho">{r.who === 'sessao' ? 'sessão' : r.who}</span>
            <span className="rl-mvx">
              <span className="rl-mvpath" title={r.path}>{basename(r.path)}</span>
              <span className="rl-mvdir">{parentDir(r.path)} · {hhmm(r.ts)}</span>
            </span>
            <MoveBar adds={r.adds} dels={r.dels} binary={r.binary} />
          </button>
        ))}
      </div>

      <div className="rl-title">Consumo <span className="rl-live" /></div>
      <div className="rl-card">
        <div className="rl-kv"><span className="k">tokens hoje</span><span className="v">{stats?.usage ? fmtTokens(stats.usage.today.out) : '—'}</span></div>
        <div className="rl-kv"><span className="k">última hora</span><span className="v">{stats?.usage ? fmtTokens(stats.usage.hour.out) : '—'}</span></div>
        <div className="rl-kv"><span className="k">ritmo</span><span className="v">{burn === null ? '—' : `${fmtTokens(burn)} tok/s`}</span></div>
        <div className="rl-spark" aria-hidden="true">
          {ticks.map((v, i) => {
            const mx = Math.max(...ticks, 1);
            return <i key={i} className={i === ticks.length - 1 ? 'hot' : ''} style={{ height: `${8 + (v / mx) * 82}%` }} />;
          })}
        </div>
      </div>

      <div className="rl-title">Esteira</div>
      <div className="rl-card">
        <div className="rl-kv"><span className="k">próxima</span><span className="v">{nextJob ? nextJob.name : '—'}<small>{nextJob ? nextJob.next.split(' ').pop() : ''}</small></span></div>
        <div className="rl-kv"><span className="k">última</span><span className="v">{lastOk ? lastOk.name : '—'}<small>{lastOk ? lastOk.t : ''}</small></span></div>
        {broken ? (
          <div className="rl-kv"><span className="k bad">quebrada</span><span className="v bad">{broken.name}<small>exit {broken.result}</small></span></div>
        ) : null}
      </div>

      <div className="rl-title">Máquina</div>
      <div className="rl-card">
        <div className="rl-kv"><span className="k">cpu</span><span className="v">{stats ? `${cpu}%` : '—'}</span></div>
        <div className="rl-kv"><span className="k">ram</span><span className="v">{stats ? `${ramG}G` : '—'}<small>/ {(Number(stats?.memTotalMb || 0) / 1024).toFixed(0)}G</small></span></div>
        <div className="rl-kv"><span className="k">disco livre</span><span className="v">{stats?.diskFreeGb == null ? '—' : `${Math.round(stats.diskFreeGb)}G`}</span></div>
        <div className="rl-liso"><span className={`d${liso ? '' : ' warn'}`} /> {liso ? 'rodando liso' : 'sob carga'} · up {Math.floor((stats?.uptimeMin || 0) / 1440)}d</div>
      </div>

      {diffSel ? (
        <div className="rl-drawer" role="dialog" aria-label="Diff da nota">
          <button type="button" className="rl-dwclose" onClick={() => setDiffSel(null)}>✕</button>
          <div className="rl-dweyebrow">movimento · {diffSel.sha}</div>
          <div className="rl-dwpath">{diffSel.path}</div>
          <div className="rl-dwdiff">
            {diffSel.loading ? <div className="rl-empty">carregando…</div>
              : (diffSel.diff || '').split('\n').slice(0, 400).map((l, i) => (
                <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : 'ctx'}>{l || ' '}</div>
              ))}
            {diffSel.truncated ? <div className="rl-empty">… truncado em 64KB</div> : null}
            {!diffSel.loading && !diffSel.diff ? <div className="rl-empty">sem mudança de texto (rename/meta)</div> : null}
          </div>
          {onOpenNote && diffSel.path && diffSel.path.endsWith('.md') ? (
            <button type="button" className="rl-dwopen" onClick={() => onOpenNote(diffSel.path)}>abrir a nota no editor</button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
