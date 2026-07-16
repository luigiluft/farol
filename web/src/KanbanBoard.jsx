// Board kanban read-only (Tarefa 3.1): frontmatter kanban-plugin -> colunas
// '## Nome' + cards '- [ ] texto' (obsidian-kanban). Wikilinks nos cards
// resolvem pelo mesmo cache/endpoint que ObsidianMarkdown usa (resolveCache
// seedado por note.links, fallback GET /api/resolve?name=), entao onNavigate
// sempre recebe o path relativo do vault, nunca o nome cru do link.
import { useEffect, useState } from 'react';
import { parseKanban, splitWikilinks } from './kanban-parse.js';
import { resolveWikilink, seedResolveCache } from './markdown.jsx';
import './kanban.css';

function KanbanLink({ name, alias, onNavigate }) {
  const [path, setPath] = useState();

  useEffect(() => {
    let alive = true;
    resolveWikilink(name).then((resolved) => {
      if (alive) setPath(resolved);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  if (path === null) {
    return (
      <span className="kb-link kb-link-broken" title={'nao encontrada no vault: ' + name}>
        {alias}
      </span>
    );
  }
  return (
    <a
      className="kb-link"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        if (path && onNavigate) onNavigate(path);
      }}
    >
      {alias}
    </a>
  );
}

function CardText({ text, onNavigate }) {
  return splitWikilinks(text).map((seg, i) =>
    seg.link ? (
      <KanbanLink key={i} name={seg.link} alias={seg.alias} onNavigate={onNavigate} />
    ) : (
      <span key={i}>{seg.text}</span>
    )
  );
}

export default function KanbanBoard({ markdown, links, onNavigate }) {
  seedResolveCache(links);
  const cols = parseKanban(markdown);
  if (!cols.length) return <div className="kb-empty">kanban vazio</div>;
  return (
    <div className="kb-board">
      {cols.map((col, i) => (
        <div key={`${col.title}-${i}`} className="kb-col panel">
          <div className="kb-col-head">
            <span className="kb-col-title">{col.title}</span>
            <span className="kb-col-count">{col.cards.length}</span>
          </div>
          <div className="kb-cards">
            {col.cards.map((card, i) => (
              <div key={i} className={`kb-card${card.done ? ' kb-done' : ''}`}>
                <CardText text={card.text} onNavigate={onNavigate} />
              </div>
            ))}
            {!col.cards.length && <div className="kb-col-empty">—</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
