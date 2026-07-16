// FAROL - contrato de tema (F7 C1.2). Fonte unica do tema corrente.
// W-SHELL define; Graph/Fleet/Terminal consomem canvasTheme()/getTheme()/
// onThemeChange(). Persistencia em localStorage 'torre.theme'; default LIGHT.
// initTheme() roda 1x no main.jsx ANTES do createRoot (sem flash de tema).
// Troca de tema: setTheme() seta data-theme no <html>, persiste e dispara
// window CustomEvent 'torre-theme' com detail {theme}.

const STORAGE_KEY = 'torre.theme';
const EVENT_NAME = 'torre-theme';
// refactor v2 (2026-07-10): dark editorial vira o default (decisao do Luigi);
// quem tem 'light' persistido segue no light — o toggle continua mandando.
const DEFAULT_THEME = 'dark';
const VALID_THEMES = new Set(['light', 'dark']);

// F-Personalizacao (Frente 2): acento + densidade. Aditivo sobre o tema —
// nao mexe na maquina de no-flash. Acento sobrescreve --accent inline no
// <html> (DOM-only; o canvas mantem sua paleta de tema). Densidade troca
// o atributo data-density (CSS escala --gap/--radius).
const ACCENT_KEY = 'torre.accent';
const DENSITY_KEY = 'torre.density';
const VALID_DENSITY = new Set(['comfortable', 'compact']);
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const CANVAS_FONT = '"JetBrains Mono", Consolas, monospace';

// Paleta canvas por tema (lista de campos FECHADA pelo contrato C1.2).
// dark = valores historicos hardcoded do grafo/frota; light = "mapa estelar
// diurno": ceu azul-papel claro, estrelas em ardosia escura, naves escuras.
export const CANVAS_THEMES = {
  // refactor v2: dark EDITORIAL — void neutro-quente, estrelas familia cream,
  // acentos ambar; azuis frios sairam (viravam ruido contra o cream).
  dark: {
    sky: '#08080a',
    skyDeep: '#060608',
    starFar: '#8d887d',
    starMid: '#b4aea1',
    starNear: '#ece7db',
    dust: '#8d887d',
    comet: '#ece7db',
    constellation: 'rgba(236, 231, 219, 0.05)',
    labelStrong: '#ece7db',
    label: '#b4aea1',
    labelDim: '#6b6459',
    labelStroke: 'rgba(8, 8, 10, 0.85)',
    egoOverlay: 'rgba(6, 6, 8, 0.6)',
    egoLink: 'rgba(217, 167, 95, 0.5)',
    bookBg: 'rgba(12, 12, 16, 0.88)',
    scanLine: '#ece7db',
    orbitRing: '#8d887d',
    hull: '#3a3842',
    hullDark: '#232229',
    hullLight: '#4c4954',
    cockpit: '#ece7db',
    cockpitOff: '#4c4954',
    windowLit: '#f2e8cf',
    cargoOff: '#2c2b32',
    towerLight: '#d9a75f',
    ringIdle: '#d9a75f',
    ringSleep: '#6b6459',
    fallbackShip: '#b4aea1',
    protoLabel: '#cfcabf',
    canvasFont: CANVAS_FONT,
  },
  light: {
    sky: '#dde6f0',
    skyDeep: '#d2dce8',
    starFar: '#9fb0c2',
    starMid: '#7e93a8',
    starNear: '#5d748c',
    dust: '#aebdcc',
    comet: '#46627e',
    constellation: 'rgba(50, 80, 110, 0.08)',
    labelStrong: '#15212e',
    label: '#3a4a5a',
    labelDim: '#67768a',
    labelStroke: 'rgba(238, 243, 248, 0.9)',
    egoOverlay: 'rgba(226, 234, 243, 0.55)',
    egoLink: 'rgba(30, 90, 130, 0.45)',
    bookBg: 'rgba(255, 255, 255, 0.94)',
    scanLine: '#0a7f93',
    orbitRing: '#7e93a8',
    hull: '#33414f',
    hullDark: '#243140',
    hullLight: '#46586c',
    cockpit: '#0f1822',
    cockpitOff: '#8896a6',
    windowLit: '#1c4d66',
    cargoOff: '#9aa8b8',
    towerLight: '#b26c0e',
    ringIdle: '#b26c0e',
    ringSleep: '#8896a6',
    fallbackShip: '#3d6fc2',
    protoLabel: '#3a4a5a',
    canvasFont: CANVAS_FONT,
  },
};

function normalizeTheme(value) {
  return VALID_THEMES.has(value) ? value : DEFAULT_THEME;
}

function readStoredTheme() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null; // storage bloqueado (private mode etc): cai no default
  }
}

function persistTheme(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch (err) {
    // sem storage: tema vive so na sessao corrente
  }
}

// Override de render (F3b): o universo (graph-engine) renderiza SEMPRE dark sem
// flipar o tema global do app. drawFrame seta 'dark' no inicio do frame e limpa
// no fim, entao TODOS os consumidores de canvas (canvasTheme/themeKey/getTheme
// nas stations/frota) leem dark DURANTE o render; o chrome do app (fora do
// frame) segue o tema persistido.
let renderThemeOverride = null;
export function setRenderTheme(t) {
  renderThemeOverride = VALID_THEMES.has(t) ? t : null;
}

// Tema corrente: 'light' | 'dark'. Override de render tem prioridade (so vale
// durante o drawFrame do universo); fora disso, o tema persistido (default light).
export function getTheme() {
  return renderThemeOverride || normalizeTheme(readStoredTheme());
}

// --- acento + densidade (Frente 2) — leitura/escrita generica em storage ---
function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function persist(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (err) {
    // sem storage: vive so na sessao
  }
}

// Acento custom (hex) ou null = usa o --accent do tema.
export function getAccent() {
  const v = readStored(ACCENT_KEY);
  return v && HEX_RE.test(v) ? v : null;
}

export function setAccent(hex) {
  const root = document.documentElement;
  if (typeof hex === 'string' && HEX_RE.test(hex)) {
    root.style.setProperty('--accent', hex);
    persist(ACCENT_KEY, hex);
  } else {
    root.style.removeProperty('--accent');
    persist(ACCENT_KEY, null);
  }
}

// Densidade: 'comfortable' (default, sem atributo) | 'compact'.
export function getDensity() {
  const v = readStored(DENSITY_KEY);
  return VALID_DENSITY.has(v) ? v : 'comfortable';
}

export function setDensity(d) {
  const density = VALID_DENSITY.has(d) ? d : 'comfortable';
  const root = document.documentElement;
  if (density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
  persist(DENSITY_KEY, density);
}

// Seta o atributo no <html>, persiste e avisa os consumidores (canvas
// re-bake, xterm re-theme) via CustomEvent 'torre-theme'.
export function setTheme(t) {
  const theme = normalizeTheme(t);
  document.documentElement.setAttribute('data-theme', theme);
  persistTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { theme } }));
}

// Chamado 1x no main.jsx ANTES do render: aplica o tema persistido (ou o
// default light) no <html> sem disparar evento (ninguem montou ainda).
export function initTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', getTheme());
  // Aplica acento + densidade persistidos no boot (sem flash).
  const accent = getAccent();
  if (accent) root.style.setProperty('--accent', accent);
  if (getDensity() === 'compact') root.setAttribute('data-density', 'compact');
}

// Assina trocas de tema. cb(theme:string). Retorna unsubscribe.
export function onThemeChange(cb) {
  if (typeof cb !== 'function') return () => {};
  function handler(ev) {
    const theme = ev && ev.detail && VALID_THEMES.has(ev.detail.theme)
      ? ev.detail.theme
      : getTheme();
    cb(theme);
  }
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

// Paleta canvas do tema CORRENTE (1 lookup por frame/bake, nunca por item).
export function canvasTheme() {
  return CANVAS_THEMES[getTheme()] || CANVAS_THEMES[DEFAULT_THEME];
}
