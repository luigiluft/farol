// FAROL - aba USO v2: rollup canonico do /api/usage com filtro de PERIODO
// (7/14/30/90d), barras por dia com METRICA selecionavel (in+out | cache
// read | cache create), breakdown do periodo por tipo, "AONDE vai o token"
// (topico inferido da missao — project e quase sempre 'home') e DICAS DE
// ECONOMIA derivadas dos proprios numeros. Poll 10s enquanto backfill anda.
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from './api.js';
import { useSessions, agentCounts } from './roomData.js';
import { useStats } from './StatsBar.jsx';
import { callsign } from './callsigns.js';
import { idColor, initials, fmtTok, fmtDur } from './cockpit-model.js';
import './uso.css';

const RANGES = [7, 14, 30, 90];
const POLL_BUSY_MS = 10 * 1000;
const POLL_IDLE_MS = 60 * 1000;
const MODEL_COLORS = {
  'claude-fable-5': '#3ddc84',
  'claude-opus-4-8': '#ffb454',
  'claude-sonnet-5': '#82aaff',
  'claude-haiku-4-5': '#c792ea',
};
const MODEL_FALLBACK = '#9575cd';
const TOPIC_COLORS = {
  loja: '#3ddc84', aurora: '#7cd992', blog: '#ffb454', zen: '#4dd0e1',
  app: '#c792ea', site: '#64b5f6', design: '#f48fb1',
  'setup-claude': '#ffd54f', pessoal: '#e57373', outros: '#67768a',
};
const METRICS = [
  { id: 'io', label: 'in+out' },
  { id: 'cacheRead', label: 'cache read' },
  { id: 'cacheCreate', label: 'cache create' },
];

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function shortModel(m) {
  return String(m || '').replace('claude-', '') || '?';
}

// Contagem regressiva legivel ate um instante (ms). Usado no KPI de reset.
function untilLabel(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'agora';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return d + 'd ' + h + 'h';
  const m = Math.floor((diff % 3600000) / 60000);
  return h + 'h ' + m + 'm';
}

function useUsage(days) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer = null;
    setData(null);
    const load = async () => {
      try {
        const d = await fetchJson('/api/usage?days=' + days);
        if (!alive) return;
        if (d && Array.isArray(d.days)) setData(d);
        timer = setTimeout(load, d && d.ready === false ? POLL_BUSY_MS : POLL_IDLE_MS);
      } catch {
        if (alive) timer = setTimeout(load, POLL_IDLE_MS);
      }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [days]);
  return data;
}

// ------------------------------------------------------------ derivacoes ----

function sumTotal(days) {
  return days.reduce((a, d) => a + (d.total || 0), 0);
}

// Serie continua do periodo; >31 dias agrupa por SEMANA (barras legiveis).
function barSeries(days, range) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = localDateStr(new Date());
  if (range <= 31) {
    const out = [];
    for (let i = range - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000);
      const key = localDateStr(d);
      // grafico full-width: cabe label em TODAS as barras ate 31 dias
      const full = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
      out.push({
        key,
        label: full,
        labelFull: full,
        recs: byDate.has(key) ? [byDate.get(key)] : [],
        isNow: key === today,
        dayKeys: [key],
      });
    }
    return out;
  }
  const weeks = Math.ceil(range / 7);
  const out = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = new Date(Date.now() - (w * 7 + 6) * 86400000);
    const recs = [];
    const dayKeys = [];
    for (let i = 6; i >= 0; i -= 1) {
      const key = localDateStr(new Date(Date.now() - (w * 7 + i) * 86400000));
      dayKeys.push(key);
      if (byDate.has(key)) recs.push(byDate.get(key));
    }
    const wl = 'sem ' + String(start.getDate()).padStart(2, '0') + '/' + String(start.getMonth() + 1).padStart(2, '0');
    out.push({
      key: 'w' + w,
      label: wl,
      labelFull: wl,
      recs,
      isNow: w === 0,
      dayKeys,
    });
  }
  return out;
}

// Valor da metrica escolhida num bucket (dia ou semana agregada).
function metricOf(recs, metric, byKey) {
  let total = 0;
  const by = {};
  for (const r of recs) {
    if (metric === 'io') {
      total += r.total || 0;
      const src = r[byKey] || {};
      for (const [k, v] of Object.entries(src)) by[k] = (by[k] || 0) + v;
    } else {
      total += r[metric] || 0;
    }
  }
  return { total, by };
}

// Dicas de economia derivadas dos numeros do periodo. Fundamento (pricing
// oficial): cache READ custa ~0.1x o input cru; cache WRITE ~1.25x. Ou seja:
// cache read alto NAO e desperdicio em si — e o desconto de 90% que viabiliza
// sessao longa. O que se otimiza e a BASE relida (contexto inchado) e a
// QUANTIDADE de releituras (numero de chamadas).
function buildTips(data, range) {
  const tips = [];
  const t = data.totals || {};
  const io = t.total || 0;
  const top = data.topSessions || [];

  if (t.cacheRead > 0) {
    tips.push({
      k: 'cache read é desconto, não desperdício',
      v: fmtTok(t.cacheRead) + ' lidos do cache custam o equivalente a ~' + fmtTok(t.cacheRead * 0.1)
        + ' tokens crus (leitura em cache ≈ 10% do preço de input). Sem cache, ESTE mesmo contexto teria custado 10×. O que você controla é o tamanho da base relida — não o mecanismo.',
    });
    tips.push({
      k: 'por que ele cresce tanto',
      v: 'cada chamada de tool relê o contexto INTEIRO da sessão via cache. Sessão longa com contexto inchado × centenas de chamadas = bilhões. Reduz: encerrar e retomar com resumo (/encerrar-sessao), /compact, não colar dumps gigantes no chat, e mandar exploração pesada pra subagentes (o lixo que eles leem não entra no teu contexto).',
    });
  }

  const cacheTop = top.slice().sort((a, b) => (b.cacheRead || 0) - (a.cacheRead || 0)).slice(0, 3)
    .filter((s) => (s.cacheRead || 0) > 0);
  if (cacheTop.length) {
    tips.push({
      k: 'quem mais relê contexto',
      v: cacheTop.map((s) => callsign(s.id) + ' ' + fmtTok(s.cacheRead)).join(' · ')
        + ' — são as sessões onde encurtar/compactar rende mais.',
    });
  }

  const marathons = top.filter((s) => s.durMs > 12 * 3600 * 1000);
  if (marathons.length) {
    tips.push({
      k: marathons.length + ' sessão(ões) acima de 12h',
      v: 'a base relida cresce a cada turno; a partir de certo ponto cada chamada paga o contexto acumulado inteiro. Encerrar e retomar com resumo zera a base.',
    });
  }

  if (top.length >= 3 && io > 0) {
    const top3 = top.slice(0, 3).reduce((a, s) => a + s.total, 0);
    const pct = Math.round((top3 / io) * 100);
    if (pct >= 25) {
      tips.push({
        k: 'top 3 sessões = ' + pct + '% do in+out',
        v: top.slice(0, 3).map((s) => callsign(s.id)).join(', ') + ' — o gasto é concentrado: otimizar essas vale mais que qualquer ajuste fino.',
      });
    }
  }

  const opusTotal = top.filter((s) => String(s.model || '').includes('opus')).reduce((a, s) => a + s.total, 0);
  if (io > 0 && opusTotal / io > 0.7) {
    tips.push({
      k: 'Opus domina o período',
      v: 'rotinas e tarefas mecânicas em Haiku/Sonnet entregam igual por fração dos tokens — rotear o trivial pra baixo preserva cota pro que importa.',
    });
  }

  if (!tips.length) {
    tips.push({ k: 'sem alertas no período', v: 'distribuição de gasto sem concentração anômala nos últimos ' + range + ' dias.' });
  }
  return tips;
}

// --------------------------------------------------------------- blocos ----

// ----------------------------------------------------------------- ao vivo --

const BURN_SAMPLES = 24; // ~48s de janela (SSE de stats chega a cada 2s)

// Acumula o delta de tokens gerados HOJE por tick do SSE de stats -> serie de
// "quanto queimou em cada 2s". Guard de virada de dia (out < prev => reset).
function useBurn() {
  const { stats } = useStats();
  const [series, setSeries] = useState([]);
  const prev = useRef(null);
  useEffect(() => {
    const out = stats && stats.usage && stats.usage.today ? stats.usage.today.out : null;
    if (out == null) return;
    if (prev.current != null && out >= prev.current) {
      const delta = out - prev.current;
      setSeries((s) => [...s, delta].slice(-BURN_SAMPLES));
    }
    prev.current = out;
  }, [stats]);
  return { stats, series };
}

// Sparkline puro: serie -> pontos de uma polyline num viewBox fixo.
function sparkPoints(series, w, h) {
  const max = Math.max(...series, 1);
  const n = series.length;
  return series.map((v, i) => {
    const x = n <= 1 ? w : (i / (n - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}

// tok/min a partir da janela amostrada (cada amostra = sampleMs).
function burnRatePerMin(series, sampleMs) {
  const winSec = (series.length * sampleMs) / 1000;
  if (winSec <= 0) return 0;
  return Math.round((series.reduce((a, b) => a + b, 0) / winSec) * 60);
}

function Spark({ series }) {
  if (!series.length) return <div className="uso-spark uso-spark-empty">coletando…</div>;
  return (
    <svg className="uso-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={sparkPoints(series, 120, 26)} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LiveStrip() {
  const { stats, series } = useBurn();
  const { sessions } = useSessions();
  const { working, waiting } = agentCounts(sessions);
  const usage = stats && stats.usage ? stats.usage : null;
  const hour = usage && usage.hour ? usage.hour.out : null;
  const today = usage && usage.today ? usage.today.out : null;
  const rate = burnRatePerMin(series, 2000);
  return (
    <div className="uso-card uso-live">
      <div className="uso-live-head">
        <span className="uso-live-pulse" aria-hidden="true" />
        ao vivo
        <span className="uso-live-sub">
          {working} trabalhando{waiting ? ' · ' + waiting + ' esperando' : ''}
        </span>
      </div>
      <div className="uso-live-grid">
        <div className="uso-live-spark">
          <Spark series={series} />
          <span className="uso-live-sparklbl">saída/2s</span>
        </div>
        <div className="uso-live-stat"><b>{rate ? fmtTok(rate) : '--'}</b><span>tok/min agora</span></div>
        <div className="uso-live-stat"><b>{hour != null ? fmtTok(hour) : '--'}</b><span>gerados 1h</span></div>
        <div className="uso-live-stat"><b>{today != null ? fmtTok(today) : '--'}</b><span>gerados hoje</span></div>
      </div>
    </div>
  );
}

function Kpis({ data, range }) {
  const days = data.days;
  const today = localDateStr(new Date());
  const hoje = sumTotal(days.filter((d) => d.date === today));
  const t = data.totals || {};
  const media = days.length > 1
    ? Math.round((t.total - hoje) / Math.max(1, days.length - (hoje > 0 ? 1 : 0)))
    : null;
  const wk = data.limits && data.limits.weekly;
  const wkCycleTok = wk && wk.cycleStart ? sumTotal(days.filter((d) => d.date >= wk.cycleStart)) : 0;
  return (
    <div className="uso-kpis">
      <div className="uso-kpi">
        <div className="uso-k">hoje</div>
        <div className="uso-v">{fmtTok(hoje)} <small>in+out</small></div>
      </div>
      <div className="uso-kpi">
        <div className="uso-k">período ({range}d)</div>
        <div className="uso-v">{fmtTok(t.total)} <small>in+out</small></div>
        {media !== null && <div className="uso-s">média <b>{fmtTok(media)}</b>/dia ativo</div>}
      </div>
      <div className="uso-kpi">
        <div className="uso-k">cache read ({range}d)</div>
        <div className="uso-v">{fmtTok(t.cacheRead)}</div>
        <div className="uso-s">{t.total > 0 ? Math.round(t.cacheRead / t.total) + '× o in+out' : ''}</div>
      </div>
      <div className="uso-kpi">
        <div className="uso-k">sessões no período</div>
        <div className="uso-v">{data.sessionCount || 0}</div>
        {data.topSessions && data.topSessions[0] && (
          <div className="uso-s">mais pesada: {callsign(data.topSessions[0].id)} · {fmtTok(data.topSessions[0].total)}</div>
        )}
      </div>
      <div className="uso-kpi uso-kpi-reset">
        <div className="uso-k">reset semanal</div>
        {wk && wk.next ? (
          <>
            <div className="uso-v">{untilLabel(wk.next)} <small>p/ zerar</small></div>
            <div className="uso-s">ciclo atual: <b>{fmtTok(wkCycleTok)}</b> in+out</div>
          </>
        ) : (
          <>
            <div className="uso-v uso-v-cfg">configurar</div>
            <div className="uso-s">âncora em .data/limits.json · veja /usage</div>
          </>
        )}
      </div>
    </div>
  );
}

const STACKS = [
  { id: 'byModel', label: 'modelo' },
  { id: 'byTopic', label: 'projeto' },
];

function stackColor(key, stackBy) {
  if (stackBy === 'byTopic') return TOPIC_COLORS[key] || '#9575cd';
  return MODEL_COLORS[key] || MODEL_FALLBACK;
}

function stackLabel(key, stackBy) {
  return stackBy === 'byTopic' ? key : shortModel(key);
}

// Grafico principal: barras empilhadas por MODELO ou PROJETO (topico), com
// tooltip rico por dia (breakdown completo no hover, ancorado na barra).
function Bars({ days, range, metric, onMetric, stackBy, onStackBy, resets }) {
  const [tip, setTip] = useState(null);
  const series = barSeries(days, range);
  const resetSet = new Set(resets || []);
  const vals = series.map((b) => metricOf(b.recs, metric, stackBy));
  const max = Math.max(...vals.map((v) => v.total), 1);
  const keys = new Set();
  if (metric === 'io') {
    for (const v of vals) Object.keys(v.by).forEach((k) => keys.add(k));
  }

  const hover = (i) => {
    const v = vals[i];
    if (!v || v.total <= 0) { setTip(null); return; }
    const rows = Object.entries(v.by)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, val]) => ({ k, val, color: stackColor(k, stackBy), pct: Math.round((val / v.total) * 100) }));
    setTip({ i, label: series[i].labelFull || series[i].label, total: v.total, rows });
  };

  return (
    <div className="uso-card">
      <div className="uso-ch">
        tokens por dia
        <span className="uso-seg">
          {METRICS.map((m) => (
            <button key={m.id} type="button" className={metric === m.id ? 'on' : ''} onClick={() => onMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </span>
        {metric === 'io' && (
          <span className="uso-seg">
            {STACKS.map((s) => (
              <button key={s.id} type="button" className={stackBy === s.id ? 'on' : ''} onClick={() => onStackBy(s.id)}>
                {s.label}
              </button>
            ))}
          </span>
        )}
        {metric === 'io' && (
          <small>
            {[...keys].slice(0, 6).map((k) => (
              <span key={k} className="uso-lg">
                <i style={{ background: stackColor(k, stackBy) }} />
                {stackLabel(k, stackBy)}
              </span>
            ))}
          </small>
        )}
      </div>
      <div className="uso-bars uso-bars-hero" onMouseLeave={() => setTip(null)}>
        {tip && (
          <div
            className="uso-tt"
            style={{
              left: ((tip.i + 0.5) / series.length) * 100 + '%',
              transform: 'translateX(' + (tip.i < 2 ? '-20%' : tip.i > series.length - 3 ? '-80%' : '-50%') + ')',
            }}
          >
            <div className="uso-tt-h">{tip.label} — <b>{fmtTok(tip.total)}</b> in+out</div>
            {tip.rows.map((r) => (
              <div key={r.k} className="uso-tt-r">
                <i style={{ background: r.color }} />
                <span className="uso-tt-k">{stackLabel(r.k, stackBy)}</span>
                <span className="uso-tt-v">{fmtTok(r.val)} · {r.pct}%</span>
              </div>
            ))}
          </div>
        )}
        {series.map((b, i) => (
          <div
            key={b.key}
            className={'uso-bar' + (b.isNow ? ' today' : '') + (tip && tip.i === i ? ' hover' : '')}
            onMouseEnter={() => hover(i)}
          >
            <div className="uso-bv">{vals[i].total > 0 ? fmtTok(vals[i].total) : ''}</div>
            <div className="uso-stack">
              {metric === 'io' && Object.keys(vals[i].by).length ? (
                Object.entries(vals[i].by).map(([k, v]) => (
                  <div
                    key={k}
                    className="uso-seg-blk"
                    style={{ height: Math.max(2, (v / max) * 208) + 'px', background: stackColor(k, stackBy) }}
                  />
                ))
              ) : vals[i].total > 0 ? (
                <div className="uso-seg-blk" style={{ height: Math.max(2, (vals[i].total / max) * 208) + 'px', background: '#67768a' }} />
              ) : (
                <div className="uso-seg-blk uso-seg-empty" />
              )}
            </div>
            <div className="uso-bl">{b.label}</div>
          </div>
        ))}
        {resetSet.size > 0 && series.map((b, i) => (
          b.dayKeys && b.dayKeys.some((k) => resetSet.has(k)) ? (
            <div
              key={'reset-' + b.key}
              className="uso-reset"
              style={{ left: ((i + 0.5) / series.length) * 100 + '%' }}
              title="reset semanal do limite (crédito zera aqui)"
            >
              <span className="uso-reset-tag">↻ reset</span>
            </div>
          ) : null
        ))}
      </div>
    </div>
  );
}

function SplitPeriod({ data, range }) {
  const t = data.totals || {};
  const rows = [
    ['input', t.in, '#82aaff'],
    ['output', t.out, '#3ddc84'],
    ['cache read', t.cacheRead, '#67768a'],
    ['cache create', t.cacheCreate, '#9aa7b8'],
  ];
  const max = Math.max(...rows.map((r) => Number(r[1]) || 0), 1);
  return (
    <div className="uso-card">
      <div className="uso-ch">período por tipo ({range}d)</div>
      <div className="uso-split">
        {rows.map(([label, v, color]) => (
          <div key={label} className="uso-row">
            <span className="uso-lbl">{label}</span>
            <span className="uso-trk">
              <span className="uso-fill" style={{ width: Math.max(1, ((Number(v) || 0) / max) * 100) + '%', background: color }} />
            </span>
            <span className="uso-val">{fmtTok(v)}</span>
          </div>
        ))}
      </div>
      <div className="uso-note">in+out = o que você "fala e ouve"; cache read = contexto relido a cada chamada (cresce com sessão longa); cache create = contexto novo entrando.</div>
    </div>
  );
}

function Topics({ data, range, topicSel, onTopic }) {
  const entries = Object.entries(data.topics || {}).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const total = (data.totals && data.totals.total) || 1;
  return (
    <div className="uso-card">
      <div className="uso-ch">
        aonde vai o token ({range}d)
        <small>tópico inferido da missão · clique filtra a tabela</small>
      </div>
      <div className="uso-split">
        {entries.map(([topic, v]) => (
          <button
            key={topic}
            type="button"
            className={'uso-row uso-topic' + (topicSel === topic ? ' on' : '')}
            onClick={() => onTopic(topicSel === topic ? null : topic)}
          >
            <span className="uso-lbl">{topic}</span>
            <span className="uso-trk">
              <span className="uso-fill" style={{ width: Math.max(1, (v / max) * 100) + '%', background: TOPIC_COLORS[topic] || '#9575cd' }} />
            </span>
            <span className="uso-val">{fmtTok(v)} · {Math.round((v / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Tips({ data, range }) {
  const tips = buildTips(data, range);
  return (
    <div className="uso-card">
      <div className="uso-ch">dicas de economia</div>
      <div className="uso-tips">
        {tips.map((t) => (
          <div key={t.k} className="uso-tip">
            <div className="uso-tip-k">{t.k}</div>
            <div className="uso-tip-v">{t.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopSessions({ top, liveIds, onAgent, topicSel }) {
  const rows = topicSel ? top.filter((s) => s.topic === topicSel) : top;
  return (
    <div className="uso-card uso-table-card">
      <div className="uso-ch">
        top sessões por tokens{topicSel ? ' — ' + topicSel : ''}
        <small>sessão viva: clique abre o dossiê</small>
      </div>
      <table className="uso-table">
        <thead>
          <tr>
            <th>sessão</th><th>tópico</th><th>missão</th><th>modelo</th>
            <th className="num">in</th><th className="num">out</th>
            <th className="num">total</th><th className="num">cache read</th>
            <th className="num">duração</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const live = liveIds.has(s.id);
            return (
              <tr
                key={s.id}
                className={live ? 'live' : ''}
                onClick={live && onAgent ? () => onAgent(s.id) : undefined}
              >
                <td>
                  <span className="uso-who" style={{ '--idc': idColor(s.id) }}>
                    <span className="uso-av">{initials(callsign(s.id))}</span>
                    <span className="uso-cs">{callsign(s.id)}</span>
                    {live && <span className="uso-live-dot" title="sessao viva" />}
                  </span>
                </td>
                <td><span className="uso-tp" style={{ color: TOPIC_COLORS[s.topic] || '#9575cd' }}>{s.topic}</span></td>
                <td><div className="uso-mi">{s.firstPrompt || '—'}</div></td>
                <td className="uso-mo">{shortModel(s.model)}</td>
                <td className="num">{fmtTok(s.in)}</td>
                <td className="num">{fmtTok(s.out)}</td>
                <td className="num"><b>{fmtTok(s.total)}</b></td>
                <td className="num">{fmtTok(s.cacheRead)}</td>
                <td className="num">{fmtDur(s.durMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Uso({ onAgent }) {
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState('io');
  // default por PROJETO: "uso por projeto por dia" e a pergunta principal
  const [stackBy, setStackBy] = useState('byTopic');
  const [topicSel, setTopicSel] = useState(null);
  const data = useUsage(range);
  const { sessions } = useSessions();
  const liveIds = new Set((Array.isArray(sessions) ? sessions : []).map((s) => s && s.id).filter(Boolean));

  return (
    <div className="uso">
      <div className="uso-head">
        <span className="uso-title">USO DE TOKENS</span>
        <span className="uso-seg">
          {RANGES.map((r) => (
            <button key={r} type="button" className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r}d
            </button>
          ))}
        </span>
        {data && data.ready === false && (
          <span className="uso-busy-inline">indexando — {data.pendingFiles} arquivos restantes</span>
        )}
      </div>
      <LiveStrip />
      {!data ? (
        <div className="uso-note mono">carregando uso...</div>
      ) : (
        <>
          <Kpis data={data} range={range} />
          <Bars
            days={data.days}
            range={range}
            metric={metric}
            onMetric={setMetric}
            stackBy={stackBy}
            onStackBy={setStackBy}
            resets={data.limits && data.limits.weekly ? data.limits.weekly.resets : null}
          />
          <div className="uso-grid-3">
            <SplitPeriod data={data} range={range} />
            <Topics data={data} range={range} topicSel={topicSel} onTopic={setTopicSel} />
            <Tips data={data} range={range} />
          </div>
          <TopSessions top={data.topSessions || []} liveIds={liveIds} onAgent={onAgent} topicSel={topicSel} />
        </>
      )}
    </div>
  );
}
