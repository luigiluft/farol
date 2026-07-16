// FAROL - sprites-crew.jsx (HD, F6): nucleo pixel-art + TRIPULACAO.
// Geracao 4.0 "Torre HD": todos os grids em 2x de resolucao (mesmo
// aspect ratio dos sprites F4 -> layout CSS intacto), outline escuro
// em volta de cada silhueta (legibilidade contra fundo escuro) e
// rampas de 2-3 tons por material (shade/tint computados para cores
// dinamicas de projeto). Avatares 36x28 deterministicos por id:
// 6 tons de pele x 5 cabecas x 4 acessorios x cor de uniforme.
// Poses: typing (2 frames), idle, sleep (cabeca cai 2px), walk
// (2 frames). Contratos CSS preservados: .r-swap-a/.r-swap-b,
// .r-walk. sprites.jsx re-exporta tudo daqui (compat de import).

const C = {
  bg: '#0a0e12',
  panel: '#11161d',
  border: '#1d2630',
  text: '#c9d4dd',
  dim: '#5d6b78',
  accent: '#3ddc84',
  amber: '#ffb454',
  red: '#ff5f56',
  cyan: '#4dd0e1',
};

export const SPRITE_COLORS = C;

// Outline universal dos sprites HD: quase-preto azulado, levemente mais
// escuro que o bg do painel para a silhueta "assentar" em qualquer fundo.
export const OUTLINE = '#05080d';

// ------------------------------------------------------------------
// nucleo: char-grid -> rects + rampas de tom
// ------------------------------------------------------------------

// Converte linhas de caracteres em rects 1px de altura, mesclando
// pixels consecutivos iguais. Caracteres fora da paleta = transparente.
export function pixelRects(rows, palette) {
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (!palette[ch]) {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w += 1;
      rects.push(
        <rect key={`${y}-${x}`} x={x} y={y} width={w} height={1} fill={palette[ch]} />,
      );
      x += w;
    }
  });
  return rects;
}

// Normaliza um grid: toda linha vira a largura da maior (pad com '.').
// Mata a classe inteira de bugs de contagem manual de pixels.
export function norm(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r.length === w ? r : r + '.'.repeat(w - r.length)));
}

export function PixelSprite({ rows, palette, className = '', width = '100%', children, overlay }) {
  const w = rows[0].length;
  const h = rows.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {children}
      {pixelRects(rows, palette)}
      {overlay}
    </svg>
  );
}

// Sprite de 2 frames alternados via CSS (.r-swap-a/.r-swap-b).
export function SwapSprite({ a, b, palette, viewBox, className = '', width = '100%' }) {
  return (
    <svg
      viewBox={viewBox}
      width={width}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <g className="r-swap-a">{pixelRects(a, palette)}</g>
      <g className="r-swap-b">{pixelRects(b, palette)}</g>
    </svg>
  );
}

// hex -> rgba (telas com glow na cor do projeto)
export function hexA(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return `rgba(61, 220, 132, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Rampas: mistura linear da cor com um alvo escuro/claro. Cacheado por
// (hex, fator, direcao) -- o ticker de 1s re-renderiza avatares e isso
// roda em hot path de render.
const toneCache = new Map();

function mixHex(hex, target, f) {
  const key = `${hex}:${target}:${f}`;
  const hit = toneCache.get(key);
  if (hit) return hit;
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return hex;
  const t = [parseInt(target.slice(1, 3), 16), parseInt(target.slice(3, 5), 16), parseInt(target.slice(5, 7), 16)];
  const out = [0, 1, 2].map((i) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return Math.round(c + (t[i] - c) * f);
  });
  const s = `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  toneCache.set(key, s);
  return s;
}

export function shade(hex, f) {
  return mixHex(hex, '#04070b', f);
}

export function tint(hex, f) {
  return mixHex(hex, '#eaf6ff', f);
}

// ------------------------------------------------------------------
// AVATARES HD (36x28, vista de costas)
// ------------------------------------------------------------------

const SKIN_TONES = ['#f2d3b3', '#e2b48e', '#c98e5f', '#a76b3f', '#7c4e2b', '#5a3820'];
const HAIR_COLORS = ['#1c2026', '#3a2a1c', '#6e4a23', '#b08c4f', '#8c9aa6'];
const HELMET_SHELL = '#9fb0bd';
const CAP_COLOR = '#27445c';
const STRAP_COLOR = '#161c23';
const AVATAR_W = 36;
const AVATAR_EMPTY_ROW = '.'.repeat(AVATAR_W);

export const AVATAR_ACCESSORIES = ['headset', 'oculos', 'bone', 'visor'];

export function hashSeed(str) {
  const s = String(str || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Traits deterministicos: mesmo id = mesmo avatar sempre.
export function gerarAvatar(id) {
  const h = hashSeed(id);
  return {
    skin: h % 6,
    hair: Math.floor(h / 6) % 5,
    acc: AVATAR_ACCESSORIES[Math.floor(h / 30) % 4],
    hairColor: Math.floor(h / 120) % HAIR_COLORS.length,
  };
}

// 5 cabecas HD (10 linhas, vista de costas): curto, longo, moicano,
// coque, capacete. H = highlight do cabelo, S = sombra de pele.
const AVATAR_HEADS = [
  norm([
    '............OOOOOOOOOOOO............',
    '...........OHHHHHHHHHHHHO...........',
    '..........OhHHHHHHHHHHHHhO..........',
    '..........OhhhhhhhhhhhhhhO..........',
    '..........OhhhhhhhhhhhhhhO..........',
    '..........OhhhhhhhhhhhhhhO..........',
    '..........OshhhhhhhhhhhhsO..........',
    '...........OShhhhhhhhhhSO...........',
    '.............OSssssssSO.............',
    '..............OssssssO..............',
  ]),
  norm([
    '............OOOOOOOOOOOO............',
    '...........OHHHHHHHHHHHHO...........',
    '..........OhHHHHHHHHHHHHhO..........',
    '.........OhhhhhhhhhhhhhhhhO.........',
    '.........OhhhhhhhhhhhhhhhhO.........',
    '.........OhhhhhhhhhhhhhhhhO.........',
    '.........OhhhhhhhhhhhhhhhhO.........',
    '.........OhhHhhhhhhhhhHhhhO.........',
    '.........OhhhhSssssssShhhhO.........',
    '..........OhhhOssssssOhhhO..........',
  ]),
  norm([
    '................OOOO................',
    '...............OHHHHO...............',
    '...............OhhhhO...............',
    '..........OssssShhhhSssssO..........',
    '..........OssssshhhhsssssO..........',
    '..........OssssshhhhsssssO..........',
    '.........OssssssShhSssssssO.........',
    '...........OSssssssssssSO...........',
    '.............OSssssssSO.............',
    '..............OssssssO..............',
  ]),
  norm([
    '...............OOOOOO...............',
    '..............OHHHHHHO..............',
    '..............OhhhhhhO..............',
    '...........OOhhhhhhhhhhOO...........',
    '..........OhHHHHHHHHHHHHhO..........',
    '..........OhhhhhhhhhhhhhhO..........',
    '..........OshhhhhhhhhhhhsO..........',
    '...........OShhhhhhhhhhSO...........',
    '.............OSssssssSO.............',
    '..............OssssssO..............',
  ]),
  norm([
    '............OOOOOOOOOOOO............',
    '...........OMMMMMMMMMMMMO...........',
    '..........OmMMMMMMMMMMMMmO..........',
    '..........OmmmmmmmmmmmmmmO..........',
    '..........OmmGGGGGGGGGGmmO..........',
    '..........OmmGGGGGGGGGGmmO..........',
    '..........OmmmmmmmmmmmmmmO..........',
    '...........OmmmmmmmmmmmmO...........',
    '.............OmmmmmmmmO.............',
    '..............OssssssO..............',
  ]),
];

// Acessorios como overlay ('.'/linha vazia = mantem o pixel da cabeca).
const ACC_OVERLAYS = {
  headset: [
    '',
    '............bbbbbbbbbbbb............',
    '...........b............b...........',
    '...........b............b...........',
    '.........bbb............bbb.........',
    '.........bbb............bbb.........',
    '.........bbb............bbb.........',
    '',
    '',
    '',
  ],
  oculos: [
    '',
    '',
    '',
    '',
    '..........gggggggggggggggg..........',
    '',
    '',
    '',
    '',
    '',
  ],
  bone: [
    '............OOOOOOOOOOOO............',
    '...........OPPPPPPPPPPPPO...........',
    '..........OpPPPPPPPPPPPPpO..........',
    '..........OppppppppppppppO..........',
    '.........OppppppppppppppppO.........',
    '',
    '',
    '',
    '',
    '',
  ],
  visor: [
    '',
    '',
    '',
    '.........V................V.........',
    '........VV................VV........',
    '.........V................V.........',
    '',
    '',
    '',
    '',
  ],
};

// Corpos HD (18 linhas): sentado typing A/B (cotovelos alternam),
// idle (bracos colados), walk A/B (passada aberta/fechada). A cadeira
// embutida (assento + pedestal + base) mantem o desenho do F4.
const AVATAR_BODY_TYPE_A = norm([
  '..........OUUUUUUUUUUUUUUO..........',
  '.........OuUUUUUUUUUUUUUUuO.........',
  '........OuuuuUUUUUUUUUUuuuuO........',
  '........OuuuuuuuuuuuuuuuuuuO........',
  '........Ouuv.OuuuuuuuuO.vuuO........',
  '........Ouuv.OuuuuuuuuO.vuuO........',
  '........Osuv.OuuuuuuuuO.vusO........',
  '........Oss..OuuvvvvuuO..ssO........',
  '.............OuuuuuuuuO.............',
  '.........OcceeeeeeeeeeeeccO.........',
  '.........OccccccccccccccccO.........',
  '..........OccccccccccccccO..........',
  '................OddO................',
  '................OddO................',
  '................OddO................',
  '.............OddddddddO.............',
  '...........OddddddddddddO...........',
  '....................................',
]);

const AVATAR_BODY_TYPE_B = norm([
  '..........OUUUUUUUUUUUUUUO..........',
  '.........OuUUUUUUUUUUUUUUuO.........',
  '........OuuuuUUUUUUUUUUuuuuO........',
  '........OuuuuuuuuuuuuuuuuuuO........',
  '........Ouuv.OuuuuuuuuO.vuuO........',
  '........Osuv.OuuuuuuuuO.vusO........',
  '........Oss..OuuvvvvuuO..ssO........',
  '.............OuuuuuuuuO.............',
  '.............OuuuuuuuuO.............',
  '.........OcceeeeeeeeeeeeccO.........',
  '.........OccccccccccccccccO.........',
  '..........OccccccccccccccO..........',
  '................OddO................',
  '................OddO................',
  '................OddO................',
  '.............OddddddddO.............',
  '...........OddddddddddddO...........',
  '....................................',
]);

const AVATAR_BODY_IDLE = norm([
  '..........OUUUUUUUUUUUUUUO..........',
  '.........OuUUUUUUUUUUUUUUuO.........',
  '........OuuuuUUUUUUUUUUuuuuO........',
  '........OuuuuuuuuuuuuuuuuuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OsuvuuuuuuuuuuuuvusO........',
  '.........OsuuuuuuuuuuuuuusO.........',
  '.............OuuuuuuuuO.............',
  '.........OcceeeeeeeeeeeeccO.........',
  '.........OccccccccccccccccO.........',
  '..........OccccccccccccccO..........',
  '................OddO................',
  '................OddO................',
  '................OddO................',
  '.............OddddddddO.............',
  '...........OddddddddddddO...........',
  '....................................',
]);

const AVATAR_BODY_WALK_A = norm([
  '..........OUUUUUUUUUUUUUUO..........',
  '.........OuUUUUUUUUUUUUUUuO.........',
  '........OuuuuUUUUUUUUUUuuuuO........',
  '........OuuuuuuuuuuuuuuuuuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OsuvuuuuuuuuuuuuvusO........',
  '.........OuuuuuuuuuuuuuuuuO.........',
  '..........OuuuuuuuuuuuuuuO..........',
  '..........OqqqqO....OqqqqO..........',
  '.........OqqqqO......OqqqqO.........',
  '.........OqqqO........OqqqO.........',
  '........OqqqO..........OqqqO........',
  '.......OFFFFO..........OFFFFO.......',
  '....................................',
  '....................................',
  '....................................',
  '....................................',
]);

const AVATAR_BODY_WALK_B = norm([
  '..........OUUUUUUUUUUUUUUO..........',
  '.........OuUUUUUUUUUUUUUUuO.........',
  '........OuuuuUUUUUUUUUUuuuuO........',
  '........OuuuuuuuuuuuuuuuuuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OuuvuuuuuuuuuuuuvuuO........',
  '........OsuvuuuuuuuuuuuuvusO........',
  '.........OuuuuuuuuuuuuuuuuO.........',
  '..........OuuuuuuuuuuuuuuO..........',
  '..............OqqqOqqqO.............',
  '..............OqqqOqqqO.............',
  '..............OqqqOqqqO.............',
  '..............OqqqOqqqO.............',
  '..............OFFFOFFFO.............',
  '....................................',
  '....................................',
  '....................................',
  '....................................',
]);

function mergeAvatarRow(base, over) {
  if (!over) return base;
  let out = '';
  for (let i = 0; i < base.length; i += 1) {
    out += over[i] && over[i] !== '.' ? over[i] : base[i];
  }
  return out;
}

const avatarRowsCache = new Map();

// Compoe cabeca+acessorio+corpo uma unica vez por combinacao.
// Sleep: cabeca desce 2px sobre os ombros (pescoco some).
function composeAvatarRows(hair, acc, pose) {
  const key = `${hair}:${acc}:${pose}`;
  const hit = avatarRowsCache.get(key);
  if (hit) return hit;
  const over = ACC_OVERLAYS[acc] || [];
  const head = (AVATAR_HEADS[hair] || AVATAR_HEADS[0])
    .map((row, i) => mergeAvatarRow(row, over[i]));
  let out;
  if (pose === 'typing') {
    out = { a: [...head, ...AVATAR_BODY_TYPE_A], b: [...head, ...AVATAR_BODY_TYPE_B] };
  } else if (pose === 'walk') {
    out = { a: [...head, ...AVATAR_BODY_WALK_A], b: [...head, ...AVATAR_BODY_WALK_B] };
  } else if (pose === 'sleep') {
    out = {
      a: [AVATAR_EMPTY_ROW, AVATAR_EMPTY_ROW, ...head.slice(0, 8), ...AVATAR_BODY_IDLE],
      b: null,
    };
  } else {
    out = { a: [...head, ...AVATAR_BODY_IDLE], b: null };
  }
  avatarRowsCache.set(key, out);
  return out;
}

function avatarPalette(t, uniform) {
  const skin = SKIN_TONES[t.skin];
  const hair = HAIR_COLORS[t.hairColor];
  return {
    O: OUTLINE,
    h: hair, H: tint(hair, 0.28),
    s: skin, S: shade(skin, 0.3), k: skin,
    u: uniform, U: tint(uniform, 0.22), v: shade(uniform, 0.32),
    c: '#161e28', e: '#2b3a49', d: '#39434f',
    q: '#454f5b', F: '#222a33',
    m: HELMET_SHELL, M: tint(HELMET_SHELL, 0.3), G: '#10181f',
    b: '#aebcc9', g: STRAP_COLOR, p: CAP_COLOR, P: tint(CAP_COLOR, 0.3),
    V: C.cyan,
  };
}

export function AvatarSprite({ id, uniform = C.cyan, pose = 'typing', className = '', width = '100%' }) {
  const t = gerarAvatar(id);
  const rows = composeAvatarRows(t.hair, t.acc, pose);
  const palette = avatarPalette(t, uniform);
  if (rows.b) {
    return (
      <SwapSprite
        a={rows.a}
        b={rows.b}
        palette={palette}
        viewBox="0 0 36 28"
        className={pose === 'walk' ? `r-walk ${className}`.trim() : className}
        width={width}
      />
    );
  }
  return <PixelSprite rows={rows.a} palette={palette} className={className} width={width} />;
}

// Compat F4: OperatorSprite era o operario generico pre-avatares. So o
// Dossier usa como fallback -- delega pro avatar deterministico.
export function OperatorSprite({ pose = 'typing', tone = C.cyan, className = '', width = '100%' }) {
  return (
    <AvatarSprite id="operador" uniform={tone} pose={pose} className={className} width={width} />
  );
}

// ------------------------------------------------------------------
// MINIONS HD (16x14): 4 chassis x 3 antenas x 8 cores por hash.
// Visor com olhos acesos, pes/esteiras, highlight no topo do chassi.
// ------------------------------------------------------------------

const MINION_COLORS = [
  '#3ddc84', '#4dd0e1', '#ffb454', '#93a8c7',
  '#b48cfa', '#5ea2ff', '#c8e64c', '#ff8a5c',
];

const MINION_ANTENNAS = [
  norm([
    '.......RR.......',
    '.......rr.......',
    '.......rr.......',
    '.......rr.......',
  ]),
  norm([
    '....RR....RR....',
    '....rr....rr....',
    '....rr....rr....',
    '....rr....rr....',
  ]),
  norm([
    '..RR........RR..',
    '...rr......rr...',
    '....rr....rr....',
    '.....rr..rr.....',
  ]),
];

const MINION_CHASSIS = [
  norm([
    '..OOOOOOOOOOOO..',
    '.ObBBBBBBBBBBbO.',
    '.ObeeeeeeeeeebO.',
    '.ObeEeeeeeEeebO.',
    '.ObeeeeeeeeeebO.',
    '.ObbbbbbbbbbbbO.',
    '.ObbbbbbbbbbbbO.',
    '..OOOOOOOOOOOO..',
    '...Obb....bbO...',
    '..Obbb....bbbO..',
  ]),
  norm([
    '.....OOOOOO.....',
    '...OBBBBBBBBO...',
    '..ObBBBBBBBBbO..',
    '..ObeeeeeeeebO..',
    '..ObeEeeeeEebO..',
    '..ObbbbbbbbbbO..',
    '...ObbbbbbbbO...',
    '....OOOOOOOO....',
    '....Obb..bbO....',
    '...Obbb..bbbO...',
  ]),
  norm([
    '..OOOOOOOOOOOO..',
    '.ObBBBBBBBBBBbO.',
    '.ObeeeeeeeeeebO.',
    '.ObEEeeeeeeEEbO.',
    '.ObeeeeeeeeeebO.',
    '.ObeeeeeeeeeebO.',
    '.ObbbbbbbbbbbbO.',
    '..OOOOOOOOOOOO..',
    '...Obb....bbO...',
    '..Obbb....bbbO..',
  ]),
  norm([
    '..OOOOOOOOOOOO..',
    '.ObBBBBBBBBBBbO.',
    '.ObeeeeeeeeeebO.',
    '.ObeEeeeeeEeebO.',
    '.ObbbbbbbbbbbbO.',
    '..OOOOOOOOOOOO..',
    '.OddddddddddddO.',
    '.OdDdDdDdDdDddO.',
    '.OddddddddddddO.',
    '..OOOOOOOOOOOO..',
  ]),
];

export function gerarMinionAvatar(label) {
  const h = hashSeed(label);
  return {
    chassis: h % 4,
    antenna: Math.floor(h / 4) % 3,
    color: MINION_COLORS[Math.floor(h / 12) % MINION_COLORS.length],
  };
}

const minionRowsCache = new Map();

function composeMinionRows(chassis, antenna) {
  const key = `${chassis}:${antenna}`;
  const hit = minionRowsCache.get(key);
  if (hit) return hit;
  const rows = [...MINION_ANTENNAS[antenna], ...MINION_CHASSIS[chassis]];
  minionRowsCache.set(key, rows);
  return rows;
}

function minionPalette(color) {
  return {
    O: OUTLINE,
    r: C.text, R: '#eaf6ff',
    b: color, B: tint(color, 0.3),
    e: '#070c11', E: '#dff1ff',
    d: '#454f5b', D: '#2b333d',
  };
}

export function MinionAvatarSprite({ label, className = '', width = 16 }) {
  const t = gerarMinionAvatar(label);
  const rows = composeMinionRows(t.chassis, t.antenna);
  return (
    <PixelSprite rows={rows} palette={minionPalette(t.color)} className={className} width={width} />
  );
}

// Minion do diorama (RoomScene): mesmo chassi box na cor do projeto pai.
export function MinionSprite({ tone = C.cyan, className = '', width = 22 }) {
  const rows = composeMinionRows(0, 0);
  return (
    <PixelSprite rows={rows} palette={minionPalette(tone)} className={className} width={width} />
  );
}
