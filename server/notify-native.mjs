// FAROL - toast nativo do Windows (ownership: agente notify-native).
// Avisa o DONO quando uma sessao Claude vira "esperando voce" (ou "terminou")
// mesmo com o browser FECHADO — o Web Notification do front so cobre a aba
// aberta/minimizada. O hook em server/index.mjs chama checkTransitions(list)
// dentro do watcher de sessions (mesmo callback que ja faz o push SSE), entao
// o custo por ciclo e um diff em memoria; o toast so dispara na BORDA.
//
// Deteccao (espelha isAwaiting do front, web/src/roomData.js):
//   awaiting-de-verdade = awaitingInput===true && state!=='dormindo'.
//   GOTCHA: sessao encerrada vem com awaiting=true porem state='dormindo' —
//   o gate por state evita o falso "esperando voce" no fim de sessao.
// Transicoes notificadas: (a) -> awaiting-de-verdade = "esperando voce";
//   (b) viva(!dormindo) -> dormindo = "terminou". Seed inicial NAO notifica.
// Anti-spam: borda (1x por sessao+tipo por transicao, via edge-trigger sobre o
//   snapshot anterior) + cooldown global de 30s + rajada no mesmo ciclo vira 1
//   resumo ("N sessoes esperando voce"). Limitacao conhecida: transicao que
//   cai dentro do cooldown de 30s e descartada (nudge best-effort; o front
//   cobre o caso de browser aberto).
// Toast: PowerShell 5.1 SEM dependencia externa (Windows.UI.Notifications).
//   Conteudo vem de transcript (NAO-confiavel): nunca interpolado em codigo PS
//   — o script PS e FIXO (via -EncodedCommand) e le titulo/corpo de variaveis
//   de ambiente; o XML e montado aqui com escape rigoroso. Corpo trunca em 80.
// Config: torre/.data/native-toast.json {"enabled":true} (default true se
//   ausente; fs.watch barato no dir). Rota GET/POST /api/native-toast.
// Resiliente por design: qualquer erro vira log e segue — nunca derruba o server.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.mjs';

const COOLDOWN_MS = 30 * 1000; // cooldown global entre toasts (anti-rajada)
const BODY_MAX = 80; // teto do corpo do toast (Lei da casa: conteudo truncado)
const SPAWN_TIMEOUT_MS = 5000; // kill do powershell.exe se travar
const SUMMARY_NAMES_MAX = 4; // nomes listados no corpo do resumo de rajada
// AppId de um app EXISTENTE (o proprio PowerShell): dispara o toast sem
// registrar um AppUserModelID proprio. Limitacao: o toast aparece atribuido ao
// "Windows PowerShell" no Action Center, nao a "FAROL".
const APP_ID =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const CONFIG_FILE = path.join(DATA_DIR, 'native-toast.json');

// ------------------------------------------------- callsign (port do front) ----
// Copia enxuta de web/src/callsigns.js: o server nao tem o modulo do front.
// Usa apenas o SLOT PREFERIDO (hash djb2 -> indice no pool), SEM o registro
// vivo de colisao que o front mantem — deterministico e barato. Consequencia:
// em colisao rara (2 sessoes no mesmo slot) o nome no toast pode divergir do
// nome exibido na UI. Aceitavel para o titulo de um toast.
const CALLSIGN_POOL = [
  'Vega', 'Sirius', 'Lyra', 'Orion', 'Antares', 'Rigel', 'Capella', 'Mira',
  'Polaris', 'Deneb', 'Altair', 'Castor', 'Pollux', 'Spica', 'Aldebaran',
  'Bellatrix', 'Canopus', 'Procyon', 'Atria', 'Alya', 'Nashira', 'Sargas',
  'Alnair', 'Mimosa', 'Acrux', 'Gacrux', 'Avior', 'Izar', 'Kochab', 'Sadr',
  'Tarazed', 'Alcor', 'Mizar', 'Meissa', 'Naos', 'Pavo', 'Phact', 'Wezen',
  'Adhara', 'Maia',
];

function hashId(id) {
  const s = String(id || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

function callsign(id) {
  const key = String(id || '');
  if (!key) return 'Sessao';
  return CALLSIGN_POOL[hashId(key) % CALLSIGN_POOL.length];
}

// ------------------------------------------------------------- diff (puro) ----
// Espelha isAwaiting do front. Gate por state cobre o GOTCHA da sessao
// encerrada (awaiting=true + state=dormindo => NAO e "esperando voce").

function isAwaitingState(s) {
  return s && s.awaitingInput === true && s.state !== 'dormindo';
}

// PURO e testavel: dado o snapshot anterior (Map id -> {awaiting,state}) e a
// lista atual de sessoes, retorna { events, nextMap }. prevMap === null = SEED:
// grava o estado e NAO emite nada. Fora do seed, emite na borda:
//   awaiting: !prevAwaiting && curAwaiting;
//   done:     prevState existente e !dormindo, curState === 'dormindo'.
// (awaiting e done sao mutuamente exclusivos: awaiting exige state!=dormindo.)
export function computeTransitions(prevMap, sessions) {
  const nextMap = new Map();
  const events = [];
  const list = Array.isArray(sessions) ? sessions : [];
  for (const s of list) {
    if (!s || !s.id) continue;
    const cur = { awaiting: isAwaitingState(s), state: s.state };
    nextMap.set(s.id, cur);
    if (prevMap === null) continue; // seed: registra, nao notifica
    const prev = prevMap.get(s.id);
    const prevAwaiting = prev ? prev.awaiting === true : false;
    const prevState = prev ? prev.state : null;
    if (!prevAwaiting && cur.awaiting) events.push(makeEvent('awaiting', s));
    if (prevState && prevState !== 'dormindo' && cur.state === 'dormindo') {
      events.push(makeEvent('done', s));
    }
  }
  return { events, nextMap };
}

function makeEvent(type, s) {
  return {
    id: s.id,
    type,
    // v4: nome logico do payload (topico-N); estrela so como fallback
    callsign: typeof s.name === 'string' && s.name ? s.name : callsign(s.id),
    body: toastBody(s),
  };
}

// Corpo = pergunta pendente (quando ha) OU projeto + ultima acao. Tudo vem
// de transcript (NAO-confiavel): escapado no XML depois.
function toastBody(s) {
  const q = s && typeof s.pendingQuestion === 'string' ? s.pendingQuestion.trim() : '';
  if (q) return truncate(q, BODY_MAX);
  const project = s && s.project ? String(s.project) : '';
  const action = lastActionText(s);
  const joined = [project, action].filter(Boolean).join(' · ');
  return truncate(joined, BODY_MAX);
}

function lastActionText(s) {
  const a = s && s.currentAction;
  if (a && a.tool) return a.target ? `${a.tool}: ${a.target}` : String(a.tool);
  if (s && s.mission) return String(s.mission);
  if (s && s.narrative) return String(s.narrative);
  return '';
}

function truncate(str, max) {
  const t = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

// ------------------------------------------------------- hook + anti-spam ----

let prevMap = null; // null = ainda nao fez seed
let lastToastTs = 0;

// Chamado pelo watcher de sessions (server/index.mjs) a cada mudanca. Nunca
// lanca: erro interno vira log. Atualiza o snapshot ANTES de qualquer gate para
// nao acumular backlog (disable/cooldown nao devem re-disparar depois).
export function checkTransitions(sessions) {
  try {
    const { events, nextMap } = computeTransitions(prevMap, sessions);
    prevMap = nextMap;
    if (events.length === 0) return;
    if (!isEnabled()) return;
    const now = Date.now();
    if (now - lastToastTs < COOLDOWN_MS) return; // cooldown global
    lastToastTs = now;
    fireForEvents(events);
  } catch (err) {
    console.error('[notify-native] checkTransitions:', err.message);
  }
}

// 1 evento => toast especifico; rajada => 1 resumo (prioriza "esperando voce",
// que e o alerta que importa; done-only vira "N sessoes terminaram").
function fireForEvents(events) {
  if (events.length === 1) {
    const e = events[0];
    const title =
      e.type === 'awaiting' ? `${e.callsign} esperando voce` : `${e.callsign} terminou`;
    showToast(title, e.body);
    return;
  }
  const awaiting = events.filter((e) => e.type === 'awaiting');
  const group = awaiting.length > 0 ? awaiting : events;
  const verb = awaiting.length > 0 ? 'esperando voce' : 'terminaram';
  const noun = group.length === 1 ? 'sessao' : 'sessoes';
  const names = group.map((e) => e.callsign).slice(0, SUMMARY_NAMES_MAX).join(', ');
  showToast(`${group.length} ${noun} ${verb}`, truncate(names, BODY_MAX));
}

// ---------------------------------------------------------- toast (PS 5.1) ----
// Script PS FIXO (dado nao-confiavel jamais entra no codigo): titulo/corpo vem
// por env, XML montado aqui com escape rigoroso. -EncodedCommand elimina
// qualquer problema de quoting do arg. Exportado p/ o teste de toast real.

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildToastXml(title, body) {
  const t = xmlEscape(title);
  const b = xmlEscape(body);
  return (
    '<toast><visual><binding template="ToastGeneric">' +
    `<text>${t}</text><text>${b}</text>` +
    '</binding></visual></toast>'
  );
}

const PS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
  '$null=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]',
  '$xml=New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$xml.LoadXml($env:TORRE_TOAST_XML)',
  '$toast=New-Object Windows.UI.Notifications.ToastNotification $xml',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:TORRE_TOAST_APPID).Show($toast)',
].join('\n');
// PowerShell -EncodedCommand espera base64 de UTF-16LE.
const PS_ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

export function showToast(title, body) {
  try {
    const xml = buildToastXml(title, body);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', PS_ENCODED],
      {
        env: { ...process.env, TORRE_TOAST_XML: xml, TORRE_TOAST_APPID: APP_ID },
        windowsHide: true,
        stdio: 'ignore',
      }
    );
    const killer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // processo ja saiu
      }
    }, SPAWN_TIMEOUT_MS);
    killer.unref();
    child.on('exit', () => clearTimeout(killer));
    child.on('error', (err) => {
      clearTimeout(killer);
      console.error('[notify-native] toast falhou:', err.message);
    });
  } catch (err) {
    console.error('[notify-native] toast erro:', err.message);
  }
}

// ---------------------------------------------------------------- config ----
// enabled default true se o arquivo faltar/corromper. Leitura 1x + fs.watch no
// DIR (o arquivo pode nao existir ainda). POST persiste; watch reflete edicao
// externa. Nao criamos o arquivo no load (so no POST).

let enabledCache = true;
let configLoaded = false;
let watchStarted = false;

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    enabledCache = raw && raw.enabled !== false; // qualquer coisa != false => on
  } catch {
    enabledCache = true; // ausente/corrompido => default on
  }
  configLoaded = true;
}

function watchConfig() {
  if (watchStarted) return;
  watchStarted = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const w = fs.watch(DATA_DIR, (_evt, fname) => {
      if (!fname || String(fname) === 'native-toast.json') loadConfig();
    });
    if (typeof w.unref === 'function') w.unref();
    w.on('error', () => {});
  } catch (err) {
    console.error('[notify-native] watch config falhou:', err.message);
  }
}

function ensureConfig() {
  if (configLoaded) return;
  loadConfig();
  watchConfig();
}

function isEnabled() {
  ensureConfig();
  return enabledCache;
}

function persistEnabled(enabled) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled }), 'utf8');
  enabledCache = enabled;
  configLoaded = true;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/native-toast', (req, res) => {
    ensureConfig();
    res.json({ enabled: enabledCache });
  });
  app.post('/api/native-toast', express.json(), (req, res) => {
    const body = req.body || {};
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled deve ser boolean' });
    }
    try {
      persistEnabled(body.enabled);
      res.json({ enabled: enabledCache });
    } catch (err) {
      console.error('[notify-native]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}

// ------------------------------------------------------------- self-test ----
// `node server/notify-native.mjs --selftest` roda o diff puro nos 5 casos do
// SPEC e imprime PASS/FAIL. Sem framework, sem toast real, sem tocar disco.
function runSelfTest() {
  const cases = [
    {
      name: 'seed silencioso',
      prev: null,
      sessions: [{ id: 'a', state: 'ativa', awaitingInput: false }],
      expect: (ev) => ev.length === 0,
    },
    {
      name: 'awaiting novo notifica',
      prev: new Map([['a', { awaiting: false, state: 'ativa' }]]),
      sessions: [{ id: 'a', state: 'ociosa', awaitingInput: true }],
      expect: (ev) => ev.length === 1 && ev[0].type === 'awaiting',
    },
    {
      name: 'awaiting+dormindo NAO',
      prev: new Map([['a', { awaiting: false, state: 'dormindo' }]]),
      sessions: [{ id: 'a', state: 'dormindo', awaitingInput: true }],
      expect: (ev) => ev.length === 0,
    },
    {
      name: 'repeticao NAO',
      prev: new Map([['a', { awaiting: true, state: 'ociosa' }]]),
      sessions: [{ id: 'a', state: 'ociosa', awaitingInput: true }],
      expect: (ev) => ev.length === 0,
    },
    {
      name: 'viva->dormindo = terminou',
      prev: new Map([['a', { awaiting: false, state: 'ativa' }]]),
      sessions: [{ id: 'a', state: 'dormindo', awaitingInput: false }],
      expect: (ev) => ev.length === 1 && ev[0].type === 'done',
    },
  ];
  let ok = true;
  for (const c of cases) {
    const { events } = computeTransitions(c.prev, c.sessions);
    const pass = c.expect(events);
    if (!pass) ok = false;
    const detail = events.map((e) => e.type).join(',') || '(vazio)';
    console.log(`${pass ? 'PASS' : 'FAIL'} - ${c.name} [${detail}]`);
  }
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--selftest')) runSelfTest();
