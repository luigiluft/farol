// FAROL - Agenda.jsx (W-AGENDA, F7).
// Pagina Agenda: calendario mensal navegavel (grade seg-dom, dots por tipo,
// hoje com anel accent, setas esq/dir movem o dia selecionado) + painel de
// detalhe do dia (timeline de eventos com linha 'agora', tarefas read-only,
// sessoes, github, nota, botao abrir daily).
// Dados: GET /api/agenda?from&to por mes visivel (contrato C3.3 do W-SERVER).
// Parse 100% defensivo: payload sem campos NUNCA quebra a view.
// Props: { onOpenNote: (path) => void }.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Unlock from './Unlock.jsx';
import './agenda.css';

const GRID_CELLS = 42; // 6 semanas fixas: altura estavel entre meses
const NOW_TICK_MS = 60000;
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const WEEKDAYS_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const WEEKDAYS_LONG = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

// ------------------------------------------------------------ datas

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 'YYYY-MM-DD' -> Date local (sem armadilha de timezone do Date.parse).
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function monthOf(iso) {
  const d = parseIso(iso);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function sameMonth(a, b) {
  return a.y === b.y && a.m === b.m;
}

function addMonths(month, delta) {
  const d = new Date(month.y, month.m - 1 + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function monthRange(month) {
  const last = new Date(month.y, month.m, 0).getDate();
  return {
    from: `${month.y}-${pad2(month.m)}-01`,
    to: `${month.y}-${pad2(month.m)}-${pad2(last)}`,
  };
}

// 42 celulas seg-dom cobrindo o mes + bordas dos vizinhos.
function monthCells(month) {
  const first = new Date(month.y, month.m - 1, 1);
  // segunda = 0; quando o mes comeca na segunda (lead 0) prepende a
  // semana anterior: ghosts emolduram em cima em vez de sobrar uma
  // semana inteira do mes seguinte no rodape.
  const lead = ((first.getDay() + 6) % 7) || 7;
  return Array.from({ length: GRID_CELLS }, (_, i) => {
    const d = new Date(month.y, month.m - 1, 1 - lead + i);
    return { iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month.m - 1 };
  });
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtMin(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// ------------------------------------------- normalizacao defensiva (C3.3)

function cleanStr(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return max && s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normList(value, fn) {
  return Array.isArray(value) ? value.map(fn).filter(Boolean) : [];
}

function normEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanStr(raw.title, 140);
  const start = cleanStr(raw.start, 11);
  if (!title && !start) return null;
  return {
    start: start || null,
    end: cleanStr(raw.end, 11) || null,
    title: title || '(sem título)',
  };
}

function normTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = cleanStr(raw.text, 160);
  if (!text) return null;
  return { done: raw.done === true, text };
}

function normSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanStr(raw.title, 140);
  if (!title) return null;
  return { time: cleanStr(raw.time, 5) || null, title };
}

function normGit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = cleanStr(raw.text, 120);
  if (!text) return null;
  return { time: cleanStr(raw.time, 5) || null, text };
}

function normalizeDay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || ''))) return null;
  return {
    date: raw.date,
    path: typeof raw.path === 'string' && raw.path ? raw.path : null,
    exists: raw.exists === true,
    events: normList(raw.events, normEvent),
    tasks: normList(raw.tasks, normTask),
    sessions: normList(raw.sessions, normSession),
    github: normList(raw.github, normGit),
    note: cleanStr(raw.note, 600) || null, // corte visual fino e o line-clamp do CSS
  };
}

function buildDayMap(data) {
  const map = new Map();
  const days = data && Array.isArray(data.days) ? data.days : [];
  for (const raw of days) {
    const day = normalizeDay(raw);
    if (day) map.set(day.date, day);
  }
  return map;
}

function dayCounts(day) {
  if (!day) return { events: 0, sessions: 0, github: 0, total: 0 };
  const events = day.events.length;
  const sessions = day.sessions.length;
  const github = day.github.length;
  return { events, sessions, github, total: events + sessions + github };
}

// ----------------------------------------------------------------- hooks

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// Estado de navegacao: mes visivel + dia selecionado (sincronizados).
function useAgendaNav(todayIso) {
  const [month, setMonth] = useState(() => monthOf(todayIso));
  const [selected, setSelected] = useState(todayIso);

  const selectDay = useCallback((iso) => {
    setSelected(iso);
    const m = monthOf(iso);
    setMonth((prev) => (sameMonth(prev, m) ? prev : m));
  }, []);

  const stepMonth = useCallback((delta) => {
    setMonth((prev) => addMonths(prev, delta));
  }, []);

  const shiftDay = useCallback((delta) => {
    const d = parseIso(selected);
    d.setDate(d.getDate() + delta);
    selectDay(isoOf(d));
  }, [selected, selectDay]);

  const goToday = useCallback(() => selectDay(isoOf(new Date())), [selectDay]);

  return { month, selected, selectDay, stepMonth, shiftDay, goToday };
}

// Setas esq/dir movem o dia (listener vive so enquanto a view esta montada).
function useArrowNav(shiftDay) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      shiftDay(e.key === 'ArrowLeft' ? -1 : 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shiftDay]);
}

// Re-render por minuto para a linha 'agora' (so quando hoje esta em foco).
function useNowTick(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
}

// ----------------------------------------------------------- icones (mono)

function IcoChevron({ dir }) {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d={dir === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  );
}

function IcoClock() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.4V8l1.8 1.5" />
    </svg>
  );
}

function IcoCheck() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function IcoBox({ checked }) {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      {checked ? <path d="m5.4 8.2 1.9 1.9 3.5-4.2" /> : null}
    </svg>
  );
}

function IcoTerm() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 5 3 3-3 3" />
      <path d="M8.5 11.5H13" />
    </svg>
  );
}

function IcoBranch() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="4" r="1.7" />
      <circle cx="4.5" cy="12" r="1.7" />
      <circle cx="11.5" cy="5.5" r="1.7" />
      <path d="M4.5 5.7v4.6M11.5 7.2c0 2.4-4 2.2-6 3.4" />
    </svg>
  );
}

function IcoNote() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h5.5L13 6v7.5H4z" />
      <path d="M9.5 2.5V6H13" />
    </svg>
  );
}

function IcoOpen() {
  return (
    <svg className="ag-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 9.5 12 4" />
      <path d="M7.5 4H12v4.5" />
    </svg>
  );
}

// ------------------------------------------------------------- calendario

function CalHeader({ month, onPrev, onNext, onToday }) {
  return (
    <header className="agenda-cal-head">
      <h2 className="agenda-cal-title">
        {MONTHS[month.m - 1]} <span className="agenda-cal-year mono">{month.y}</span>
      </h2>
      <div className="agenda-cal-nav">
        <button type="button" className="agenda-nav-btn mono" onClick={onToday}>
          hoje
        </button>
        <button type="button" className="agenda-nav-btn" onClick={onPrev} aria-label="Mês anterior">
          <IcoChevron dir="left" />
        </button>
        <button type="button" className="agenda-nav-btn" onClick={onNext} aria-label="Próximo mês">
          <IcoChevron dir="right" />
        </button>
      </div>
    </header>
  );
}

function WeekdayRow() {
  return (
    <div className="agenda-weekdays" aria-hidden="true">
      {WEEKDAYS_SHORT.map((wd) => (
        <span key={wd} className="agenda-weekday mono">{wd}</span>
      ))}
    </div>
  );
}

function cellLabel(cell, counts) {
  const d = parseIso(cell.iso);
  const base = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  if (counts.total === 0) return base;
  return `${base}, ${counts.total} ${counts.total === 1 ? 'registro' : 'registros'}`;
}

function DayCell({ cell, day, isSelected, isToday, onSelect }) {
  const counts = dayCounts(day);
  const firstEv = day && day.events.length > 0 ? day.events[0].title : null;
  const cls = ['agenda-cell'];
  if (!cell.inMonth) cls.push('agenda-cell-out');
  if (isSelected) cls.push('agenda-cell-selected');
  if (isToday) cls.push('agenda-cell-today');
  return (
    <button
      type="button"
      className={cls.join(' ')}
      onClick={() => onSelect(cell.iso)}
      aria-pressed={isSelected}
      aria-label={cellLabel(cell, counts)}
    >
      <span className="agenda-cell-num mono">{cell.day}</span>
      {counts.total > 0 && <span className="agenda-cell-badge mono">{counts.total}</span>}
      {firstEv && <span className="agenda-cell-ev">{firstEv}</span>}
      <span className="agenda-cell-dots" aria-hidden="true">
        {counts.events > 0 && <span className="agenda-dot agenda-dot-event" />}
        {counts.sessions > 0 && <span className="agenda-dot agenda-dot-session" />}
        {counts.github > 0 && <span className="agenda-dot agenda-dot-github" />}
      </span>
    </button>
  );
}

// Mini-legenda dos 3 dots semanticos no rodape do calendario.
function DotLegend() {
  return (
    <footer className="agenda-legend">
      <span className="agenda-legend-item mono">
        <span className="agenda-dot agenda-dot-event" aria-hidden="true" />
        eventos
      </span>
      <span className="agenda-legend-item mono">
        <span className="agenda-dot agenda-dot-session" aria-hidden="true" />
        sessões
      </span>
      <span className="agenda-legend-item mono">
        <span className="agenda-dot agenda-dot-github" aria-hidden="true" />
        github
      </span>
    </footer>
  );
}

function CalGrid({ cells, dayMap, selected, todayIso, onSelect }) {
  return (
    <div className="agenda-grid">
      {cells.map((cell) => (
        <DayCell
          key={cell.iso}
          cell={cell}
          day={cell.inMonth ? dayMap.get(cell.iso) || null : null}
          isSelected={cell.iso === selected}
          isToday={cell.iso === todayIso}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// --------------------------------------------------------- detalhe do dia

function Section({ icon, label, meta, grow, children }) {
  return (
    <section className={grow ? 'ag-section ag-section-grow' : 'ag-section'}>
      <header className="ag-section-head">
        {icon}
        <span className="ag-section-label mono">{label}</span>
        {meta ? <span className="ag-section-meta mono">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

// A regua proporcional so entra quando ha evento com horario parseavel.
function hasTimedEvents(events) {
  return events.some((ev) => toMinutes(ev.start) !== null);
}

function sortEvents(events) {
  return [...events].sort(
    (a, b) => (toMinutes(a.start) ?? 1441) - (toMinutes(b.start) ?? 1441),
  );
}

// Evento overnight (end < start, ex. 22:00-00:30) cruza a meia-noite:
// soma 1440 ao end antes de comparar, senao vira "passado" indevido.
function isPastEvent(ev, nowMin) {
  const start = toMinutes(ev.start);
  let end = toMinutes(ev.end);
  if (end === null) end = start;
  if (end === null) return false;
  if (start !== null && end < start) end += 1440;
  return end < nowMin;
}

function EventRow({ ev, isPast }) {
  const range = ev.start ? (ev.end ? `${ev.start}-${ev.end}` : ev.start) : '--:--';
  return (
    <li className={isPast ? 'ag-ev ag-ev-past' : 'ag-ev'}>
      <span className="ag-ev-time mono">{range}</span>
      <span className="ag-ev-node" aria-hidden="true" />
      <span className="ag-ev-title">{ev.title}</span>
    </li>
  );
}

function NowRow({ nowMin }) {
  return (
    <li className="ag-now" aria-label={`agora, ${fmtMin(nowMin)}`}>
      <span className="ag-ev-time ag-now-time mono">{fmtMin(nowMin)}</span>
      <span className="ag-now-node" aria-hidden="true" />
      <span className="ag-now-rule" aria-hidden="true" />
      <span className="ag-now-label mono">agora</span>
    </li>
  );
}

// Fallback empilhado: dia sem evento com horario parseavel.
function StackedTimeline({ events, isToday, nowMin }) {
  const rows = [];
  let nowPlaced = !isToday;
  events.forEach((ev, i) => {
    const startMin = toMinutes(ev.start);
    if (!nowPlaced && startMin !== null && startMin > nowMin) {
      rows.push(<NowRow key="now" nowMin={nowMin} />);
      nowPlaced = true;
    }
    rows.push(
      <EventRow key={`ev-${i}`} ev={ev} isPast={isToday && isPastEvent(ev, nowMin)} />,
    );
  });
  if (!nowPlaced) rows.push(<NowRow key="now" nowMin={nowMin} />);
  return (
    <ol className="ag-tl">
      {rows}
      {events.length === 0 && <li className="ag-tl-empty mono">sem eventos hoje</li>}
    </ol>
  );
}

// ------------------------------------------- timeline proporcional por hora

const DAY_END_MIN = 24 * 60;
const RULER_MIN_LO = 8 * 60; // janela minima da regua: 08h
const RULER_MIN_HI = 20 * 60; // janela minima da regua: 20h
const RULER_PX_PER_HOUR = 36; // altura alvo de 1h (so o min-height; resto e %)
const RULER_MIN_HEIGHT = 260;
const RULER_MAX_HEIGHT = 560;
const RULER_TICK_TARGET = 8; // ~quantos ticks de hora na regua

// Janela [start,end] em minutos do evento na regua; null se sem horario.
// Overnight clampa na meia-noite: a regua nao vira o dia.
function evRange(ev) {
  const start = toMinutes(ev.start);
  if (start === null) return null;
  let end = toMinutes(ev.end);
  if (end === null || end === start) end = start + 30;
  if (end < start) end = DAY_END_MIN;
  return { start, end: Math.min(end, DAY_END_MIN) };
}

// Limites da regua: eventos + agora (se hoje), arredondados na hora.
function rulerBounds(timed, isToday, nowMin) {
  let lo = RULER_MIN_LO;
  let hi = RULER_MIN_HI;
  for (const t of timed) {
    if (t.range.start < lo) lo = t.range.start;
    if (t.range.end > hi) hi = t.range.end;
  }
  if (isToday) {
    if (nowMin < lo) lo = nowMin;
    if (nowMin > hi) hi = nowMin;
  }
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(Math.ceil(hi / 60) * 60, DAY_END_MIN);
  if (hi - lo < 60) hi = Math.min(lo + 60, DAY_END_MIN);
  return { lo, hi };
}

function HourTicks({ lo, hi }) {
  const span = hi - lo;
  const step = Math.max(1, Math.ceil(span / 60 / RULER_TICK_TARGET));
  const ticks = [];
  for (let h = lo / 60; h <= hi / 60; h += step) ticks.push(h);
  return ticks.map((h) => (
    <li
      key={`tick-${h}`}
      className="ag-tick"
      style={{ top: `${(((h * 60) - lo) / span) * 100}%` }}
      aria-hidden="true"
    >
      <span className="ag-tick-label mono">{`${pad2(h)}h`}</span>
      <span className="ag-tick-rule" />
    </li>
  ));
}

// Layout de sobreposicao: eventos que se sobrepoem no tempo viram colunas
// lado a lado em vez de empilhar full-width e colidir o texto. Greedy: cada
// evento entra na 1a coluna cujo ultimo evento ja terminou; senao abre coluna
// nova. Cluster = cadeia de eventos que se sobrepoem transitivamente — todos
// dividem a largura igualmente. Retorna { col, cols } alinhado a `timed`.
function layoutOverlaps(timed) {
  const out = new Array(timed.length);
  const order = timed
    .map((t, i) => ({ i, start: t.range.start, end: t.range.end, col: 0 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    for (const e of cluster) {
      let c = 0;
      while (c < colEnds.length && e.start < colEnds[c]) c += 1;
      e.col = c;
      colEnds[c] = e.end;
    }
    const cols = colEnds.length;
    for (const e of cluster) out[e.i] = { col: e.col, cols };
    cluster = [];
    clusterEnd = -1;
  };
  for (const e of order) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    if (e.end > clusterEnd) clusterEnd = e.end;
  }
  flush();
  return out;
}

function HourEvent({ ev, range, lo, span, isPast, col = 0, cols = 1 }) {
  const label = ev.start ? (ev.end ? `${ev.start}-${ev.end}` : ev.start) : '--:--';
  const style = {
    top: `${((range.start - lo) / span) * 100}%`,
    height: `${((range.end - range.start) / span) * 100}%`,
  };
  // Coluna lado a lado quando ha sobreposicao (gutter de 52px a esquerda,
  // 2px a direita = 54px reservados; divide o resto entre as colunas).
  if (cols > 1) {
    style.left = `calc(52px + (100% - 54px) * ${col} / ${cols})`;
    style.width = `calc((100% - 54px) / ${cols} - 3px)`;
    style.right = 'auto';
  }
  return (
    <li className={isPast ? 'ag-hev ag-hev-past' : 'ag-hev'} style={style}>
      <span className="ag-hev-time mono">{label}</span>
      <span className="ag-hev-title">{ev.title}</span>
    </li>
  );
}

function HourNow({ lo, span, nowMin }) {
  return (
    <li
      className="ag-hnow"
      style={{ top: `${((nowMin - lo) / span) * 100}%` }}
      aria-label={`agora, ${fmtMin(nowMin)}`}
    >
      <span className="ag-hnow-time mono">{fmtMin(nowMin)}</span>
      <span className="ag-now-node" aria-hidden="true" />
      <span className="ag-now-rule" aria-hidden="true" />
      <span className="ag-now-label mono">agora</span>
    </li>
  );
}

function HourTimeline({ timed, untimed, isToday, nowMin }) {
  const { lo, hi } = rulerBounds(timed, isToday, nowMin);
  const span = hi - lo;
  const layout = layoutOverlaps(timed);
  const minHeight = Math.max(
    RULER_MIN_HEIGHT,
    Math.min(RULER_MAX_HEIGHT, (span / 60) * RULER_PX_PER_HOUR),
  );
  return (
    <div className="ag-tl-wrap">
      <ol className="ag-hours" style={{ minHeight: `${minHeight}px` }}>
        <HourTicks lo={lo} hi={hi} />
        {timed.map((t, i) => (
          <HourEvent
            key={`hev-${i}`}
            ev={t.ev}
            range={t.range}
            lo={lo}
            span={span}
            col={layout[i] ? layout[i].col : 0}
            cols={layout[i] ? layout[i].cols : 1}
            isPast={isToday && isPastEvent(t.ev, nowMin)}
          />
        ))}
        {isToday && <HourNow lo={lo} span={span} nowMin={nowMin} />}
      </ol>
      {untimed.length > 0 && (
        <ul className="ag-tl-untimed">
          {untimed.map((ev, i) => (
            <EventRow key={`un-${i}`} ev={ev} isPast={false} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Dia com evento com horario -> regua proporcional; senao fallback empilhado.
function Timeline({ events, isToday, nowMin }) {
  const sorted = sortEvents(events);
  const timed = [];
  const untimed = [];
  for (const ev of sorted) {
    const range = evRange(ev);
    if (range) timed.push({ ev, range });
    else untimed.push(ev);
  }
  if (timed.length === 0) {
    return <StackedTimeline events={sorted} isToday={isToday} nowMin={nowMin} />;
  }
  return <HourTimeline timed={timed} untimed={untimed} isToday={isToday} nowMin={nowMin} />;
}

function TaskList({ tasks }) {
  return (
    <ul className="ag-tasks">
      {tasks.map((task, i) => (
        <li key={i} className={task.done ? 'ag-task ag-task-done' : 'ag-task'}>
          <IcoBox checked={task.done} />
          <span className="ag-task-text">{task.text}</span>
        </li>
      ))}
    </ul>
  );
}

function SessionChips({ sessions }) {
  return (
    <ul className="ag-chips">
      {sessions.map((s, i) => (
        <li key={i} className="ag-chip-session" title={s.title}>
          <span className="ag-chip-time mono">{s.time || '--:--'}</span>
          <span className="ag-chip-text">{s.title}</span>
        </li>
      ))}
    </ul>
  );
}

function GitLines({ lines }) {
  return (
    <ul className="ag-git">
      {lines.map((line, i) => (
        <li key={i} className="ag-git-line mono">
          <span className="ag-git-time">{line.time || '--:--'}</span>
          <span className="ag-git-text">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

function taskMeta(tasks) {
  const done = tasks.filter((t) => t.done).length;
  return `${done}/${tasks.length}`;
}

function evMeta(events) {
  if (events.length === 0) return 'livre';
  return `${events.length} ${events.length === 1 ? 'evento' : 'eventos'}`;
}

function DaySections({ day, isToday, nowMin }) {
  const hasContent = day
    ? day.events.length + day.tasks.length + day.sessions.length + day.github.length > 0
      || Boolean(day.note)
    : false;
  if (!day || !day.exists) {
    // hoje sem daily = caso de onboarding: ensina a destravar; dia passado
    // sem daily e so um fato, texto curto basta.
    if (isToday) return <AgendaUnlock />;
    return <p className="ag-day-state mono">nenhuma daily neste dia</p>;
  }
  if (!hasContent) {
    return <p className="ag-day-state mono">daily sem registros estruturados</p>;
  }
  return (
    <div className="ag-sections">
      {(day.events.length > 0 || isToday) && (
        <Section
          icon={<IcoClock />}
          label="agenda"
          meta={evMeta(day.events)}
          grow={hasTimedEvents(day.events)}
        >
          <Timeline events={day.events} isToday={isToday} nowMin={nowMin} />
        </Section>
      )}
      {day.tasks.length > 0 && (
        <Section icon={<IcoCheck />} label="tarefas" meta={taskMeta(day.tasks)}>
          <TaskList tasks={day.tasks} />
        </Section>
      )}
      {day.sessions.length > 0 && (
        <Section icon={<IcoTerm />} label="sessões" meta={String(day.sessions.length)}>
          <SessionChips sessions={day.sessions} />
        </Section>
      )}
      {day.github.length > 0 && (
        <Section icon={<IcoBranch />} label="github" meta={String(day.github.length)}>
          <GitLines lines={day.github} />
        </Section>
      )}
      {day.note && (
        <Section icon={<IcoNote />} label="nota">
          <p className="ag-note">{day.note}</p>
        </Section>
      )}
    </div>
  );
}

function DayDetail({ iso, day, isToday, nowMin, onOpenNote }) {
  const d = parseIso(iso);
  const title = `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  const canOpen = Boolean(day && day.exists && day.path && typeof onOpenNote === 'function');
  return (
    <article className="agenda-detail panel">
      <header className="ag-detail-head">
        <div className="ag-detail-heading">
          <h2 className="ag-detail-title">{title}</h2>
          {isToday && <span className="ag-today-tag mono">hoje</span>}
        </div>
        {canOpen && (
          <button
            type="button"
            className="ag-open-btn mono"
            onClick={() => onOpenNote(day.path)}
          >
            <IcoOpen />
            abrir daily
          </button>
        )}
      </header>
      <DaySections day={day} isToday={isToday} nowMin={nowMin} />
    </article>
  );
}

// ---------------------------------------------------------------- estados

function AgendaError({ message, onRetry }) {
  return (
    <div className="agenda-state agenda-state-span">
      <p className="agenda-state-text agenda-state-crit mono">falha ao carregar a agenda</p>
      <p className="agenda-state-detail mono">{message}</p>
      <button type="button" className="agenda-retry mono" onClick={onRetry}>
        tentar de novo
      </button>
    </div>
  );
}

// Unlock compartilhado da Agenda (mes vazio + dia de HOJE sem daily).
function AgendaUnlock() {
  return (
    <Unlock
      title="A Agenda nasce das suas notas diárias"
      lead="Crie uma nota por dia no vault, em 6-Daily/, com uma seção Agenda. Cada linha com horário vira um evento no calendário e na timeline."
      steps={[
        'Crie a pasta 6-Daily/ no seu vault (se ainda não existe)',
        'Crie a nota de hoje com o nome AAAA-MM-DD.md',
        'Adicione a seção abaixo e recarregue esta tela',
      ]}
      exampleLabel="6-Daily/2026-07-06.md"
      example={'## Agenda\n\n- [09:00] Daily do time\n- [14:00 - 15:30] Call com cliente\n\n## Tarefas\n\n- [ ] Revisar proposta'}
      guia="#3-view-agenda--tile-hoje-daily-notes-com-seção-agenda"
    />
  );
}

function MonthEmpty() {
  return (
    <div className="agenda-state">
      <p className="agenda-state-text mono">nenhuma daily neste período</p>
      <AgendaUnlock />
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="agenda-grid" aria-hidden="true">
      {Array.from({ length: GRID_CELLS }, (_, i) => (
        <span
          key={i}
          className="agenda-cell ag-cell-skel"
          style={{ animationDelay: `${(i % 7) * 60}ms` }}
        />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="agenda-detail panel" aria-hidden="true">
      <span className="ag-skel-line ag-skel-title" />
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="ag-skel-line" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------- componente

function CalendarPanel({ nav, loading, cells, dayMap, todayIso }) {
  const { month, selected, selectDay, stepMonth, goToday } = nav;
  return (
    <div className="agenda-cal panel">
      <CalHeader
        month={month}
        onPrev={() => stepMonth(-1)}
        onNext={() => stepMonth(1)}
        onToday={goToday}
      />
      <WeekdayRow />
      {loading ? (
        <GridSkeleton />
      ) : (
        <CalGrid
          cells={cells}
          dayMap={dayMap}
          selected={selected}
          todayIso={todayIso}
          onSelect={selectDay}
        />
      )}
      <DotLegend />
    </div>
  );
}

function SidePanel({ loading, monthHasDaily, selected, selectedDay, isToday, nowMin, onOpenNote }) {
  if (loading) {
    return <div className="agenda-side"><DetailSkeleton /></div>;
  }
  if (!monthHasDaily && !selectedDay) {
    return <div className="agenda-side"><MonthEmpty /></div>;
  }
  return (
    <div className="agenda-side">
      <DayDetail
        key={selected}
        iso={selected}
        day={selectedDay}
        isToday={isToday}
        nowMin={nowMin}
        onOpenNote={onOpenNote}
      />
    </div>
  );
}

export default function Agenda({ onOpenNote }) {
  const todayIso = isoOf(new Date());
  const nav = useAgendaNav(todayIso);
  const range = monthRange(nav.month);
  const { data, error, loading, reload } = useApi(
    `/api/agenda?from=${range.from}&to=${range.to}`,
  );
  const dayMap = useMemo(() => buildDayMap(data), [data]);
  const cells = useMemo(() => monthCells(nav.month), [nav.month]);
  const monthHasDaily = useMemo(
    () => [...dayMap.values()].some((d) => d.exists),
    [dayMap],
  );
  useArrowNav(nav.shiftDay);
  const isToday = nav.selected === todayIso;
  useNowTick(isToday);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (!loading && error) {
    return (
      <section className="agenda-root" aria-label="Agenda">
        <AgendaError message={error.message} onRetry={reload} />
      </section>
    );
  }
  return (
    <section className="agenda-root" aria-label="Agenda">
      <CalendarPanel nav={nav} loading={loading} cells={cells} dayMap={dayMap} todayIso={todayIso} />
      <SidePanel
        loading={loading}
        monthHasDaily={monthHasDaily}
        selected={nav.selected}
        selectedDay={dayMap.get(nav.selected) || null}
        isToday={isToday}
        nowMin={nowMin}
        onOpenNote={onOpenNote}
      />
    </section>
  );
}
