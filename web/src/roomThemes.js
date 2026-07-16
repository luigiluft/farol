// FAROL - roomThemes.js (v5 salas temáticas por projeto).
// Mapa PROJETO -> TEMA da sala. Cada empresa conhecida ganha uma identidade
// (cor + prop de parede + 2 props de chão + selo de marca opcional); projeto
// novo/desconhecido cai no tema NEUTRO (estação genérica). Barato de manter:
// 1 entrada por empresa. Só os 3 temas VALIDADOS visualmente com o dono
// (2026-06-23) estão ativos; os demais ficam no neutro até serem aprovados.
//
// O match é por nome normalizado (minúsculo, sem acento) com `includes`, então
// "Loja Aurora" / "loja" / "LOJA" caem todos no tema loja.
import {
  RouteMap, Pallet, PlantProp,
  Leaderboard, GolfBag, PuttGreen,
  NFe, PosTerminal, ShopShelf, BrTag,
  CrateProp, NeutralBoard,
} from './theme-props.jsx';

// Tema neutro: usado como base e como fallback. Sem brand.
const NEUTRAL = {
  key: 'neutro',
  accent: null, // null => usa projectColor(name) (hash estável da paleta)
  wall: NeutralBoard,
  floorL: CrateProp,
  floorR: null,
  brand: null,
};

// Temas validados (faithful à simulação v5). accent fixo = o que o dono
// aprovou vendo o mock (não o hash da paleta). Ajuste `match` para os nomes
// dos seus próprios projetos.
const THEMES = [
  {
    key: 'loja',
    match: ['loja', 'aurora'],
    accent: '#3ddc84',
    wall: RouteMap,
    floorL: Pallet,
    floorR: PlantProp,
    brand: null,
  },
  {
    key: 'zen',
    match: ['zen'],
    accent: '#4dd0e1',
    wall: Leaderboard,
    floorL: GolfBag,
    floorR: PuttGreen,
    brand: null,
  },
  {
    key: 'blog',
    match: ['blog'],
    accent: '#b48cfa',
    wall: NFe,
    floorL: PosTerminal,
    floorR: ShopShelf,
    brand: BrTag,
  },
];

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Retorna o tema da sala para um nome de projeto. Sempre retorna um objeto
// (nunca null): projeto sem tema casa no NEUTRO.
export function themeFor(projectName) {
  const n = normalize(projectName);
  for (const t of THEMES) {
    if (t.match.some((m) => n.includes(m))) return t;
  }
  return NEUTRAL;
}

// true quando o projeto tem identidade própria (não-neutro). Útil pra decidir
// se mostra o selo/brand ou trata como sala genérica.
export function hasTheme(projectName) {
  return themeFor(projectName).key !== 'neutro';
}
