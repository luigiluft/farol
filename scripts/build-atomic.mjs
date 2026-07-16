// A TORRE - build atomico do web/dist.
//
// Problema (incidente real): `vite build` esvazia web/dist no inicio e escreve
// nele. Um build interrompido (maquina sob carga, processo morto) deixa dist
// SEM index.html -> o servidor :7777 serve 404 enquanto roda.
//
// Fix: builda em web/dist-next; so troca pra dist quando o build teve exit 0
// E produziu web/dist-next/index.html (guard contra sucesso vazio). Falha em
// qualquer etapa -> web/dist fica intocado.
//
// USO:
//   node scripts/build-atomic.mjs   (chamado por `npm run build`, cwd = repo root)
//   TORRE_BUILD_CMD="<cmd>"         override do comando de build (usado pelos checks)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guard contra sucesso vazio: vite pode sair com exit 0 e ainda assim nao ter
// escrito nada util (ex.: outDir errado, build abortado silenciosamente).
export function assertBuildOutput(nextDir) {
  const indexPath = path.join(nextDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`build vazio: ${indexPath} nao existe`);
  }
}

// Rename com retry: renames em dirs servidos/observados (o proprio :7777,
// chokidar, watcher do vite preview) podem dar EPERM/EBUSY/ENOTEMPTY no
// Windows mesmo com o arquivo "livre" um instante depois (precedente:
// server/vault.mjs moveDir). Puro: so retry, sem fallback embutido -- quem
// decide o que fazer quando os retries esgotam e o CALLER (swapDist), pois
// a resposta certa depende de qual rename e (critico ou nao) e do que esta
// ao vivo no momento. Confirmado ao vivo: com o :7777 servindo web/dist, o
// rename critico (dist-next->dist) esgota os 5 retries e continua EPERM.
async function renameWithRetry(from, to, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (!RETRY_CODES.has(err.code)) throw err;
      if (attempt === MAX_RETRIES) {
        console.log(`[build-atomic] rename ${label} esgotou ${MAX_RETRIES} tentativas (${err.code})`);
        throw err;
      }
      console.log(`[build-atomic] rename ${label} falhou (${err.code}), tentativa ${attempt}/${MAX_RETRIES}...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function removeWithRetry(dir) {
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: MAX_RETRIES, retryDelay: RETRY_DELAY_MS });
}

async function walkFiles(dir, base = dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, abs));
    }
  }
  return files;
}

// Overlay: copia srcDir -> dstDir arquivo a arquivo SEM apagar o que ja
// existe em dstDir (assets antigos sem par no src ficam -- inofensivos, o
// index.html novo nao os referencia; limpos no proximo swap por rename
// normal, ja que --emptyOutDir so afeta dist-next, nunca o dist ao vivo) e
// SEM apagar srcDir (quem chama decide quando remover). dstDir e criado se
// nao existir.
//
// Ordena a copia pra index.html DA RAIZ ser o ULTIMO arquivo escrito: como
// os assets do vite sao hasheados por conteudo, o index.html (velho ou
// ausente) que estiver servindo continua funcional enquanto os assets novos
// chegam; o index.html novo so aparece quando todos os assets novos ja estao
// no lugar. Isso evita a janela de 404/parcial que uma copia direta (no
// lugar do rename atomico) reintroduziria.
//
// Retorna a lista ordenada (caminhos relativos a srcDir) dos arquivos
// copiados, na ordem em que foram escritos.
export async function overlayCopy(srcDir, dstDir) {
  const files = await walkFiles(srcDir);
  const ROOT_INDEX = 'index.html';
  const ordered = [
    ...files.filter((f) => f !== ROOT_INDEX),
    ...files.filter((f) => f === ROOT_INDEX),
  ];

  await fsp.mkdir(dstDir, { recursive: true });
  for (const rel of ordered) {
    const to = path.join(dstDir, rel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(path.join(srcDir, rel), to);
  }

  return ordered;
}

// Swap de dist. Ordem:
//
// 1. FAST PATH (inalterado): dist -> dist-old (rename, retries) -> dist-next
//    -> dist (rename, retries). Rename e atomico (mesmo volume): a janela em
//    que "dist" tecnicamente nao existe e so a troca de ponteiro no
//    filesystem, da ordem de microssegundos -- nao um copy recursivo.
//    Sucesso -> remove dist-old best-effort -> done.
//
// 2. Se o rename CRITICO (dist-next -> dist) esgotar os retries (aconteceu
//    ao vivo com o :7777 servindo): RESTORE FIRST. Renomeia dist-old de
//    volta pra dist (retries) -- isso devolve o site ao ar IMEDIATAMENTE com
//    a versao anterior (sao os mesmos handles que impediram a ida, entao a
//    volta tende a funcionar). Se o restore-rename TAMBEM falhar (duplo
//    fault, raro): recria dist via overlayCopy(dist-old -> dist) -- copy, ja
//    que rename nao rolou, mas com index.html por ultimo (ver overlayCopy).
//    Em ambos os casos o site volta a servir a versao anterior.
//
//    Se nao havia dist previo (distMoved=false, primeiro build), nao ha o
//    que restaurar -- segue direto pro passo 3, que cria dist do zero.
//
// 3. SO ENTAO sobrepoe a versao nova no dist AO VIVO: overlayCopy(dist-next
//    -> dist). Nunca copia pra um dist ausente -- e exatamente o bug que
//    esse redesign mata (a versao anterior do fallback fazia fsp.cp direto
//    pra um dist ja renomeado pra fora, recriando a janela de 404/parcial
//    que a feature existe pra evitar).
//
// 4. Remove dist-next e dist-old best-effort no final (rename ja consome
//    dist-next no fast path; no fallback, dist-next e dist-old sao copias
//    residuais que sobram depois do overlay/recreate).
//
// `renameNextToDist` (opcional): injecao pro rename critico, so pra teste --
// permite forcar a falha do passo 1 sem depender de um EPERM real.
//
// Retorna a lista de eventos observados (nome + se dist existia no
// momento) -- usada pelo check pra provar que o overlay so comeca com dist
// ja restaurado (nunca ausente por uma janela observavel).
export async function swapDist(webDir, { renameNextToDist } = {}) {
  const dist = path.join(webDir, 'dist');
  const distNext = path.join(webDir, 'dist-next');
  const distOld = path.join(webDir, 'dist-old');

  const events = [];
  const emit = (name) => events.push({ name, distExists: fs.existsSync(dist) });

  await removeWithRetry(distOld);

  let distMoved = false;
  if (fs.existsSync(dist)) {
    await renameWithRetry(dist, distOld, 'dist->dist-old');
    distMoved = true;
  }

  const criticalRename = renameNextToDist
    ? () => renameNextToDist(distNext, dist)
    : () => renameWithRetry(distNext, dist, 'dist-next->dist');

  try {
    await criticalRename();
    emit('fast-path-ok');
    await removeWithRetry(distOld);
    return events;
  } catch (err) {
    console.error(`[build-atomic] rename critico dist-next->dist falhou apos retries: ${err.message}`);
    emit('critical-rename-failed');
  }

  // Fallback sem janela de 404: RESTORE FIRST (site volta com a versao
  // anterior), SO DEPOIS overlay da versao nova sobre o dist ja ao vivo.
  if (distMoved) {
    try {
      await renameWithRetry(distOld, dist, 'restore dist-old->dist');
      console.error('[build-atomic] restore OK: dist-old->dist (site de volta com a versao anterior)');
      emit('restore-ok');
    } catch (restoreErr) {
      console.error(`[build-atomic] restore-rename tambem falhou (${restoreErr.message}); recriando dist via copy (index.html por ultimo)...`);
      await overlayCopy(distOld, dist);
      console.error('[build-atomic] recriacao via copy OK (site de volta com a versao anterior)');
      emit('recreate-ok');
    }
  }

  console.log('[build-atomic] sobrepondo versao nova no dist ao vivo (overlay, index.html por ultimo)...');
  emit('overlay-start');
  await overlayCopy(distNext, dist);
  console.log('[build-atomic] overlay OK: dist agora serve a versao nova');
  emit('overlay-done');

  try {
    await removeWithRetry(distNext);
  } catch (err) {
    console.log(`[build-atomic] aviso (nao-critico): falha ao remover dist-next residual: ${err.message}`);
  }
  try {
    await removeWithRetry(distOld);
  } catch (err) {
    console.log(`[build-atomic] aviso (nao-critico): falha ao remover dist-old residual: ${err.message}`);
  }
  emit('cleanup-done');

  return events;
}

async function main() {
  const repoRoot = process.cwd();
  const webDir = path.join(repoRoot, 'web');
  const distNext = path.join(webDir, 'dist-next');

  console.log('[build-atomic] build iniciado -> web/dist-next');
  const buildCmd = process.env.TORRE_BUILD_CMD;
  const result = buildCmd
    ? spawnSync(buildCmd, { stdio: 'inherit', shell: true })
    : spawnSync(
        'npm',
        ['--prefix', 'web', 'run', 'build', '--', '--outDir', 'dist-next', '--emptyOutDir'],
        { stdio: 'inherit', shell: true },
      );

  if (result.error) {
    console.error(`[build-atomic] falha ao rodar o build: ${result.error.message}; web/dist intocado`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[build-atomic] build saiu com codigo ${result.status} (signal ${result.signal}); web/dist intocado`);
    process.exit(result.status ?? 1);
  }

  console.log('[build-atomic] build OK, validando saida...');
  try {
    assertBuildOutput(distNext);
  } catch (err) {
    console.error(`[build-atomic] ${err.message}; web/dist intocado`);
    process.exit(1);
  }

  console.log('[build-atomic] saida valida, trocando dist-next -> dist...');
  try {
    await swapDist(webDir);
  } catch (err) {
    console.error(`[build-atomic] swap falhou: ${err.message}`);
    process.exit(1);
  }

  console.log('[build-atomic] dist atualizado com sucesso');
}

function isMainModule() {
  const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
  return invoked === import.meta.url;
}

if (isMainModule()) {
  main();
}
