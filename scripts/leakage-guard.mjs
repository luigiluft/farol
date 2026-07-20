#!/usr/bin/env node
/**
 * leakage-guard — barra dado pessoal/de cliente antes de virar commit público.
 *
 * Dois níveis, de propósito:
 *   1. PADRÕES GENÉRICOS (este arquivo, versionado) — formato, não valor. Seguro em repo público.
 *   2. DENYLIST LITERAL (.leakage-denylist, gitignorado) — os identificadores reais.
 *      Não é commitado porque a própria lista seria o vazamento. CI roda só o nível 1;
 *      o nível 2 pega no pre-push local, onde o arquivo existe.
 *
 * Uso:  node scripts/leakage-guard.mjs [--staged]
 * Saída: exit 1 e lista de ocorrências se achar algo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, join } from 'node:path';

const ROOT = process.cwd();
const STAGED_ONLY = process.argv.includes('--staged');

// Formato, nunca valor — cada um destes é seguro de publicar.
const PATTERNS = [
  { id: 'home-path-win', re: /C:\\+Users\\+[A-Za-z0-9._-]+/g, why: 'caminho de home do Windows' },
  { id: 'home-path-nix', re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//g, why: 'caminho de home Unix' },
  { id: 'email', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, why: 'endereço de e-mail' },
  { id: 'telegram-token', re: /\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b/g, why: 'token de bot Telegram' },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g, why: 'chave estilo OpenAI' },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, why: 'chave Anthropic' },
  { id: 'github-pat', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, why: 'token GitHub' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, why: 'access key AWS' },
  { id: 'generic-secret', re: /\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{16,}["']/gi, why: 'segredo atribuído inline' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, why: 'chave privada' },
  { id: 'onedrive-vault', re: /OneDrive[\\/][^\s"']*Obsidian/gi, why: 'caminho do vault pessoal' },
];

const SKIP_DIRS = /(?:^|[\\/])(?:\.git|node_modules|dist|build|coverage|\.next|out)(?:[\\/]|$)/;
const SKIP_FILES = /\.(?:png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|mp4|mov|woff2?|ttf|lock)$/i;
// Exemplos e placeholders não são vazamento.
const ALLOW_LINE = /(?:example|placeholder|YOUR_|<your|dummy|fake|sample|redacted|\*\*\*|xxx|foo@bar)/i;
// Publicação deliberada (ex.: e-mail de contato no rodapé) se marca na linha, nunca no padrão —
// assim a isenção fica auditável no diff em vez de sumir dentro de um regex genérico.
const ALLOW_PRAGMA = /leakage-guard-allow/;

function loadDenylist() {
  const p = join(ROOT, '.leakage-denylist');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function listFiles() {
  // sem shell: argumentos em array, nada de string montada
  const args = STAGED_ONLY
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACM']
    : ['ls-files'];
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !SKIP_DIRS.test(f) && !SKIP_FILES.test(f));
}

export function scanText(text, denylist = []) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line) || ALLOW_PRAGMA.test(line)) return;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(line)) hits.push({ line: i + 1, id: p.id, why: p.why });
    }
    for (const literal of denylist) {
      if (line.toLowerCase().includes(literal.toLowerCase())) {
        hits.push({ line: i + 1, id: 'denylist', why: `termo da denylist local` });
      }
    }
  });
  return hits;
}

// Metadado de commit NAO aparece no conteudo — grep de arvore e cego a ele.
// Este e o vetor que ja quase vazou o e-mail duas vezes: o autor do commit.
function scanAuthors() {
  const out = execFileSync('git', ['log', '--format=%ae%n%ce'], { cwd: ROOT, encoding: 'utf8' });
  const emails = [...new Set(out.split(/\r?\n/).filter(Boolean))];
  const bad = emails.filter((e) => !/@users\.noreply\.github\.com$/.test(e));
  console.log(`leakage-guard(autores): ${emails.length} e-mail(s) distinto(s) no histórico`);
  if (!bad.length) {
    console.log('limpo — todo commit usa noreply');
    return 0;
  }
  console.error(`\n${bad.length} e-mail(s) de autor/committer fora do noreply:\n`);
  for (const e of bad) console.error(`  ${e}`);
  console.error('\nCorrija com: git config user.email "<id>+<user>@users.noreply.github.com"');
  console.error('e reescreva os commits afetados antes de publicar.');
  return 1;
}

function main() {
  const denylist = loadDenylist();
  const files = listFiles();
  const found = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue; // binário ou ilegível
    }
    for (const h of scanText(text, denylist)) {
      found.push({ file: relative(ROOT, f), ...h });
    }
  }

  const mode = STAGED_ONLY ? 'staged' : 'tracked';
  const dl = denylist.length ? `${denylist.length} termo(s) locais` : 'sem denylist local (só padrões genéricos)';
  console.log(`leakage-guard: ${files.length} arquivo(s) ${mode} · ${dl}`);

  if (!found.length) {
    console.log('limpo — nada a barrar');
    return 0;
  }
  console.error(`\n${found.length} ocorrência(s):\n`);
  for (const h of found) console.error(`  ${h.file}:${h.line}  [${h.id}] ${h.why}`);
  console.error('\nSe for falso-positivo, marque a linha como exemplo/placeholder ou ajuste o padrão.');
  return 1;
}

// check rodável: os padrões pegam o que devem e ignoram o que devem
function selftest() {
  const cases = [
    // Fixtures sintéticos: são o alvo do próprio scanner, por isso levam a pragma —
    // sem ela o guard se auto-reprova ao varrer este arquivo.
    ['C:\\Users\\Fulano\\proj', true, 'home windows'], // leakage-guard-allow
    ['contato@empresa.com.br', true, 'email'], // leakage-guard-allow
    ['const k = "sk-abcdefghij0123456789xyz"', true, 'chave openai'], // leakage-guard-allow
    ['ghp_' + 'a'.repeat(36), true, 'pat github'], // leakage-guard-allow
    ['-----BEGIN PRIVATE KEY-----', true, 'chave privada'], // leakage-guard-allow
    ['OneDrive/Documentos/Obsidian Vault', true, 'vault pessoal'], // leakage-guard-allow
    ['// exemplo: C:\\Users\\YOUR_NAME', false, 'placeholder isento'],
    ['email de exemplo: foo@bar.com', false, 'exemplo isento'],
    ['const total = a + b;', false, 'código comum'],
    ['veja https://github.com/org/repo', false, 'url publica'],
    ['<a href="mailto:eu@dominio.com"> <!-- leakage-guard-allow -->', false, 'pragma isenta publicacao deliberada'],
  ];
  let fail = 0;
  for (const [input, shouldHit, label] of cases) {
    const hit = scanText(input).length > 0;
    if (hit !== shouldHit) {
      console.error(`FALHA: "${label}" esperava hit=${shouldHit}, deu ${hit}`);
      fail++;
    }
  }
  const dlHit = scanText('projeto NomeDeCliente aqui', ['NomeDeCliente']).length > 0;
  if (!dlHit) {
    console.error('FALHA: denylist literal não pegou');
    fail++;
  }
  console.log(fail ? `selftest: ${fail} falha(s)` : `selftest: ${cases.length + 1}/${cases.length + 1} ok`);
  return fail ? 1 : 0;
}

const mode = process.argv.includes('--selftest')
  ? selftest
  : process.argv.includes('--authors')
    ? scanAuthors
    : main;
process.exit(mode());
