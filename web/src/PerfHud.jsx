// FAROL - HUD de VITAIS sobre o grafo (canto sup-esq, abaixo dos crew
// chips). Reusa o mesmo useStats() da StatsBar (SSE /api/stats a cada 2s):
// CPU, RAM, disco E consumo de tokens ao vivo (hoje + ultima hora), sem
// fetch novo. Overlay leve; nao bloqueia a interacao do universo (o pai —
// torre-root / mb-graph — e position:relative).
import { useStats } from './StatsBar.jsx';
import { fmtTokens } from './roomData.js';
import './perfhud.css';

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const gb = (mb) => (Number(mb || 0) / 1024).toFixed(1);
const level = (v) => (v >= 90 ? 'crit' : v >= 70 ? 'warn' : 'ok');

function Bar({ k, v, label, title }) {
  return (
    <div className="perfhud-row" title={title}>
      <span className="perfhud-k">{k}</span>
      <span className="perfhud-bar">
        <span className={`perfhud-fill ${level(v)}`} style={{ transform: `scaleX(${v / 100})` }} />
      </span>
      <span className="perfhud-v">{label}</span>
    </div>
  );
}

export default function PerfHud() {
  const { stats } = useStats();
  if (!stats) return null;
  const cpu = clampPct(stats.cpuPct);
  const ramPct = stats.memTotalMb ? clampPct((stats.memUsedMb / stats.memTotalMb) * 100) : 0;
  const usage = stats.usage || null;
  const today = usage && usage.today ? usage.today.out : null;
  const hour = usage && usage.hour ? usage.hour.out : null;
  const flowing = Number(hour) > 0;
  return (
    <div className="perfhud" role="status" aria-label="Vitais da máquina e consumo de tokens">
      <Bar k="CPU" v={cpu} label={`${cpu}%`} title={`CPU ${cpu}%`} />
      <Bar k="RAM" v={ramPct} label={`${gb(stats.memUsedMb)}G`} title={`RAM ${gb(stats.memUsedMb)}/${gb(stats.memTotalMb)}G`} />
      <div
        className="perfhud-tok"
        title={`tokens gerados hoje ${today == null ? 's/ dados' : fmtTokens(today)} · última hora ${hour == null ? 's/ dados' : fmtTokens(hour)}`}
      >
        <span className="perfhud-k">
          <span className={`perfhud-pulse${flowing ? ' on' : ''}`} aria-hidden="true" />
          TOK
        </span>
        <span className="perfhud-tok-today">{today == null ? '--' : fmtTokens(today)}</span>
        <span className="perfhud-tok-hour">{hour == null ? '' : `1h ${fmtTokens(hour)}`}</span>
      </div>
      <div className="perfhud-foot">
        <span title="disco livre">hd {stats.diskFreeGb == null ? 'n/d' : `${Math.round(stats.diskFreeGb)}G`}</span>
        {stats.sessionsActive > 0 ? <span title="agentes ativos">· {stats.sessionsActive} ag</span> : null}
      </div>
    </div>
  );
}
