// FAROL - view Esteira (monitor de automacao). Porte fiel do mockup aprovado
// (.data/esteira-mockups.html): cabecalho + KPIs de saude, board agrupado por
// saude (precisa de atencao / funcionais / desligadas) com heartbeat das
// ultimas 14 execucoes + uptime% + ultima + "↳ output" + proxima, e o painel
// "Historico · ultimas execucoes" (feed newest no topo + indicador ao vivo).
// Consome /api/esteira via useApi; estados loading/vazio/erro defensivos.
// Countdown ao vivo no job mais proximo (replica o efeito do mockup).
// Cores SO via tokens (esteira.css). Animacao SO opacity.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from './api.js';
import Unlock from './Unlock.jsx';
import './esteira.css';

const COUNTDOWN_CYCLE_S = 5 * 60; // ciclo do contador "ao vivo" (igual ao mockup)

// --------------------------------------------------------------- saude ----

// Espelha health() do mockup: result != 0 => fail; senao !enabled => off; ok.
function health(job) {
  if (!job) return 'off';
  if (job.result && job.result !== 0) return 'fail';
  return job.enabled === false ? 'off' : 'ok';
}

function upClass(v) {
  if (v === null || v === undefined) return 'na';
  if (v >= 99) return '';
  if (v >= 80) return 'warn';
  return 'bad';
}

// "10:35" -> segundos ate esse horario hoje (futuro). Nao-HH:MM => null.
function secondsUntilToday(label) {
  if (typeof label !== 'string') return null;
  const m = label.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const now = new Date();
  const target = new Date();
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / 1000);
  return diff > 0 ? diff : null;
}

// Job "ao vivo" = o habilitado com a proxima execucao parseavel mais proxima.
function pickLiveJob(jobs) {
  let best = null;
  let bestS = Infinity;
  for (const j of jobs) {
    if (health(j) === 'off') continue;
    const s = secondsUntilToday(j.next);
    if (s !== null && s < bestS) {
      bestS = s;
      best = j;
    }
  }
  return best ? best.name : null;
}

// ------------------------------------------------------------ view ----

export default function Esteira() {
  const { data, error, loading } = useApi('/api/esteira');
  const jobs = Array.isArray(data && data.jobs) ? data.jobs : [];
  const feed = Array.isArray(data && data.feed) ? data.feed : [];
  const liveName = useMemo(() => pickLiveJob(jobs), [jobs]);
  const ct = useCountdown(jobs, liveName);

  const groups = useMemo(() => groupByHealth(jobs), [jobs]);
  const kpis = useMemo(() => computeKpis(jobs), [jobs]);

  // selecao de rotina: abre o DRAWER de detalhe no lugar do feed (variante A).
  const [sel, setSel] = useState(null);
  const [selRun, setSelRun] = useState(0);
  const [outTab, setOutTab] = useState('stdout');
  const selJob = useMemo(() => jobs.find((j) => j && j.name === sel) || null, [jobs, sel]);
  const onSelect = (name) => { setSel(name); setSelRun(0); setOutTab('stdout'); };
  const onClose = () => setSel(null);

  // Esc fecha o drawer.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  if (loading && jobs.length === 0) {
    return <div className="es-state dim">lendo as automacoes…</div>;
  }
  if (error && jobs.length === 0) {
    return (
      <div className="es-state crit">
        esteira offline: {String((error && error.message) || error)}
      </div>
    );
  }
  if (!loading && jobs.length === 0) {
    return (
      <div className="es-state dim">
        <Unlock
          title="A Esteira mostra as suas automações agendadas"
          lead="Declare suas tarefas agendadas (Task Scheduler do Windows, cron, etc.) num arquivo e elas aparecem aqui com histórico de execução."
          steps={[
            'Crie o arquivo .data/esteira.json na pasta do Farol',
            'Declare cada automação com nome e o que ela faz',
            'Opcional: rode o comando via scripts/esteira-log.mjs para log rico por execução',
          ]}
          exampleLabel=".data/esteira.json"
          example={'{\n  "MeuBackup": {\n    "what": "Backup das fotos pro NAS",\n    "src": ["Pasta Fotos"], "dst": ["NAS"],\n    "cadence": "diario 02:00", "claude": false\n  }\n}'}
          guia="#6-view-esteira-suas-automações-avançado-windows"
        />
      </div>
    );
  }

  return (
    <div className="es">
      <EsteiraHead kpis={kpis} ct={ct} jobCount={jobs.length} />
      <div className="es-main">
        <Board groups={groups} liveName={liveName} ct={ct} onSelect={onSelect} sel={sel} />
        {selJob ? (
          <Drawer
            job={selJob}
            selRun={selRun}
            setSelRun={setSelRun}
            outTab={outTab}
            setOutTab={setOutTab}
            onClose={onClose}
          />
        ) : (
          <Hist feed={feed} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------- cabecalho ----

function EsteiraHead({ kpis, ct, jobCount }) {
  return (
    <header className="es-head">
      <div>
        <div className="es-title">
          <b>A ESTEIRA</b> &nbsp;·&nbsp; monitor de automacao
        </div>
        <div className="es-sub">
          {jobCount} rotinas · historico de execucoes + output
        </div>
      </div>
      <div className="es-legend">
        <span><i className="es-lg-ok" />ok</span>
        <span><i className="es-lg-fail" />falha</span>
        <span><i className="es-lg-skip" />nao rodou</span>
      </div>
      <div className="es-kpis">
        <div className="es-kpi k-ok"><b>{kpis.ok}</b>funcionais</div>
        <div className="es-kpi k-fail"><b>{kpis.fail}</b>com falha</div>
        <div className="es-kpi k-off"><b>{kpis.off}</b>desligadas</div>
        <div className="es-kpi k-up"><b>{kpis.avgUp === null ? '—' : `${kpis.avgUp}%`}</b>uptime medio</div>
        <div className="es-kpi k-next"><b>{ct || '--:--'}</b>proximo</div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------ board ----

function Board({ groups, liveName, ct, onSelect, sel }) {
  const row = (j) => (
    <Row key={j.name} job={j} liveName={liveName} ct={ct} onSelect={onSelect} sel={sel} />
  );
  return (
    <div className="es-board panel">
      <div className="es-rhead">
        <span>Automacao · o que faz</span>
        <span>Saude (14 runs)</span>
        <span className="r">Uptime</span>
        <span>Ultima execucao · output</span>
        <span className="r">Proxima</span>
      </div>
      {groups.attn.length > 0 && (
        <>
          <div className="es-grp attn">precisa de atencao · {groups.attn.length}</div>
          {groups.attn.map(row)}
        </>
      )}
      <div className="es-grp">funcionais · {groups.ok.length}</div>
      {groups.ok.map(row)}
      {groups.off.length > 0 && (
        <>
          <div className="es-grp">desligadas · {groups.off.length}</div>
          {groups.off.map(row)}
        </>
      )}
    </div>
  );
}

// Estado da coluna de output, derivado da run mais recente (job.runs[0]):
//   fail   -> vermelho, summary/stderr + chip "exit N"
//   silent -> "rodou - sem saida" calmo (antes era um muro de "exit 0")
//   real   -> o texto do summary
function outState(job) {
  const h = health(job);
  const run = Array.isArray(job.runs) && job.runs[0] ? job.runs[0] : null;
  const dur = run && run.dur ? run.dur : null;
  if (h === 'fail') {
    const text = (run && run.summary) || job.lastOutput || `exit ${job.result}`;
    return { cls: 'fail', icon: '✗', text, dur, exitBad: true };
  }
  if (run && run.silent) {
    return { cls: 'silent', icon: '✓', text: 'rodou · sem saida', dur };
  }
  return { cls: 'real', icon: '↳', text: (run && run.summary) || job.lastOutput || 'ok', dur };
}

function Row({ job, liveName, ct, onSelect, sel }) {
  const h = health(job);
  const v = job.uptime;
  const os = outState(job);
  const cls = 'es-row'
    + (h === 'fail' ? ' fail' : '')
    + (h === 'off' ? ' off' : '')
    + (sel === job.name ? ' sel' : '');
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(job.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(job.name); } }}
    >
      <div>
        <div className="es-name">
          <span className={'es-dot ' + h} />
          <span className="es-nm">{job.name}</span>
          {job.claude ? <span className="es-badge">CLAUDE</span> : null}
        </div>
        <div className="es-what">{job.what}</div>
      </div>
      <Heartbeat hist={job.hist} />
      <div className={'es-up ' + upClass(v)}>{v === null || v === undefined ? '—' : `${v}%`}</div>
      <div>
        <div className="es-last-when">
          {job.last}
          {os.dur ? <span className="es-dur">· {os.dur}</span> : null}
        </div>
        <div className={'es-out ' + os.cls}>
          <span className="ar">{os.icon}</span>
          <span className="tx">{os.text}</span>
          {os.exitBad ? <span className="es-exit bad">exit {job.result}</span> : null}
          <span className="es-seemore">ver log ▸</span>
        </div>
      </div>
      <Next job={job} liveName={liveName} ct={ct} />
    </div>
  );
}

function Heartbeat({ hist }) {
  const arr = Array.isArray(hist) ? hist : [];
  return (
    <div className="es-hb" title="ultimas execucoes">
      {arr.map((h, i) => {
        const base = h === 'fail' ? 'fail' : h === 'skip' ? 'skip' : '';
        const last = i === arr.length - 1 ? ' last' : '';
        return <i key={i} className={(base + last).trim()} />;
      })}
    </div>
  );
}

function Next({ job, liveName, ct }) {
  const isLive = job.name === liveName && ct;
  let value;
  if (job.next === '—') {
    value = <span className="muted">—</span>;
  } else if (job.next === 'sempre') {
    value = <span className="muted">sempre ativo</span>;
  } else if (isLive) {
    value = <span className="ct">{ct}</span>;
  } else {
    value = job.next;
  }
  return (
    <div className="es-nx">
      <div className="v">{value}</div>
      <div className="c">{job.cadence}</div>
    </div>
  );
}

// ------------------------------------------------------------- feed ----

function Hist({ feed, onSelect }) {
  return (
    <aside className="es-hist panel">
      <div className="es-hist-head">
        <h2>Historico · ultimas execucoes</h2>
        <span className="es-hist-c">
          {feed.length} runs ·{' '}
          <span className="es-live"><span className="es-live-dot" />ao vivo</span>
        </span>
      </div>
      <div className="es-feed">
        {feed.length === 0 ? (
          <div className="es-feed-empty">sem execucoes registradas ainda</div>
        ) : (
          <>
            <div className="es-fday">hoje</div>
            {feed.map((f, i) => (
              <FeedRow key={`${f.name}-${f.t}-${i}`} row={f} latest={i === 0} onSelect={onSelect} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function FeedRow({ row, latest, onSelect }) {
  const silent = row.silent === true && !row.fail;
  const icon = row.fail ? '✗' : silent ? '✓' : '↳';
  return (
    <div
      className={'es-frow' + (row.fail ? ' fail' : '') + (latest ? ' latest' : '')}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row.name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.name); } }}
    >
      <div className="es-ftime">{row.t}</div>
      <div className="es-fmain">
        <div className="es-fname">
          <span className={'es-fdot' + (row.fail ? ' fail' : '')} />
          <span className="es-fname-tx">{row.name}</span>
          {row.claude ? <span className="es-fbadge">CLAUDE</span> : null}
        </div>
        <div className={'es-fout' + (silent ? ' silent' : '')}>
          <span className="ar">{icon}</span> {silent ? 'rodou · sem saida' : row.output}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- drawer ----
// Detalhe da rotina: cabecalho + origem->destino + chips, timeline das ultimas
// runs (clicaveis) e a SAIDA crua completa (stdout/stderr) da run selecionada.
// Ocupa a coluna do feed quando uma rotina esta selecionada (variante A).

function Drawer({ job, selRun, setSelRun, outTab, setOutTab, onClose }) {
  const h = health(job);
  const runs = Array.isArray(job.runs) ? job.runs : [];
  const run = runs[selRun] || runs[0] || null;
  return (
    <aside className="es-hist dw panel">
      <div className="dw-head">
        <button className="dw-x" onClick={onClose} aria-label="fechar detalhe">×</button>
        <div className="dw-top">
          <span className={'es-dot ' + h} />
          <span className="dw-nm">{job.name}</span>
          {job.claude ? <span className="es-badge">CLAUDE</span> : null}
        </div>
        <div className="dw-what">{job.what}</div>
        <div className="dw-flow">
          <span className="s">{job.src.join(', ')}</span>
          <span className="arrow">→</span>
          <span className="d">{job.dst.join(', ')}</span>
        </div>
        <div className="dw-meta">
          <span className="dw-chip">cadencia <b>{job.cadence}</b></span>
          <span className="dw-chip">uptime <b>{job.uptime == null ? '—' : `${job.uptime}%`}</b></span>
          <span className="dw-chip">proxima <b>{job.next}</b></span>
        </div>
      </div>
      <div className="dw-sec">ultimas runs</div>
      <div className="dw-runs">
        {runs.length === 0 ? (
          <div className="dw-empty">sem runs registradas</div>
        ) : (
          runs.map((rr, i) => (
            <div
              key={i}
              className={'dw-run' + (i === selRun ? ' sel' : '')}
              role="button"
              tabIndex={0}
              onClick={() => setSelRun(i)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSelRun(i); }}
            >
              <span className="t">{rr.t}</span>
              <span className={'mk ' + (rr.ok ? 'ok' : 'bad')}>{rr.ok ? '✓' : '✗'}</span>
              <span className={'sm' + (rr.silent ? ' silent' : '')}>
                {rr.summary || (rr.silent ? 'sem saida' : `exit ${rr.exit == null ? '?' : rr.exit}`)}
              </span>
              <span className="du">{rr.dur || ''}</span>
            </div>
          ))
        )}
      </div>
      <DrawerOutput run={run} outTab={outTab} setOutTab={setOutTab} />
    </aside>
  );
}

function DrawerOutput({ run, outTab, setOutTab }) {
  if (!run) {
    return <div className="dw-outwrap"><pre className="dw-pre dim">selecione uma run</pre></div>;
  }
  const raw = outTab === 'stderr' ? run.stderr : run.stdout;
  const has = typeof raw === 'string' && raw.trim().length > 0;
  const body = has
    ? raw
    : outTab === 'stderr'
      ? '(stderr vazio)'
      : `(sem saida capturada — exit ${run.exit == null ? 0 : run.exit})`;
  return (
    <div className="dw-outwrap">
      <div className="dw-outhead">
        <span className="ttl">saida · {run.t}</span>
        <span className="dw-tabs">
          <button className={'dw-tab' + (outTab === 'stdout' ? ' on' : '')} onClick={() => setOutTab('stdout')}>stdout</button>
          <button className={'dw-tab' + (outTab === 'stderr' ? ' on' : '')} onClick={() => setOutTab('stderr')}>stderr</button>
        </span>
      </div>
      <pre className={'dw-pre' + (has ? '' : ' dim')}>{body}</pre>
    </div>
  );
}

// ------------------------------------------------------------ helpers ----

function groupByHealth(jobs) {
  const attn = [];
  const ok = [];
  const off = [];
  for (const j of jobs) {
    const h = health(j);
    if (h === 'fail') attn.push(j);
    else if (h === 'off') off.push(j);
    else ok.push(j);
  }
  return { attn, ok, off };
}

function computeKpis(jobs) {
  let ok = 0;
  let fail = 0;
  let off = 0;
  const ups = [];
  for (const j of jobs) {
    const h = health(j);
    if (h === 'fail') fail += 1;
    else if (h === 'off') off += 1;
    else ok += 1;
    if (typeof j.uptime === 'number') ups.push(j.uptime);
  }
  const avgUp = ups.length
    ? Math.round(ups.reduce((a, b) => a + b, 0) / ups.length)
    : null;
  return { ok, fail, off, avgUp };
}

// Countdown ao vivo: se o job ao vivo tem proxima execucao HH:MM hoje, conta
// ate ela; caso contrario roda o ciclo de 5min do mockup (efeito "ao vivo").
// rAF para nao animar layout; pausa fora de foco e sob reduced-motion.
function useCountdown(jobs, liveName) {
  const [label, setLabel] = useState('--:--');
  const startRef = useRef(Date.now());

  // Alvo fixo em segundos quando a proxima execucao e parseavel; senao null.
  const targetSeconds = useMemo(() => {
    const job = jobs.find((j) => j && j.name === liveName);
    return job ? secondsUntilToday(job.next) : null;
  }, [jobs, liveName]);

  useEffect(() => {
    startRef.current = Date.now();
    if (typeof window === 'undefined') return undefined;
    const reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = null;
    let timer = null;

    function compute() {
      const elapsed = (Date.now() - startRef.current) / 1000;
      let s;
      if (targetSeconds !== null) {
        s = Math.max(0, Math.round(targetSeconds - elapsed));
      } else {
        s = Math.round(COUNTDOWN_CYCLE_S - elapsed);
        if (s < 0) s = ((s % COUNTDOWN_CYCLE_S) + COUNTDOWN_CYCLE_S) % COUNTDOWN_CYCLE_S;
      }
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      setLabel(`${mm}:${ss}`);
    }

    function tick() {
      compute();
      raf = requestAnimationFrame(tick);
    }

    compute();
    if (reduced) {
      // Sem rAF sob reduced-motion: atualiza a cada segundo via timer.
      timer = setInterval(compute, 1000);
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  }, [targetSeconds]);

  return label;
}
