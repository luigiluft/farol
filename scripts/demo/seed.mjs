// FAROL demo - gera .demo/ com um vault sintetico (Estudio Aurora, ficticio)
// + transcripts fake de sessoes Claude Code que o parser real aceita.
// 100% sintetico: zero dado do dono. Usado por npm run demo e pela midia
// do README. Exportado para teste (seedDemo com root explicito).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_ROOT = path.join(ROOT, '.demo');

// ------------------------------------------------------------- vault ----

const fm = (tags) => `---\ntags: [${tags}]\n---\n\n`;
const NOTES = {
  '0-Inbox/ideia app de treinos.md': `${fm('inbox')}# Ideia: app de treinos\n\nCapturar depois. Ver [[App Zen]].\n`,
  '0-Inbox/link curso de tipografia.md': `${fm('inbox')}# Curso de tipografia\n\nPra [[Identidade Visual]].\n`,
  '1-Projects/Loja Aurora/Loja Aurora.md': `${fm('project')}# Loja Aurora\n\nE-commerce da marca. Checkout em construcao — ver [[Checkout]] e [[Catalogo]].\n\nEquipe: [[Ana Ribeiro]].\n`,
  '1-Projects/Loja Aurora/Checkout.md': `${fm('project')}# Checkout\n\nFluxo: carrinho > frete > pagamento. Pendente: cupom de desconto.\n\nRelacionado: [[Loja Aurora]], [[Gateway de Pagamento]].\n`,
  '1-Projects/Loja Aurora/Catalogo.md': `${fm('project')}# Catalogo\n\n120 produtos. Fotos novas com a [[Identidade Visual]].\n`,
  '1-Projects/Blog Aurora/Blog Aurora.md': `${fm('project')}# Blog Aurora\n\nConteudo semanal. Pauta em [[Pauta de Julho]]. SEO em [[Guia de SEO]].\n`,
  '1-Projects/Blog Aurora/Pauta de Julho.md': `${fm('project')}# Pauta de Julho\n\n1. Bastidores do estudio\n2. Como escolhemos [[Identidade Visual]]\n3. Entrevista com [[Ana Ribeiro]]\n`,
  '1-Projects/App Zen/App Zen.md': `${fm('project')}# App Zen\n\nApp de meditacao. MVP: timer + sons. Ver [[Trilha Sonora]] e [[Onboarding do App]].\n`,
  '1-Projects/App Zen/Onboarding do App.md': `${fm('project')}# Onboarding do App\n\n3 telas. Texto curto. Referencias em [[Biblioteca de Referencias]].\n`,
  '2-Areas/Financeiro.md': `${fm('area')}# Financeiro\n\nFluxo de caixa mensal. Meta do trimestre em [[Metas 2026]].\n`,
  '2-Areas/Time.md': `${fm('area')}# Time\n\n[[Ana Ribeiro]] (design), [[Bruno Costa]] (dev), eu.\n`,
  '2-Areas/Metas 2026.md': `${fm('area')}# Metas 2026\n\n- Lancar [[App Zen]]\n- Dobrar o [[Blog Aurora]]\n- [[Loja Aurora]] no ar ate agosto\n`,
  '3-Resources/Design/Identidade Visual.md': `${fm('reference')}# Identidade Visual\n\nPaleta: areia, grafite, ambar. Fontes: serif no titulo. Ver [[Biblioteca de Referencias]].\n`,
  '3-Resources/Design/Biblioteca de Referencias.md': `${fm('reference')}# Biblioteca de Referencias\n\nSites, capas e posters guardados. Alimenta [[Identidade Visual]].\n`,
  '3-Resources/Tech/Gateway de Pagamento.md': `${fm('reference')}# Gateway de Pagamento\n\nComparativo de taxas. Decisao pendente — impacta o [[Checkout]].\n`,
  '3-Resources/Tech/Guia de SEO.md': `${fm('reference')}# Guia de SEO\n\nChecklist on-page do [[Blog Aurora]].\n`,
  '3-Resources/Audio/Trilha Sonora.md': `${fm('reference')}# Trilha Sonora\n\n12 faixas ambient para o [[App Zen]].\n`,
  '3-Resources/Pessoas/Ana Ribeiro.md': `${fm('person')}# Ana Ribeiro\n\nDesigner. Cuida da [[Identidade Visual]] e do [[Catalogo]].\n`,
  '3-Resources/Pessoas/Bruno Costa.md': `${fm('person')}# Bruno Costa\n\nDev. Focado no [[Checkout]] e no [[App Zen]].\n`,
  '5-Atlas/MOC-Projetos.md': `${fm('moc')}# MOC Projetos\n\n- [[Loja Aurora]]\n- [[Blog Aurora]]\n- [[App Zen]]\n`,
  '6-Daily/2026-07-04.md': `${fm('daily')}# Sexta, 4 de julho\n\nRevisei o [[Checkout]] com [[Bruno Costa]]. Pauta do blog fechada.\n`,
  '6-Daily/2026-07-05.md': `${fm('daily')}# Sabado, 5 de julho\n\nManha no [[App Zen]]. A tarde: fotos do [[Catalogo]].\n`,
};

// ------------------------------------------------------- transcripts ----

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function userLine(text, msAgo) {
  return JSON.stringify({
    type: 'user',
    timestamp: iso(msAgo),
    message: { role: 'user', content: text },
  });
}

function assistantLine({ text, tools = [], model = 'claude-opus-4-8', awaiting = false, msAgo = 0, out = 900 }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const t of tools) content.push({ type: 'tool_use', id: `tu_${Math.floor(Math.random() * 1e9)}`, name: t.name, input: t.input });
  return JSON.stringify({
    type: 'assistant',
    timestamp: iso(msAgo),
    message: {
      role: 'assistant',
      model,
      stop_reason: awaiting ? 'end_turn' : 'tool_use',
      usage: { input_tokens: 40, output_tokens: out, cache_read_input_tokens: 52000, cache_creation_input_tokens: 1200 },
      content,
    },
  });
}

// Sessoes demo: 3 personagens em projetos diferentes; a terceira termina
// o turno com pergunta (estado ESPERANDO VOCE na UI).
export function demoSessions(vaultRoot) {
  const v = (rel) => path.join(vaultRoot, rel).replace(/\\/g, '/');
  return [
    {
      dir: 'loja-aurora',
      file: 'a1b2c3d4-0001-4000-8000-000000000001.jsonl',
      lines: [
        userLine('implementa o cupom de desconto no checkout da loja', 9 * 60000),
        assistantLine({ text: 'Vou mapear o fluxo do checkout antes de mexer.', tools: [{ name: 'Read', input: { file_path: v('1-Projects/Loja Aurora/Checkout.md') } }], msAgo: 8 * 60000 }),
        assistantLine({ tools: [{ name: 'TodoWrite', input: { todos: [{ content: 'Mapear fluxo atual', status: 'completed' }, { content: 'Regra do cupom', status: 'in_progress' }, { content: 'Testes do checkout', status: 'pending' }] } }], msAgo: 6 * 60000 }),
        assistantLine({ text: 'Fluxo mapeado. Escrevendo a regra do cupom agora.', tools: [{ name: 'Edit', input: { file_path: v('1-Projects/Loja Aurora/Checkout.md') } }], msAgo: 30000 }),
      ],
    },
    {
      dir: 'blog-aurora',
      file: 'a1b2c3d4-0002-4000-8000-000000000002.jsonl',
      lines: [
        userLine('escreve o rascunho do post de bastidores do estudio', 12 * 60000),
        assistantLine({ text: 'Lendo a pauta pra seguir o angulo combinado.', tools: [{ name: 'Read', input: { file_path: v('1-Projects/Blog Aurora/Pauta de Julho.md') } }], model: 'claude-sonnet-5', msAgo: 10 * 60000 }),
        assistantLine({ text: 'Rascunho em andamento, tom leve como o guia pede.', tools: [{ name: 'Edit', input: { file_path: v('1-Projects/Blog Aurora/Blog Aurora.md') } }], model: 'claude-sonnet-5', msAgo: 45000 }),
      ],
    },
    {
      dir: 'app-zen',
      file: 'a1b2c3d4-0003-4000-8000-000000000003.jsonl',
      lines: [
        userLine('revisa o texto das 3 telas de onboarding do app', 15 * 60000),
        assistantLine({ text: 'Lendo o onboarding atual.', tools: [{ name: 'Read', input: { file_path: v('1-Projects/App Zen/Onboarding do App.md') } }], msAgo: 14 * 60000 }),
        assistantLine({ text: 'Revisei as 3 telas. A tela 2 tem dois caminhos possiveis: focar em beneficio ("durma melhor") ou em ritual ("3 minutos por dia"). Qual tom voce prefere?', awaiting: true, msAgo: 4 * 60000 }),
      ],
    },
  ];
}

export function seedDemo(root = DEMO_ROOT) {
  const vault = path.join(root, 'vault');
  const claude = path.join(root, 'claude');
  const data = path.join(root, 'data');
  fs.rmSync(root, { recursive: true, force: true });
  for (const [rel, body] of Object.entries(NOTES)) {
    const f = path.join(vault, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  const sessions = demoSessions(vault);
  for (const s of sessions) {
    const dir = path.join(claude, 'projects', s.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, s.file), `${s.lines.join('\n')}\n`);
  }
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(
    path.join(data, 'topics.json'),
    `${JSON.stringify([
      { topic: 'loja', pattern: 'checkout|loja|cupom|catalogo' },
      { topic: 'blog', pattern: 'blog|post|pauta|rascunho' },
      { topic: 'zen', pattern: 'zen|onboarding|meditacao|app' },
    ], null, 2)}\n`,
  );
  return { root, vault, claude, data, notes: Object.keys(NOTES).length, sessions: sessions.length };
}

export { assistantLine, userLine };
