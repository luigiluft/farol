// FAROL - fonte única do mapa ferramenta -> classe de cor.
// Antes vivia local no AgentOps; agora compartilhado com o fluxo do Cockpit.
// Classes casam com o CSS existente (agentops.css .st-*): ciano leitura,
// verde escrita, âmbar shell, violeta busca/skill, dim ocioso.
export function subToolClass(tool) {
  if (!tool) return 'st-idle';
  if (tool === 'WebSearch' || tool === 'Skill') return 'st-search';
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return 'st-write';
  if (tool === 'Bash' || tool === 'PowerShell') return 'st-shell';
  return 'st-read';
}
