// FAROL demo (npm run demo): sobe o app com dados 100% sinteticos.
// Semeia .demo/ (vault ficticio + sessoes fake), aponta o server pra la e
// mantem um driver de atividade: as "sessoes" seguem trabalhando, entao o
// universo tem naves voando e a fila ESPERANDO VOCE tem 1 pergunta.
// Encerrar: Ctrl+C. Nada fora de .demo/ e lido ou escrito.
import fs from 'node:fs';
import path from 'node:path';
import { seedDemo, demoSessions, assistantLine } from './seed.mjs';

const seeded = seedDemo();
process.env.TORRE_VAULT = seeded.vault;
process.env.TORRE_CLAUDE = seeded.claude;
process.env.TORRE_DATA = seeded.data;
process.env.TORRE_PORT = process.env.TORRE_PORT || '7777';

console.log(`[demo] vault sintetico: ${seeded.notes} notas · ${seeded.sessions} sessoes fake`);

const sessions = demoSessions(seeded.vault);
const v = (rel) => path.join(seeded.vault, rel).replace(/\\/g, '/');
const SCRIPTS = {
  'loja-aurora': {
    model: 'claude-opus-4-8',
    beats: [
      { text: 'Conferindo a regra de frete antes do cupom.', tool: 'Read', file: '1-Projects/Loja Aurora/Loja Aurora.md' },
      { text: 'Cupom aplicado no resumo do carrinho.', tool: 'Edit', file: '1-Projects/Loja Aurora/Checkout.md' },
      { text: 'Comparando taxas do gateway pra regra de parcelas.', tool: 'Read', file: '3-Resources/Tech/Gateway de Pagamento.md' },
      { text: 'Atualizando o catalogo com o campo de desconto.', tool: 'Edit', file: '1-Projects/Loja Aurora/Catalogo.md' },
    ],
  },
  'blog-aurora': {
    model: 'claude-sonnet-5',
    beats: [
      { text: 'Puxando referencias do guia de SEO.', tool: 'Read', file: '3-Resources/Tech/Guia de SEO.md' },
      { text: 'Rascunho do post ganhando a secao de bastidores.', tool: 'Edit', file: '1-Projects/Blog Aurora/Blog Aurora.md' },
      { text: 'Checando a pauta pra nao fugir do angulo.', tool: 'Read', file: '1-Projects/Blog Aurora/Pauta de Julho.md' },
      { text: 'Citando a entrevista da Ana no rascunho.', tool: 'Read', file: '3-Resources/Pessoas/Ana Ribeiro.md' },
    ],
  },
};

let beat = 0;
function drive() {
  for (const s of sessions) {
    const script = SCRIPTS[s.dir];
    const file = path.join(seeded.claude, 'projects', s.dir, s.file);
    if (!script) {
      // sessao "esperando voce": mtime fresco mantem viva SEM novo turno
      const now = new Date();
      try { fs.utimesSync(file, now, now); } catch {}
      continue;
    }
    const b = script.beats[beat % script.beats.length];
    const line = assistantLine({
      text: b.text,
      tools: [{ name: b.tool, input: { file_path: v(b.file) } }],
      model: script.model,
      out: 400 + Math.floor(Math.random() * 900),
    });
    try { fs.appendFileSync(file, `${line}\n`); } catch {}
  }
  beat += 1;
}

drive();
setInterval(drive, 4000); // server (listen) mantem o processo vivo

await import('../../server/index.mjs');
