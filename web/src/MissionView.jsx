// FAROL - MissionView (F9): blocos compartilhados que mostram o CONTEXTO
// SEMANTICO de um agente (o que esta fazendo e por que), em vez da acao crua
// de ferramenta. Usados pelo Dossier (detalhe) e pelo AgentOps (painel C).
//
// AgentNarrative: prioriza o briefing LLM (resumo + etapa + falta) quando
// ligado; cai na narrativa crua (ultimo texto que o agente escreveu) quando o
// briefing esta desligado/sem chave; null quando nao ha nada legivel.
// MissionChecklist: progresso da missao derivado das tasks (TaskCreate/Update),
// destacando a etapa "AGORA" (primeira in_progress, senao primeira pending).
import './agentops.css';

// Resolve a fonte do texto semantico. Retorna {lead, etapa, falta, source} ou
// null. source: 'llm' (briefing) | 'agent' (narrativa crua).
export function semanticContext(session, briefing) {
  if (briefing && briefing.enabled && (briefing.resumo || briefing.etapa)) {
    return {
      lead: briefing.resumo || '',
      etapa: briefing.etapa || '',
      falta: briefing.falta || '',
      source: 'llm',
    };
  }
  if (session && typeof session.narrative === 'string' && session.narrative.trim()) {
    return { lead: session.narrative.trim(), etapa: '', falta: '', source: 'agent' };
  }
  return null;
}

export function AgentNarrative({ session, briefing, loading, compact = false }) {
  const ctx = semanticContext(session, briefing);
  if (!ctx) {
    if (loading) return <p className="an-lead an-dim">sintetizando contexto...</p>;
    return null;
  }
  const llmOff = briefing && briefing.enabled === false;
  return (
    <div className={'agent-narrative' + (compact ? ' compact' : '')}>
      <p className="an-lead">{ctx.lead}</p>
      {ctx.etapa || ctx.falta ? (
        <div className="an-meta">
          {ctx.etapa ? (
            <span className="an-chip an-now">
              <b>etapa</b> {ctx.etapa}
            </span>
          ) : null}
          {ctx.falta ? (
            <span className="an-chip an-falta">
              <b>falta</b> {ctx.falta}
            </span>
          ) : null}
        </div>
      ) : null}
      {ctx.source === 'agent' && llmOff && briefing.reason ? (
        <span className="an-src" title={briefing.reason}>
          narrativa do agente · briefing LLM desligado
        </span>
      ) : null}
    </div>
  );
}

export function MissionChecklist({ tasks }) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && t.title) : [];
  if (!list.length) return null;
  // A etapa "agora" e a primeira in_progress; sem nenhuma, a primeira pending.
  let nowIdx = list.findIndex((t) => t.status === 'in_progress');
  if (nowIdx < 0) nowIdx = list.findIndex((t) => t.status !== 'completed');
  const done = list.filter((t) => t.status === 'completed').length;
  return (
    <div className="mission-check-wrap">
      <ul className="mission-check">
        {list.map((t, i) => {
          const cls = t.status === 'completed' ? 'done' : i === nowIdx ? 'now' : 'todo';
          return (
            <li key={`${i}-${t.title}`} className={`mc ${cls}`}>
              <span className="mc-box" aria-hidden="true" />
              <span className="mc-text">{t.title}</span>
              {cls === 'now' ? <span className="mc-now">AGORA</span> : null}
            </li>
          );
        })}
      </ul>
      <span className="mc-count">
        {done}/{list.length} feitas
      </span>
    </div>
  );
}
