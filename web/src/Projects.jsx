// FAROL - Projects.jsx (F7, W-PROJECTS; base F2 agente A4).
// View Projetos v2: faixa de comando (titulo + mini-stats + ordenacao
// atividade|nome|volume) em cima do bento grid de /api/projects.
// Card v2: identicon pixel 5x5 espelhado na cor do projeto, area chart
// suave de 14 dias (decisao fechada: area, sem fallback de barras;
// empty-state textual quando a janela soma 0), tags do server como
// chips dim (payload v2 pode NAO ter tags: defensivo + banlist de tags
// estruturais), notas recentes com glifo + seta no hover (limite
// dinamico por tier pra preencher o span) e footer com mini-stats
// (notas/14d, pico) + 'abrir no grafo' (so quando onOpenProject existe).
// Display-transform: '_' inicial e prefixo de data ISO saem da label;
// o path original segue intacto no onOpen/title.
// Cor por projeto: projectColor importado de roomData.js (fonte unica da
// paleta; a duplicata byte-a-byte de antes driftava — consolidado 2026-07-02).
// Props: { onOpen: (path) => void, onOpenProject?: (path) => void }.
import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from './api.js';
import { projectColor, useSessions } from './roomData.js';
import { projectKey, pendenciaMatches } from './project-keys.js';
import Unlock from './Unlock.jsx';
import './projects.css';

const DAYS = 14;
// Limite de notas recentes acoplado ao span do tier: card maior mostra
// mais notas em vez de deixar void (HIGH densidade do review F7).
const RECENT_LIMIT_BY_TIER = { xl: 6, wide: 5, md: 3, sm: 3 };
const RECENT_LIMIT_DEFAULT = 3;
const TAG_LIMIT = 3;
// Banlist defensiva no client (alem do filtro do server): tags
// estruturais do vault nao diferenciam projeto nenhum.
const TAG_BANLIST = new Set(['timeline', 'project']);
const TAG_BAN_PREFIX = 'type/';
// Prefixo de data ISO na label de nota: a recencia ja aparece no 'ha Xd'.
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}[\s_.·-]*/;
const SKELETON_TIERS = ['xl', 'wide', 'md', 'md', 'wide', 'md'];
const ENTER_STAGGER_MS = 45;
const ENTER_STAGGER_CAP = 11;
const AREA_W = 140;
const AREA_H = 34;
const AREA_PAD = 3;
const SORT_OPTIONS = [
  { id: 'atividade', label: 'atividade' },
  { id: 'nome', label: 'nome' },
  { id: 'volume', label: 'volume' },
];
// Fallback do identicon (sinal de mais) se o hash nao acender celula.
const IDENTICON_FALLBACK = [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]];


// ---------------------------------------------------------------- helpers

function toMs(value) {
  if (typeof value === 'number') return value;
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function relTime(ms) {
  if (!ms) return '';
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function activitySum(project) {
  return Array.isArray(project.activity)
    ? project.activity.reduce((acc, v) => acc + (Number(v) || 0), 0)
    : 0;
}

// Display-transform: filename do vault nao vaza pra UI. Strip de '_'
// inicial ("_Pendencias" -> "Pendencias"); path original fica intacto.
function displayName(raw, fallback) {
  const s = String(raw || '').trim().replace(/^_+/, '').trim();
  return s || fallback;
}

// Label de nota: alem do '_', tira prefixo de data ISO ("2026-04-29
// Pivot AutoBid" -> "Pivot AutoBid"). Se sobrar vazio (nota diaria que
// E so a data), mantem a forma sem underscore.
function noteLabel(title) {
  const base = displayName(title, '');
  const stripped = base.replace(ISO_DATE_PREFIX, '').trim();
  return stripped || base || 'nota';
}

// Pico de atividade na janela (contrato C3.6: indice 13 = hoje).
function peakInfo(activity) {
  if (!Array.isArray(activity)) return null;
  let best = 0;
  let bestIdx = -1;
  for (let i = 0; i < activity.length; i += 1) {
    const v = Number(activity[i]) || 0;
    if (v >= best && v > 0) {
      best = v;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const back = activity.length - 1 - bestIdx;
  return { value: best, when: back > 0 ? `há ${back}d` : 'hoje' };
}

// Tags do server (C3.6): campo novo, pode chegar ausente ou sujo.
// Banlist client e defensiva: o server tambem filtra, mas payload velho
// ou tag estrutural nova nao pode virar chip repetido em todo card.
function projectTags(project) {
  if (!Array.isArray(project.tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of project.tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!tag) continue;
    const low = tag.toLowerCase();
    if (TAG_BANLIST.has(low) || low.startsWith(TAG_BAN_PREFIX)) continue;
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(tag);
    if (out.length === TAG_LIMIT) break;
  }
  return out;
}

function tierFor(index, project, total) {
  // Projeto raso (0-1 notas) nao merece span largo, mesmo se ativo:
  // card grande com 1 nota vira void (HIGH densidade do review F7).
  if ((Number(project.noteCount) || 0) <= 1) return 'sm';
  if (total <= 2) return 'wide';
  if (index === 0) return 'xl';
  if (index <= 2 && project.activityTotal > 0) return 'wide';
  return 'md';
}

function comparatorFor(mode) {
  const byName = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
  if (mode === 'nome') return byName;
  if (mode === 'volume') {
    return (a, b) =>
      (Number(b.noteCount) || 0) - (Number(a.noteCount) || 0) || byName(a, b);
  }
  return (a, b) =>
    b.activityTotal - a.activityTotal
    || toMs(b.lastModifiedTs) - toMs(a.lastModifiedTs)
    || byName(a, b);
}

// Enriquece, ordena pelo modo escolhido e atribui o span do bento.
function decorate(list, mode) {
  const enriched = list.map((p) => ({
    ...p,
    color: projectColor(p.name),
    activityTotal: activitySum(p),
  }));
  const sorted = [...enriched].sort(comparatorFor(mode));
  return sorted.map((p, i) => ({ ...p, tier: tierFor(i, p, sorted.length) }));
}

// ------------------------------------------------------------- identicon
// Glifo pixel 5x5: 15 bits do hash preenchem 3 colunas, colunas 0 e 1
// espelham em 4 e 3 (simetria classica de identicon).

function identiconCells(name) {
  const s = String(name || 'projeto');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 2654435761) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const cells = [];
  for (let bit = 0; bit < 15; bit += 1) {
    if (((h >>> bit) & 1) === 0) continue;
    const col = bit % 3;
    const row = Math.floor(bit / 3);
    cells.push([col, row]);
    if (col < 2) cells.push([4 - col, row]);
  }
  return cells.length > 0 ? cells : IDENTICON_FALLBACK;
}

function Identicon({ name, color }) {
  const cells = useMemo(() => identiconCells(name), [name]);
  return (
    <span className="proj-identicon" aria-hidden="true">
      <svg viewBox="0 0 5 5" shapeRendering="crispEdges">
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} />
        ))}
      </svg>
    </span>
  );
}

// ------------------------------------------------------------ area chart
// Sparkline v2: path suave (quadraticas por ponto medio) com fill 18%
// da cor do projeto. Decisao fechada do spec: area chart, sem barras.

function buildAreaPaths(activity) {
  const vals = Array.from({ length: DAYS }, (_, i) => Number((activity || [])[i]) || 0);
  const max = Math.max(1, ...vals);
  const innerH = AREA_H - AREA_PAD * 2;
  const step = AREA_W / (DAYS - 1);
  const fmt = (n) => Math.round(n * 10) / 10;
  const pts = vals.map((v, i) => [fmt(i * step), fmt(AREA_PAD + (1 - v / max) * innerH)]);
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const midX = fmt((pts[i][0] + pts[i + 1][0]) / 2);
    const midY = fmt((pts[i][1] + pts[i + 1][1]) / 2);
    line += ` Q ${pts[i][0]} ${pts[i][1]} ${midX} ${midY}`;
  }
  const last = pts[pts.length - 1];
  line += ` L ${last[0]} ${last[1]}`;
  const area = `${line} L ${AREA_W} ${AREA_H} L 0 ${AREA_H} Z`;
  return { line, area, hasData: vals.some((v) => v > 0) };
}

function AreaChart({ activity, color }) {
  const { line, area, hasData } = useMemo(() => buildAreaPaths(activity), [activity]);
  // Janela toda zerada: linha flat parece componente quebrado;
  // empty-state textual explicito no lugar (MED chart flat do review).
  if (!hasData) {
    return <div className="proj-area-empty mono">sem atividade nos 14d</div>;
  }
  return (
    <svg
      className="proj-area"
      viewBox={`0 0 ${AREA_W} ${AREA_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <title>atividade nos últimos 14 dias</title>
      <path d={area} fill={color} opacity="0.18" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.85"
      />
    </svg>
  );
}

// ---------------------------------------------------------------- glifos
// SVG inline mono (sem emoji em UI).

function NoteGlyph() {
  return (
    <svg className="proj-note-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3 1.5h4l2 2v7H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M7 1.5v2h2" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg className="proj-note-arrow" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M3 1l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GraphGlyph() {
  return (
    <svg className="proj-graph-glyph" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="2.6" r="1.5" fill="currentColor" />
      <circle cx="2.4" cy="9.4" r="1.5" fill="currentColor" />
      <circle cx="9.6" cy="9.4" r="1.5" fill="currentColor" />
      <path d="M6 4.2L3.2 7.9M6 4.2L8.8 7.9" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function WarnGlyph() {
  return (
    <svg className="projects-state-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5 21.5 20h-19z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg className="projects-state-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6.5h6l2 2h10V19H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------------ card

// Linha "ultima sessao" + pendencias do projeto (F3 v2 — o que faltava:
// quem trabalhou por ultimo, se ha pendencia aberta). Dados do enrich map.
function SessionLine({ ls }) {
  if (!ls) return null;
  return (
    <div className={`proj-sess mono${ls.live ? ' live' : ''}${ls.wait ? ' wait' : ''}`}>
      <span className="proj-sess-dot" aria-hidden="true" />
      {ls.live
        ? <>sessão <b>{ls.name}</b> {ls.wait ? 'esperando você' : 'trabalhando agora'}</>
        : <>última sessão <b>{ls.name}</b> · {ls.when}{ls.files ? ` · ${ls.files} arquivos` : ''}</>}
    </div>
  );
}

function PendLines({ pends, onOpen }) {
  if (!pends || pends.length === 0) return null;
  return (
    <ul className="proj-pends">
      {pends.slice(0, 2).map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className="proj-pend mono"
            title={p.title}
            onClick={() => typeof onOpen === 'function' && p.path && onOpen(p.path)}
          >
            <span className="proj-pend-st">{p.status}</span>
            <span className="proj-pend-title">{p.title}</span>
            {p.tempo ? <span className="proj-pend-t">{p.tempo}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Projetos SEM pasta no vault (topics vivos no diario/sessoes): o "faltam
// alguns" do feedback. Cards fantasma menores, com o que se sabe deles.
function GhostProjects({ enrich, projects }) {
  const known = new Set(projects.map((p) => projectKey(p.name)));
  const ghosts = [...enrich.entries()]
    .filter(([key, e]) => !known.has(key) && !GHOST_EXCLUDE.has(key)
      && (e.lastSession || e.pends.length))
    .slice(0, 8);
  if (ghosts.length === 0) return null;
  return (
    <div className="projects-ghosts">
      <div className="projects-ghosts-title mono">sem pasta no vault · vivem nas sessões</div>
      <div className="projects-ghosts-grid">
        {ghosts.map(([key, e]) => (
          <article key={key} className="proj-ghost" style={{ '--proj-color': projectColor(key) }}>
            <h3 className="proj-ghost-name">{key}</h3>
            <SessionLine ls={e.lastSession} />
            <PendLines pends={e.pends} />
          </article>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, enrich, onOpen, onOpenProject, index }) {
  const recentLimit = RECENT_LIMIT_BY_TIER[project.tier] || RECENT_LIMIT_DEFAULT;
  const recents = Array.isArray(project.recentNotes)
    ? project.recentNotes.slice(0, recentLimit)
    : [];
  const tags = projectTags(project);
  const noteCount = Number(project.noteCount) || 0;

  function handleHead() {
    if (typeof onOpenProject === 'function') {
      onOpenProject(project.path);
      return;
    }
    if (recents[0] && typeof onOpen === 'function') onOpen(recents[0].path);
  }

  const delay = Math.min(index, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
  return (
    <article
      className={`proj-card proj-${project.tier}`}
      style={{ '--proj-color': project.color, animationDelay: `${delay}ms` }}
    >
      <button type="button" className="proj-head" onClick={handleHead} title={project.path}>
        {project.logo ? (
          <img
            className="proj-logo"
            src={`/api/asset?path=${encodeURIComponent(project.logo)}`}
            alt=""
            loading="lazy"
            width="34"
            height="34"
          />
        ) : (
          <Identicon name={project.name} color={project.color} />
        )}
        <span className="proj-head-text">
          <h2 className="proj-name">{displayName(project.name, 'projeto')}</h2>
          <span className="proj-meta mono">
            {noteCount} {noteCount === 1 ? 'nota' : 'notas'}
            {project.lastModifiedTs ? (
              <span className="proj-meta-dim"> · {relTime(toMs(project.lastModifiedTs))}</span>
            ) : null}
          </span>
        </span>
      </button>
      {tags.length > 0 && <TagChips tags={tags} />}
      <SessionLine ls={enrich?.lastSession} />
      <PendLines pends={enrich?.pends} onOpen={onOpen} />
      <AreaChart activity={project.activity} color={project.color} />
      <RecentNotes recents={recents} onOpen={onOpen} />
      <CardFooter project={project} onOpenProject={onOpenProject} />
    </article>
  );
}

function TagChips({ tags }) {
  return (
    <div className="proj-tags" aria-label="Tags do projeto">
      {tags.map((tag) => (
        <span key={tag} className="proj-tag mono">{tag}</span>
      ))}
    </div>
  );
}

function RecentNotes({ recents, onOpen }) {
  if (recents.length === 0) {
    return <div className="proj-no-notes mono">sem notas recentes</div>;
  }
  return (
    <ul className="proj-recents">
      {recents.map((note) => (
        <li key={note.path}>
          <button
            type="button"
            className="proj-note"
            title={note.path}
            onClick={() => typeof onOpen === 'function' && onOpen(note.path)}
          >
            <NoteGlyph />
            <span className="proj-note-title">{noteLabel(note.title)}</span>
            <span className="proj-note-when mono">{relTime(toMs(note.mtimeMs))}</span>
            <ArrowGlyph />
          </button>
        </li>
      ))}
    </ul>
  );
}

// Footer sempre renderiza: mini-stats mono dim preenchem o respiro do
// card (HIGH densidade); 'abrir no grafo' so quando onOpenProject existe.
function CardFooter({ project, onOpenProject }) {
  const peak = peakInfo(project.activity);
  const total = Number(project.activityTotal) || 0;
  return (
    <div className="proj-foot">
      <span className="proj-foot-stats mono">
        {total} notas/14d
        {peak ? <span className="proj-foot-dim"> · pico {peak.value} {peak.when}</span> : null}
      </span>
      {typeof onOpenProject === 'function' && (
        <button
          type="button"
          className="proj-open-graph mono"
          onClick={() => onOpenProject(project.path)}
        >
          <GraphGlyph />
          abrir no grafo
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------ faixa de comando

function Stat({ value, label }) {
  return (
    <div className="projects-stat">
      <span className="projects-stat-value mono">{value}</span>
      <span className="projects-stat-label">{label}</span>
    </div>
  );
}

function CommandBar({ ready, count, totalNotes, recentNotes, sort, onSort }) {
  return (
    <header className="projects-cmd">
      <div className="projects-cmd-id">
        <span className="projects-title mono">projetos</span>
        <span className="projects-sub mono">atividade do vault por projeto</span>
      </div>
      {ready && count > 0 && (
        <div className="projects-stats" role="group" aria-label="Resumo dos projetos">
          <Stat value={count} label="projetos" />
          <Stat value={totalNotes} label="notas" />
          <Stat value={recentNotes} label="notas/14d" />
        </div>
      )}
      <div className="projects-sort" role="group" aria-label="Ordenar projetos">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`projects-sort-btn mono${sort === opt.id ? ' is-active' : ''}`}
            aria-pressed={sort === opt.id}
            onClick={() => onSort(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- estados

function ProjectsSkeleton() {
  return (
    <div className="projects-grid" aria-hidden="true">
      {SKELETON_TIERS.map((tier, i) => (
        <div key={i} className={`proj-card proj-${tier} proj-skel`}>
          <span className="skel-row">
            <span className="skel-ident" />
            <span className="skel-col">
              <span className="skel-line skel-name" />
              <span className="skel-line skel-meta" />
            </span>
          </span>
          <span className="skel-block" />
          <span className="skel-line" />
          <span className="skel-line" />
        </div>
      ))}
    </div>
  );
}

function ProjectsError({ message, onRetry }) {
  return (
    <div className="projects-state">
      <span className="projects-state-icon projects-state-icon-crit"><WarnGlyph /></span>
      <p className="projects-state-text projects-state-crit">falha ao carregar projetos</p>
      <p className="projects-state-detail">{message}</p>
      <button type="button" className="projects-retry" onClick={onRetry}>
        tentar de novo
      </button>
    </div>
  );
}

function ProjectsEmpty() {
  return (
    <div className="projects-state">
      <span className="projects-state-icon"><FolderGlyph /></span>
      <p className="projects-state-text">nenhum projeto encontrado</p>
      <Unlock
        title="Cada subpasta de 1-Projects vira um card"
        lead="Esta tela agrupa as notas por projeto usando a pasta 1-Projects do seu vault — uma subpasta por projeto ativo."
        steps={[
          'Crie a pasta 1-Projects/ no seu vault',
          'Dentro dela, uma subpasta por projeto (ex: 1-Projects/Meu App/)',
          'Coloque as notas do projeto lá — o card mostra atividade e tags',
        ]}
        exampleLabel="estrutura"
        example={'vault/\n  1-Projects/\n    Meu App/\n      Meu App.md\n      Roadmap.md\n    Loja/\n      Loja.md'}
        guia="#2-view-projetos-subpastas-de-1-projects"
      />
    </div>
  );
}

// -------------------------------------------------- enriquecimento (F3 v2)
// Join por projectKey: ultima sessao (viva vence; senao diary por endedTs
// max — regra pinada no plano refactor-v2) + pendencias por match textual.
// Classificacao vem do SERVER (topic); aqui so normaliza/junta.

const GHOST_EXCLUDE = new Set(['outros', 'home', 'pessoal', 'setup-claude']);

function buildEnrichment(sessions, diary, pendencias) {
  const byKey = new Map();
  const ensure = (key) => {
    if (!byKey.has(key)) byKey.set(key, { lastSession: null, pends: [] });
    return byKey.get(key);
  };
  // sessoes VIVAS vencem (mais quente primeiro)
  const live = (sessions || []).filter((s) => s && s.state !== 'dormindo' && s.topic);
  for (const s of live.sort((a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0))) {
    const e = ensure(projectKey(s.topic));
    if (!e.lastSession || !e.lastSession.live) {
      e.lastSession = {
        live: true, name: s.name || s.topic, wait: !!s.awaitingInput,
        when: 'agora', state: s.state,
      };
    }
  }
  // diary: max endedTs por key (array ja vem newest-first, mas nao confio)
  const entries = Array.isArray(diary) ? [...diary] : [];
  entries.sort((a, b) => new Date(b.endedTs || 0) - new Date(a.endedTs || 0));
  for (const d of entries) {
    if (!d.topic) continue;
    const e = ensure(projectKey(d.topic));
    if (!e.lastSession) {
      e.lastSession = { live: false, name: d.topic, when: relTime(toMs(d.endedTs)), files: d.fileCount };
    }
  }
  for (const p of (pendencias?.top || [])) {
    for (const key of byKey.keys()) {
      if (pendenciaMatches(p.projeto, key)) ensure(key).pends.push(p);
    }
    // pendencia de projeto ainda sem key conhecida: cria o key dela
    const own = projectKey(p.projeto);
    if (own && !byKey.has(own)) ensure(own).pends.push(p);
  }
  return byKey;
}

// ------------------------------------------------------------- componente

export default function Projects({ onOpen, onOpenProject }) {
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState('atividade');
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [extra, setExtra] = useState({ diary: null, pendencias: null });
  const { sessions } = useSessions();

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, loading: true });
    fetchJson('/api/projects')
      .then((data) => { if (alive) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (alive) setState({ data: null, error, loading: false }); });
    // enriquecimento degrada sozinho: sem diary/pendencias o card so nao
    // mostra as linhas novas (nunca bloqueia o grid)
    Promise.allSettled([fetchJson('/api/diary'), fetchJson('/api/pendencias')])
      .then(([d, p]) => {
        if (!alive) return;
        setExtra({
          diary: d.status === 'fulfilled' ? d.value : null,
          pendencias: p.status === 'fulfilled' ? p.value : null,
        });
      });
    return () => { alive = false; };
  }, [attempt]);

  const enrich = useMemo(
    () => buildEnrichment(sessions, extra.diary, extra.pendencias),
    [sessions, extra],
  );

  const projects = useMemo(
    () => (Array.isArray(state.data) ? decorate(state.data, sort) : []),
    [state.data, sort],
  );
  const totals = useMemo(() => ({
    notes: projects.reduce((acc, p) => acc + (Number(p.noteCount) || 0), 0),
    recent: projects.reduce((acc, p) => acc + p.activityTotal, 0),
  }), [projects]);
  const { loading, error } = state;
  const ready = !loading && !error;

  return (
    <section className="projects-root" aria-label="Projetos do vault">
      <CommandBar
        ready={ready}
        count={projects.length}
        totalNotes={totals.notes}
        recentNotes={totals.recent}
        sort={sort}
        onSort={setSort}
      />
      {loading && <ProjectsSkeleton />}
      {!loading && error && (
        <ProjectsError
          message={String(error?.message || 'erro de rede')}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {ready && projects.length === 0 && <ProjectsEmpty />}
      {ready && projects.length > 0 && (
        <>
          <div className="projects-grid">
            {projects.map((p, i) => (
              <ProjectCard
                key={p.path || p.name}
                project={p}
                enrich={enrich.get(projectKey(p.name)) || null}
                onOpen={onOpen}
                onOpenProject={onOpenProject}
                index={i}
              />
            ))}
          </div>
          <GhostProjects enrich={enrich} projects={projects} />
        </>
      )}
    </section>
  );
}
