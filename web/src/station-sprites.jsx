// FAROL - station-sprites.jsx (HD, F6; F7 C6 tema claro + wow).
// Geracao 4.0 "Torre HD": todos os grids em 2x de resolucao (mesmo
// aspect ratio do F5.10 -> posicionamento CSS intacto), outline escuro
// e rampas de tom. Nucleo pixel-art importado de sprites-crew.jsx.
// F7: casco/mobilia agora pintam com var(--st-*) (definidas em
// scene.css, dark+light) -- SVG inline herda CSS vars nos fills.
// tint/shade so operam em hex, entao derivados de token viram
// color-mix (helpers mixUp/mixDn). Avatares/peles NAO mudam.
// Contratos de CSS preservados (animacao vive em scene.css/room.css):
// - SteamPuffs emite spans .st-steam SEM delay inline quando delay=0;
// - ViewportWindow emite .st-stars-a/.st-stars-b duplicados com offset
//   de 240 unidades (keyframe st-drift translada exatamente -240px);
// - HoloTableSprite emite .st-holo-orbit > .st-holo-dot;
// - SleepPodSprite emite .st-podshell > .st-pod-back/-body/-glass.
import {
  OUTLINE, norm, PixelSprite, SwapSprite, tint, shade,
} from './sprites-crew.jsx';

const HULL_DARK = 'var(--st-hull-dark, #1d2630)';
const HULL_MID = 'var(--st-hull-mid, #2a3742)';
const HULL_LIGHT = 'var(--st-hull-light, #384757)';
const RIVET = 'var(--st-rivet, #5d6b78)';
const PAD = 'var(--st-pad, #232c36)';
const PAD_HI = 'var(--st-pad-hi, #2e3a47)';
const ST_OUTLINE = 'var(--st-outline, #05080d)';
const GREEN = 'var(--accent, #3ddc84)';
const CYAN = 'var(--cyan, #4dd0e1)';
const AMBER = 'var(--amber, #ffb454)';
const WHITE = 'var(--st-white, #f4fbff)';
const GLASS = 'var(--st-glass, rgba(127, 214, 232, 0.18))';
const GLASS_EDGE = 'var(--st-glass-edge, rgba(127, 214, 232, 0.38))';
const LEAF = '#3ddc84';
const LEAF_DARK = '#1f7a4d';
const SOIL = '#3a2d22';

// Derivados de token: tint/shade (sprites-crew) exigem hex literal;
// para valores var(--st-*) o claro/escuro vira color-mix estatico.
const mixUp = (c, pct) => `color-mix(in srgb, #eaf6ff ${pct}%, ${c})`;
const mixDn = (c, pct) => `color-mix(in srgb, #04070b ${pct}%, ${c})`;

const dots = (n) => '.'.repeat(n);
const rep = (ch, n) => ch.repeat(n);

// ----------------------------------------------------------------
// Cadeira gamer HD: front 28x36 (encosto alto com costuras na cor,
// apoio de cabeca, bracos, base estrela) | side 20x36 (perfil).
// ----------------------------------------------------------------

const CHAIR_BACK_PLAIN = '.....OmhhhhhhhhhhhhhhmO.....';
const CHAIR_BACK_BAND = '.....OmhhcccccccccchhmO.....';

const CHAIR_FRONT = norm([
  '........OOOOOOOOOOOO........',
  '.......OcCCCCCCCCCCcO.......',
  '......OchhhhhhhhhhhhcO......',
  '......OchhhhhhhhhhhhcO......',
  '.....OOmhhhhhhhhhhhhmOO.....',
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_BAND,
  CHAIR_BACK_BAND,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_BAND,
  CHAIR_BACK_BAND,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_BAND,
  CHAIR_BACK_BAND,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  CHAIR_BACK_PLAIN,
  '.....OmmhhhhhhhhhhhhmmO.....',
  '..Orr.OmhhhhhhhhhhhhmO.rrO..',
  '..Orr.OmhhhhhhhhhhhhmO.rrO..',
  '..OrrrOmmmmmmmmmmmmmmOrrrO..',
  '....OmssssssssssssssssmO....',
  '....OmssssssssssssssssmO....',
  '.....OOOOOOOOOOOOOOOOOO.....',
  '............OrrO............',
  '............OrrO............',
  '.......OrrrrrrrrrrrrO.......',
  '.....OrrRrrrrrrrrrrRrrO.....',
]);

const CHAIR_SIDE_PLAIN = '.OmhhhhmO...........';
const CHAIR_SIDE_BAND = '.OmccccmO...........';

const CHAIR_SIDE = norm([
  '..OOOOOO............',
  '.OcCCCCcO...........',
  '.OchhhhcO...........',
  '.OchhhhcO...........',
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_BAND,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  CHAIR_SIDE_PLAIN,
  '.OmhhhhmOOOO........',
  '.OmhhhhmssssOOOO....',
  '.OmhhhhmssssssssOO..',
  '.OmmmmmmssssssssssO.',
  '..OOOOOOOOOOOOOOOOO.',
  '.........OrrO.......',
  '.........OrrO.......',
  '......OrrrrrrrrO....',
  '.....OrrrrrrrrrrO...',
  '....................',
  '....................',
]);

export function GamerChairSprite({ color, side = false }) {
  const c = color || '#3ddc84';
  const palette = {
    O: ST_OUTLINE,
    c, C: tint(c, 0.3),
    h: PAD, m: HULL_MID,
    s: HULL_DARK,
    r: RIVET, R: mixUp(RIVET, 35),
  };
  // Sem className de layout no svg: .st-chair e classe de POSICIONAMENTO
  // dos wrappers (scene.css/room.css); o sprite nao pode reivindica-la.
  return (
    <PixelSprite
      rows={side ? CHAIR_SIDE : CHAIR_FRONT}
      palette={palette}
    />
  );
}

// ----------------------------------------------------------------
// Mesa de estacao HD 72x48: 2-3 monitores com codigo na cor do
// projeto (terceiro monitor = dashboard ambar), bracos, tampo com
// teclado e caneca, pernas metalicas.
// ----------------------------------------------------------------

// Conteudo das telas (F7 fix): LINHAS de codigo estilo terminal --
// barras horizontais de comprimento variado em 2 tons (x = cor do
// projeto, g = cinza) com indentacao, estaticas. O speckle aleatorio
// anterior lia como estatica de TV. y = barras ambar do dashboard.
const SIDE_CODE = [
  'xxxxxx.....', '...........', '..gggg.....', '..xxxxxxx..',
  '...........', 'gggggg.....', '..xxxx.....', '...........',
  '..ggggggg..', 'xxxx.......',
];
const MID_CODE = [
  'xxxxxxxx............', '....................', '..gggggggggg........',
  '..xxxxx.............', '....................', '....gggggggggg......',
  '....xxxxxxx.........', '....................', 'gggggg..............',
  'xxxxxxxxxxx.........',
];
const DASH_BARS = [
  'yyyyyyy....', '...........', 'yyyy.......', '...........',
  'yyyyyyyyy..', '...........', 'yyyyy......', '...........',
  'yyyyyyyy...', '...........',
];

function monitor(inner, content, row) {
  if (row === 'top' || row === 'bottom') return rep('O', inner + 4);
  if (row === 'bezel') return 'O' + rep('b', inner + 2) + 'O';
  // '.' no conteudo = fundo de tela (s), nunca transparente
  return 'Ob' + content.replace(/\./g, 's') + 'bO';
}

function stationDeskRows(monitors) {
  const three = monitors >= 3;
  const out = [];
  for (let r = 0; r < 14; r += 1) {
    const kind = r === 0 ? 'top' : r === 1 ? 'bezel' : r === 12 ? 'bezel' : r === 13 ? 'bottom' : 'screen';
    const i = r - 2;
    if (three) {
      const L = monitor(11, SIDE_CODE[i] || rep('.', 11), kind);
      const M = monitor(20, MID_CODE[i] || rep('.', 20), kind);
      const R = monitor(11, DASH_BARS[i] || rep('.', 11), kind);
      out.push(dots(2) + L + dots(3) + M + dots(3) + R + dots(10));
    } else {
      const A = monitor(20, MID_CODE[i] || rep('.', 20), kind);
      const B = monitor(20, MID_CODE[(i + 3) % 10] || rep('.', 20), kind);
      out.push(dots(8) + A + dots(4) + B + dots(12));
    }
  }
  const arm = three
    ? dots(8) + 'pp' + dots(21) + 'pp' + dots(20) + 'pp' + dots(17)
    : dots(19) + 'pp' + dots(26) + 'pp' + dots(23);
  out.push(arm, arm);
  out.push(dots(72), dots(72));
  // tampo: highlight, corpo com teclado (cols 4-19) e caneca (46-51)
  out.push(rep('M', 64) + dots(8));
  out.push('m' + rep('l', 62) + 'm' + dots(8));
  out.push('m' + rep('l', 3) + rep('K', 16) + rep('l', 26) + 'OOOOOO' + rep('l', 11) + 'm' + dots(8));
  out.push('m' + rep('l', 3) + 'K' + rep('kK', 7) + 'K' + rep('l', 26) + 'O' + 'CCCC' + 'O' + rep('l', 11) + 'm' + dots(8));
  out.push('m' + rep('l', 3) + 'K' + rep('kk', 7) + 'K' + rep('l', 26) + 'O' + 'aAAa' + 'O' + rep('l', 11) + 'm' + dots(8));
  out.push('m' + rep('l', 3) + rep('K', 16) + rep('l', 26) + 'OOOOOO' + rep('l', 11) + 'm' + dots(8));
  out.push('m' + rep('l', 62) + 'm' + dots(8));
  out.push(rep('m', 64) + dots(8));
  // pernas
  const leg = dots(2) + 'OrrO' + dots(52) + 'OrrO' + dots(2) + dots(8);
  for (let r = 0; r < 13; r += 1) out.push(leg);
  out.push(dots(1) + 'OrrrrO' + dots(50) + 'OrrrrO' + dots(1) + dots(8));
  for (let r = 0; r < 6; r += 1) out.push(dots(72));
  return norm(out);
}

// screen: 'on' (ativa) | 'dim' (ociosa, standby) | 'off' (dormindo).
// Refino anti-ruido: o conteudo vivo das telas (accent + ambar) e
// EXCLUSIVO da mesa ativa -- tela acesa vira sinal de trabalho real;
// antes todas as 8 mesas brilhavam igual e nada se destacava.
export function StationDeskSprite({ color, monitors = 2, screen = 'on' }) {
  const c = color || '#3ddc84';
  const lit = screen === 'on';
  const dim = screen === 'dim';
  const DIM_BAR = '#3d4d5c';
  const DIM_TXT = '#33414f';
  const OFF = '#141c25';
  // telas dos monitores continuam dark nos 2 temas (b/s fixos)
  const palette = {
    O: ST_OUTLINE,
    b: '#26323f', s: lit ? '#0d1217' : dim ? '#0b1015' : '#0a0e13',
    x: lit ? c : dim ? DIM_BAR : OFF,
    X: lit ? tint(c, 0.45) : dim ? DIM_BAR : OFF,
    g: lit ? '#5d7488' : dim ? DIM_TXT : OFF,
    y: lit ? AMBER : dim ? DIM_TXT : OFF,
    p: RIVET,
    M: mixUp(HULL_LIGHT, 12), m: HULL_MID, l: HULL_DARK,
    K: '#26323f', k: PAD_HI,
    a: AMBER, A: mixUp(AMBER, 40), C: '#3a2616',
    r: RIVET,
  };
  return <PixelSprite rows={stationDeskRows(monitors)} palette={palette} className="st-desk" />;
}

// ----------------------------------------------------------------
// Area de cafe HD 68x52: prateleira com 3 canecas, maquina espresso
// com display, LED e bandeja, mini geladeira com ima, balcao com
// portas e pes.
// ----------------------------------------------------------------

// Linha combinada maquina (25 cols a partir da col 4) + geladeira
// (21 cols a partir da col 38). null = segmento vazio.
function coffeeRow(mach, fridge) {
  return dots(4) + (mach || dots(25)) + dots(9) + (fridge || dots(21)) + dots(9);
}

const MACH_BODY = 'O' + rep('m', 23) + 'O';
const FRIDGE_BODY = 'O' + rep('h', 19) + 'O';
const FRIDGE_HANDLE = 'O' + 'r' + rep('h', 18) + 'O';

const COFFEE_ROWS = norm([
  dots(6) + 'OWWO.OWWO.OWWO' + dots(48),
  dots(6) + 'OWWO.OWWO.OWWO' + dots(48),
  dots(6) + 'OWWO.OWWO.OWWO' + dots(48),
  dots(4) + rep('r', 20) + dots(44),
  dots(5) + 'r' + dots(11) + 'r' + dots(50),
  dots(68),
  dots(68),
  dots(68),
  coffeeRow(rep('O', 25), null),
  coffeeRow('O' + rep('M', 23) + 'O', null),
  coffeeRow(MACH_BODY, null),
  coffeeRow('O' + 'm' + 'g' + rep('m', 21) + 'O', null),
  coffeeRow(MACH_BODY, rep('O', 21)),
  coffeeRow(MACH_BODY, 'O' + rep('H', 19) + 'O'),
  coffeeRow('O' + rep('m', 7) + 'WWWW' + rep('m', 12) + 'O', FRIDGE_BODY),
  coffeeRow('O' + rep('m', 7) + 'WWWW' + rep('m', 12) + 'O', 'O' + 'hhhhh' + 'c' + rep('h', 13) + 'O'),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow('O' + rep('m', 8) + 'OOO' + rep('m', 12) + 'O', FRIDGE_BODY),
  coffeeRow('O' + rep('m', 9) + 'O' + rep('m', 13) + 'O', 'O' + rep('m', 19) + 'O'),
  coffeeRow('O' + rep('m', 9) + 'W' + rep('m', 13) + 'O', FRIDGE_HANDLE),
  coffeeRow('O' + rep('m', 8) + 'aWa' + rep('m', 12) + 'O', FRIDGE_HANDLE),
  coffeeRow('O' + rep('m', 8) + 'OOO' + rep('m', 12) + 'O', FRIDGE_HANDLE),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow('O' + rep('r', 23) + 'O', FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(MACH_BODY, FRIDGE_BODY),
  coffeeRow(rep('O', 25), rep('O', 21)),
  rep('B', 64) + dots(4),
  'B' + rep('p', 62) + 'B' + dots(4),
  'B' + 'p' + 'O' + rep('p', 27) + 'O' + 'pp' + 'O' + rep('p', 27) + 'O' + 'p' + 'B' + dots(4),
  'B' + 'p' + 'O' + rep('p', 12) + 'rr' + rep('p', 13) + 'O' + 'pp' + 'O' + rep('p', 12) + 'rr' + rep('p', 13) + 'O' + 'p' + 'B' + dots(4),
  'B' + 'p' + 'O' + rep('p', 27) + 'O' + 'pp' + 'O' + rep('p', 27) + 'O' + 'p' + 'B' + dots(4),
  'B' + rep('p', 62) + 'B' + dots(4),
  rep('B', 64) + dots(4),
  dots(2) + 'OrrO' + dots(52) + 'OrrO' + dots(2) + dots(4),
  dots(2) + 'OrrO' + dots(52) + 'OrrO' + dots(2) + dots(4),
  dots(2) + 'OrrO' + dots(52) + 'OrrO' + dots(2) + dots(4),
  dots(1) + 'OrrrrO' + dots(50) + 'OrrrrO' + dots(1) + dots(4),
  ...Array(9).fill(dots(68)),
]);

export function CoffeeBarSprite() {
  const palette = {
    O: ST_OUTLINE,
    r: RIVET, a: AMBER, g: GREEN, c: CYAN,
    m: HULL_MID, M: mixUp(HULL_MID, 30),
    W: WHITE,
    h: HULL_LIGHT, H: mixUp(HULL_LIGHT, 30),
    B: mixUp(HULL_LIGHT, 15), p: PAD,
  };
  return <PixelSprite rows={COFFEE_ROWS} palette={palette} className="st-coffee" />;
}

// Vapor: 3 spans .st-steam animados pelo CSS do consumidor (visual base
// + stagger nth-of-type em scene.css; o deck re-escopa via .desk-steam).
// delay e em MS (consumidores passam 0/350/500/1050). delay=0 nao emite
// style inline (preserva o stagger via nth-of-type do room.css/S3);
// delay>0 vira animation-delay inline somado por slot (+900ms cada).
export function SteamPuffs({ delay = 0 }) {
  const d = Number(delay) || 0;
  const slots = [0, 1, 2];
  return (
    <span className="st-steam-wrap" aria-hidden="true">
      {slots.map((i) => (
        <span
          key={i}
          className="st-steam"
          style={d > 0 ? { animationDelay: `${d + i * 900}ms` } : undefined}
        />
      ))}
    </span>
  );
}

// ----------------------------------------------------------------
// Lounge HD: sofa curvo 60x28, planta monstera 20x32, luminaria 16x36.
// ----------------------------------------------------------------

const COUCH_ROWS = norm([
  dots(4) + rep('O', 52) + dots(4),
  dots(3) + 'O' + rep('H', 52) + 'O' + dots(3),
  dots(2) + 'O' + 'h' + rep('p', 52) + 'h' + 'O' + dots(2),
  '.O' + 'h' + rep('p', 54) + 'h' + 'O.',
  '.O' + 'h' + rep('p', 16) + 'qq' + rep('p', 18) + 'qq' + rep('p', 16) + 'h' + 'O.',
  '.O' + 'h' + rep('p', 4) + 'O' + rep('x', 8) + 'O' + rep('p', 2) + 'qq' + rep('p', 18) + 'qq' + rep('p', 2) + 'O' + rep('y', 8) + 'O' + rep('p', 4) + 'h' + 'O.',
  '.O' + 'h' + rep('p', 4) + 'O' + rep('x', 8) + 'O' + rep('p', 26) + 'O' + rep('y', 8) + 'O' + rep('p', 4) + 'h' + 'O.',
  '.O' + 'h' + rep('p', 4) + 'O' + rep('x', 8) + 'O' + rep('p', 26) + 'O' + rep('y', 8) + 'O' + rep('p', 4) + 'h' + 'O.',
  '.O' + 'h' + rep('p', 54) + 'h' + 'O.',
  '.OHhO' + rep('P', 50) + 'OhHO.',
  '.OHhO' + rep('P', 23) + 'qq' + rep('P', 25) + 'OhHO.',
  '.OHhO' + rep('P', 23) + 'qq' + rep('P', 25) + 'OhHO.',
  '.OHhO' + rep('P', 50) + 'OhHO.',
  '.O' + rep('h', 56) + 'O.',
  '.O' + rep('h', 56) + 'O.',
  dots(2) + rep('O', 56) + dots(2),
  dots(6) + 'OrrO' + dots(40) + 'OrrO' + dots(6),
  dots(6) + 'OrrO' + dots(40) + 'OrrO' + dots(6),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
  dots(60),
]);

export function CouchSprite() {
  const palette = {
    O: ST_OUTLINE,
    h: HULL_MID, H: mixUp(HULL_MID, 30),
    p: PAD, P: PAD_HI, q: mixDn(PAD, 40),
    x: '#c98a45', y: '#3f9aa8',
    r: RIVET,
  };
  return <PixelSprite rows={COUCH_ROWS} palette={palette} className="st-couch" />;
}

const PLANT_ROWS = norm([
  '......OOOOOO........',
  '....OOffffffOO......',
  '...OffFFffffffO.....',
  '..OffFFffdfffffO....',
  '..OffffffdffffffO...',
  '.OffdffffdfffdfffO..',
  '.OfffdffffffdffffO..',
  '.OffffdfffdffffffO..',
  '.OfffffdffdffffffO..',
  '.OffffffddfffffffO..',
  '..OfffffddffffffO...',
  '..OfffffddfffffO....',
  '...OffffddffffO.....',
  '....OOffddffOO......',
  '......OOddOO........',
  '.......OddO.........',
  '.......OddO.........',
  '.......OddO.........',
  '....OOOOOOOOOO......',
  '...OMssssssssMO.....',
  '...OmMMMMMMMMmO.....',
  '...OmmmmmmmmmmO.....',
  '....OmmmmmmmmO......',
  '....OmmmmmmmmO......',
  '....OmmmmmmmmO......',
  '.....OOOOOOOO.......',
  dots(20),
  dots(20),
  dots(20),
  dots(20),
  dots(20),
  dots(20),
]);

export function PlantSprite() {
  const palette = {
    O: ST_OUTLINE,
    f: LEAF, F: tint(LEAF, 0.35), d: LEAF_DARK,
    m: HULL_MID, M: mixUp(HULL_MID, 25), s: SOIL,
  };
  return <PixelSprite rows={PLANT_ROWS} palette={palette} className="st-plant" />;
}

const LAMP_POLE = '.......OrO......';

const LAMP_ROWS = norm([
  '....OOOOOOOO....',
  '...OaAAAAAAaO...',
  '..OaAWWWWWWAaO..',
  '..OaWWWWWWWWaO..',
  '..OaWWWWWWWWaO..',
  '..OaaWWWWWWaaO..',
  '...OaaaaaaaaO...',
  '....OOOOOOOO....',
  ...Array(22).fill(LAMP_POLE),
  '......OrrrO.....',
  '....OrrrrrrrO...',
  '...OrrrrrrrrrO..',
  '...OOOOOOOOOOO..',
  dots(16),
  dots(16),
]);

export function FloorLampSprite() {
  const palette = {
    O: ST_OUTLINE,
    a: '#7a5a2a', A: AMBER, W: mixUp(AMBER, 45),
    r: RIVET,
  };
  return <PixelSprite rows={LAMP_ROWS} palette={palette} className="st-lamp" />;
}

// ----------------------------------------------------------------
// Holotable HD 48x36: tampo de vidro com lente do projetor + pedestal;
// orbita de dots coloridos por cima (rotacao no CSS via .st-holo-orbit;
// cada dot tem transform ESTATICO inline de posicionamento radial).
// ----------------------------------------------------------------

const HOLO_RING = 'lg'.repeat(21);

const HOLO_ROWS = norm([
  ...Array(12).fill(dots(48)),
  dots(2) + rep('O', 44) + dots(2),
  '.O' + rep('M', 44) + 'O.',
  '.OM' + rep('l', 19) + 'PPPP' + rep('l', 19) + 'MO.',
  '.Om' + HOLO_RING + 'mO.',
  '.O' + rep('m', 44) + 'O.',
  dots(2) + rep('O', 44) + dots(2),
  dots(18) + 'OrrrrrrrrrrO' + dots(18),
  dots(19) + 'OrrrrrrrrO' + dots(19),
  dots(20) + 'OrrrrrrO' + dots(20),
  dots(20) + 'OrrrrrrO' + dots(20),
  dots(20) + 'OrrrrrrO' + dots(20),
  dots(20) + 'OrrrrrrO' + dots(20),
  dots(18) + 'OrrrrrrrrrrO' + dots(18),
  dots(16) + 'OrrrrrrrrrrrrrrO' + dots(16),
  dots(15) + rep('O', 18) + dots(15),
  ...Array(9).fill(dots(48)),
]);

export function HoloTableSprite({ colors = ['#3ddc84', '#4dd0e1', '#ffb454'] }) {
  const palette = {
    O: ST_OUTLINE,
    M: mixUp(HULL_LIGHT, 20), m: HULL_LIGHT, l: HULL_DARK,
    g: GLASS_EDGE, P: mixUp(CYAN, 30),
    r: RIVET,
  };
  const dotsList = (colors && colors.length ? colors : ['#3ddc84']).slice(0, 6);
  return (
    <span className="st-holotable" aria-hidden="true">
      <PixelSprite rows={HOLO_ROWS} palette={palette} className="st-holo-base" />
      <span className="st-holo-orbit">
        {dotsList.map((c, i) => (
          <i
            key={i}
            className="st-holo-dot"
            style={{
              background: c,
              transform: `rotate(${Math.round((i / dotsList.length) * 360)}deg) translateX(${7 + (i % 3) * 3}px)`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

// ----------------------------------------------------------------
// Sleep pod HD 60x32: casco com rim duplo, interior escuro com
// travesseiro, strip de LED na cor, tampa de vidro com brilho.
// occupied=false: tampa recolhida e LED apagado. children = avatar
// deitado (LyingAvatar), camada .st-pod-body.
// ----------------------------------------------------------------

const POD_INNER = '.OmO' + rep('s', 52) + 'OmO.';
const POD_PILLOW = '.OmO' + rep('w', 8) + rep('s', 44) + 'OmO.';

const POD_BACK_ROWS = norm([
  dots(3) + rep('O', 54) + dots(3),
  dots(2) + 'O' + rep('M', 54) + 'O' + dots(2),
  dots(1) + 'O' + 'M' + rep('m', 54) + 'M' + 'O' + dots(1),
  '.O' + 'm' + rep('O', 54) + 'm' + 'O.',
  POD_INNER,
  POD_PILLOW,
  POD_PILLOW,
  POD_PILLOW,
  POD_PILLOW,
  POD_PILLOW,
  POD_PILLOW,
  POD_INNER,
  POD_INNER,
  POD_INNER,
  POD_INNER,
  POD_INNER,
  POD_INNER,
  '.O' + 'm' + rep('O', 54) + 'm' + 'O.',
  dots(1) + 'O' + 'M' + rep('m', 54) + 'M' + 'O' + dots(1),
  dots(2) + 'O' + rep('c', 54) + 'O' + dots(2),
  dots(3) + rep('O', 54) + dots(3),
  dots(5) + 'OrrO' + dots(42) + 'OrrO' + dots(5),
  dots(5) + 'OrrO' + dots(42) + 'OrrO' + dots(5),
  ...Array(9).fill(dots(60)),
]);

const POD_GLASS_WALL = dots(4) + 'g' + dots(50) + 'g' + dots(4);

const POD_GLASS_CLOSED = norm([
  dots(60),
  dots(60),
  dots(6) + rep('g', 48) + dots(6),
  POD_GLASS_WALL,
  dots(4) + 'g' + '.GG' + dots(47) + 'g' + dots(4),
  dots(4) + 'g' + '..GG' + dots(46) + 'g' + dots(4),
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  POD_GLASS_WALL,
  dots(6) + rep('g', 48) + dots(6),
  ...Array(15).fill(dots(60)),
]);

const POD_GLASS_OPEN = norm([
  dots(4) + rep('g', 22) + dots(34),
  dots(4) + 'g' + dots(20) + 'g' + dots(34),
  dots(4) + 'g' + dots(20) + 'g' + dots(34),
  dots(4) + rep('g', 22) + dots(34),
  ...Array(28).fill(dots(60)),
]);

export function SleepPodSprite({ color, occupied = false, children }) {
  // interior da capsula segue escuro nos 2 temas (e um dormitorio)
  const backPalette = {
    O: ST_OUTLINE,
    m: HULL_MID, M: mixUp(HULL_MID, 30),
    s: '#0d1217', w: HULL_LIGHT,
    c: occupied ? color || GREEN : HULL_DARK,
    r: RIVET,
  };
  const glassRows = occupied ? POD_GLASS_CLOSED : POD_GLASS_OPEN;
  // Wrapper e .st-podshell (NAO .st-pod: essa classe e o container
  // posicionado do station-areas; aninhar geraria absolute duplo).
  return (
    <span className={'st-podshell' + (occupied ? ' st-pod-occupied' : '')} aria-hidden="true">
      <PixelSprite rows={POD_BACK_ROWS} palette={backPalette} className="st-pod-back" />
      <span className="st-pod-body">{children}</span>
      <PixelSprite
        rows={glassRows}
        palette={{ g: GLASS_EDGE, G: 'rgba(223, 241, 255, 0.5)' }}
        className="st-pod-glass"
        overlay={
          occupied ? (
            <rect x={6} y={3} width={48} height={13} fill={GLASS} />
          ) : null
        }
      />
    </span>
  );
}

// ----------------------------------------------------------------
// Janela panoramica HD: starfield em 2 camadas (.st-stars-a/.st-stars-b,
// cada grupo DUPLICADO com offset de 1 viewBox p/ loop de drift sem
// emenda), nebulosas, pontos-galaxia coloridos, estrelas-cruz
// brilhantes e um PLANETA anelado que deriva com a camada lenta.
// Posicoes deterministicas hardcoded (mesma janela sempre).
// ----------------------------------------------------------------

const VIEW_W = 240;
const VIEW_H = 48;
const STARS_A = [
  [8, 6], [22, 31], [35, 14], [51, 40], [63, 9], [77, 26], [90, 4], [104, 36],
  [117, 18], [131, 44], [144, 11], [158, 29], [171, 7], [186, 39], [199, 22],
  [212, 13], [226, 34], [16, 43], [70, 42], [125, 2], [180, 16], [234, 45],
  [44, 22], [98, 13], [139, 35], [166, 44], [206, 30], [228, 19], [12, 18],
  [57, 5], [83, 38], [109, 27], [151, 3], [193, 33], [219, 41], [31, 37],
];
const STARS_B = [
  [13, 20], [41, 5], [58, 35], [86, 16], [99, 44], [121, 8], [149, 27],
  [167, 41], [193, 3], [218, 25], [29, 38], [137, 33], [206, 42], [74, 12],
];
const STARS_CROSS = [
  [48, 12], [112, 30], [176, 9], [230, 38],
];
const GALAXY_SPOTS = [
  [30, 12], [72, 34], [118, 10], [158, 38], [196, 18], [226, 8], [94, 24],
];
const PLANET_X = 204;
const PLANET_Y = 26;

function starRects(coords, size, fill, keyPrefix, offsetX) {
  return coords.map(([x, y], i) => (
    <rect key={`${keyPrefix}-${i}`} x={x + offsetX} y={y} width={size} height={size} fill={fill} />
  ));
}

function crossStars(keyPrefix, offsetX) {
  return STARS_CROSS.map(([x, y], i) => (
    <g key={`${keyPrefix}-${i}`} className="st-twk" fill="#eaf6ff">
      <rect x={x - 2 + offsetX} y={y} width={5} height={1} opacity="0.5" />
      <rect x={x + offsetX} y={y - 2} width={1} height={5} opacity="0.5" />
      <rect x={x + offsetX} y={y} width={1} height={1} />
    </g>
  ));
}

function galaxyDots(colors, offsetX) {
  // interior da janela e espaco escuro nos 2 temas: fallback literal
  const list = colors && colors.length ? colors : ['#3ddc84', '#4dd0e1', '#ffb454'];
  return GALAXY_SPOTS.map(([x, y], i) => {
    const c = list[i % list.length];
    return (
      <g key={`gal-${offsetX}-${i}`}>
        <rect x={x - 1 + offsetX} y={y} width={4} height={2} fill={c} opacity="0.12" />
        <rect x={x + offsetX} y={y - 1} width={2} height={4} fill={c} opacity="0.12" />
        <rect x={x + offsetX} y={y} width={2} height={2} fill={c} opacity="0.7" />
      </g>
    );
  });
}

// Planeta pixel 16x10 com terminator (lado direito escuro), banda de
// nuvem cyan e anel atravessando. Vive na camada lenta (stars-b).
function planet(offsetX) {
  const x = PLANET_X + offsetX;
  const y = PLANET_Y;
  const BODY = '#3a4f63';
  const DARK = '#243240';
  const BAND = 'rgba(77, 208, 225, 0.5)';
  const RING = '#8c9aa6';
  return (
    <g key={`planet-${offsetX}`}>
      <rect x={x + 4} y={y - 5} width={8} height={1} fill={BODY} />
      <rect x={x + 2} y={y - 4} width={12} height={2} fill={BODY} />
      <rect x={x + 1} y={y - 2} width={14} height={5} fill={BODY} />
      <rect x={x + 2} y={y + 3} width={12} height={1} fill={BODY} />
      <rect x={x + 4} y={y + 4} width={8} height={1} fill={BODY} />
      <rect x={x + 11} y={y - 4} width={3} height={8} fill={DARK} />
      <rect x={x + 2} y={y - 1} width={11} height={1} fill={BAND} />
      <rect x={x + 1} y={y + 2} width={9} height={1} fill={BAND} opacity="0.5" />
      <rect x={x - 4} y={y + 1} width={6} height={1} fill={RING} opacity="0.8" />
      <rect x={x + 14} y={y - 2} width={6} height={1} fill={RING} opacity="0.8" />
      <rect x={x - 2} y={y} width={2} height={1} fill={RING} opacity="0.45" />
      <rect x={x + 16} y={y - 1} width={2} height={1} fill={RING} opacity="0.45" />
    </g>
  );
}

export function ViewportWindow({ galaxyColors }) {
  const struts = [0, 60, 120, 180, 236];
  return (
    <span className="st-viewport" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        className="st-viewport-svg"
        aria-hidden="true"
        focusable="false"
      >
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#06090d" />
        {/* nebulosas em bandas pixel: ellipse gerava blob anti-aliased
            que quebrava o crispEdges do starfield (F7 fix) */}
        <g fill="#4dd0e1" opacity="0.06">
          <rect x={86} y={17} width={128} height={6} />
          <rect x={107} y={14} width={86} height={3} />
          <rect x={107} y={23} width={86} height={3} />
        </g>
        <g fill="#b48cfa" opacity="0.06">
          <rect x={16} y={31} width={88} height={6} />
          <rect x={31} y={28} width={58} height={3} />
          <rect x={31} y={37} width={58} height={3} />
        </g>
        <g fill="#3ddc84" opacity="0.05">
          <rect x={180} y={7} width={60} height={6} />
          <rect x={190} y={4} width={40} height={3} />
          <rect x={190} y={13} width={40} height={3} />
        </g>
        <g className="st-stars-a">
          {starRects(STARS_A, 1, '#aebfd4', 'a0', 0)}
          {starRects(STARS_A, 1, '#aebfd4', 'a1', VIEW_W)}
        </g>
        <g className="st-stars-b">
          {starRects(STARS_B, 2, '#dde9f3', 'b0', 0)}
          {starRects(STARS_B, 2, '#dde9f3', 'b1', VIEW_W)}
          {crossStars('x0', 0)}
          {crossStars('x1', VIEW_W)}
          {galaxyDots(galaxyColors, 0)}
          {galaxyDots(galaxyColors, VIEW_W)}
          {planet(0)}
          {planet(VIEW_W)}
        </g>
        {struts.map((x) => (
          <g key={`strut-${x}`}>
            <rect x={x} y={0} width={4} height={VIEW_H} fill={HULL_MID} />
            <rect x={x} y={0} width={1} height={VIEW_H} fill={HULL_LIGHT} />
            <rect x={x + 1} y={2} width={1} height={1} fill={RIVET} />
            <rect x={x + 1} y={VIEW_H - 3} width={1} height={1} fill={RIVET} />
            <rect x={x + 1} y={Math.floor(VIEW_H / 2)} width={1} height={1} fill={RIVET} />
          </g>
        ))}
        <rect x={0} y={0} width={VIEW_W} height={2} fill={HULL_LIGHT} />
        <rect x={0} y={VIEW_H - 2} width={VIEW_W} height={2} fill={HULL_LIGHT} />
        <rect x={0} y={2} width={VIEW_W} height={3} fill={GLASS} />
      </svg>
    </span>
  );
}

// ----------------------------------------------------------------
// BRECHA DO HANGAR: abertura no casco ABERTA AO ESPACO. Reusa o
// idioma da janela panoramica (starfield em 2 camadas com drift +
// galaxias + cross-stars), mas num quadro proprio (viewBox 120x96)
// com moldura de casco e bordas de hazard -- e por AQUI que as naves
// saem da sala pro espaco. Posicoes deterministicas (mesma brecha
// sempre); o drift reusa as classes .st-stars-a/.st-stars-b/.st-twk.
// ----------------------------------------------------------------

const BREACH_W = 120;
const BREACH_H = 96;

// Estrelas finas (camada rapida) e brilhantes (camada lenta).
const BREACH_STARS_A = [
  [9, 12], [24, 34], [38, 8], [52, 58], [67, 22], [81, 44], [96, 14],
  [108, 66], [17, 76], [44, 88], [73, 80], [101, 90], [31, 52], [88, 70],
  [14, 40], [60, 16], [115, 34], [6, 62], [49, 28], [92, 52],
];
const BREACH_STARS_B = [
  [20, 20], [55, 10], [78, 36], [104, 50], [12, 84], [40, 64], [69, 52],
  [96, 80], [33, 6], [84, 18],
];
const BREACH_CROSS = [[28, 24], [70, 70], [100, 30]];
const BREACH_GALAXY = [[18, 46], [58, 30], [90, 60], [46, 74]];

function breachStarRects(coords, size, fill, key, off) {
  return coords.map(([x, y], i) => (
    <rect key={`${key}-${i}`} x={x + off} y={y} width={size} height={size} fill={fill} />
  ));
}

function breachCross(key, off) {
  return BREACH_CROSS.map(([x, y], i) => (
    <g key={`${key}-${i}`} className="st-twk" fill="#eaf6ff">
      <rect x={x - 3 + off} y={y} width={7} height={1} opacity="0.5" />
      <rect x={x + off} y={y - 3} width={1} height={7} opacity="0.5" />
      <rect x={x + off} y={y} width={1} height={1} />
    </g>
  ));
}

function breachGalaxy(colors, off) {
  const list = colors && colors.length ? colors : ['#3ddc84', '#4dd0e1', '#ffb454'];
  return BREACH_GALAXY.map(([x, y], i) => {
    const c = list[i % list.length];
    return (
      <g key={`bg-${off}-${i}`}>
        <rect x={x - 2 + off} y={y} width={6} height={2} fill={c} opacity="0.12" />
        <rect x={x + off} y={y - 2} width={2} height={6} fill={c} opacity="0.12" />
        <rect x={x + off} y={y} width={2} height={2} fill={c} opacity="0.7" />
      </g>
    );
  });
}

// Stripes de hazard ambar nas ombreiras da brecha (sinaliza vao aberto).
function breachHazard(x) {
  const rows = [];
  for (let i = 0; i < BREACH_H; i += 8) {
    rows.push(<rect key={`${x}-${i}`} x={x} y={i} width={3} height={4} fill={AMBER} opacity="0.55" />);
  }
  return rows;
}

export function HangarBreach({ galaxyColors }) {
  return (
    <span className="st-breach" aria-hidden="true">
      <svg
        viewBox={`0 0 ${BREACH_W} ${BREACH_H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        className="st-breach-svg"
        aria-hidden="true"
        focusable="false"
      >
        <rect x={0} y={0} width={BREACH_W} height={BREACH_H} fill="#04070b" />
        {/* nebulosa de fundo em banda pixel (mesmo truque da janela) */}
        <g fill="#4dd0e1" opacity="0.06">
          <rect x={20} y={40} width={84} height={10} />
          <rect x={36} y={34} width={52} height={5} />
        </g>
        <g fill="#b48cfa" opacity="0.05">
          <rect x={10} y={60} width={70} height={9} />
        </g>
        <g className="st-stars-a">
          {breachStarRects(BREACH_STARS_A, 1, '#aebfd4', 'ba0', 0)}
          {breachStarRects(BREACH_STARS_A, 1, '#aebfd4', 'ba1', BREACH_W)}
        </g>
        <g className="st-stars-b">
          {breachStarRects(BREACH_STARS_B, 2, '#dde9f3', 'bb0', 0)}
          {breachStarRects(BREACH_STARS_B, 2, '#dde9f3', 'bb1', BREACH_W)}
          {breachCross('bx0', 0)}
          {breachCross('bx1', BREACH_W)}
          {breachGalaxy(galaxyColors, 0)}
          {breachGalaxy(galaxyColors, BREACH_W)}
        </g>
        {/* moldura de casco do vao + ombreiras de hazard */}
        <rect x={0} y={0} width={BREACH_W} height={3} fill={HULL_MID} />
        <rect x={0} y={0} width={BREACH_W} height={1} fill={HULL_LIGHT} />
        <rect x={0} y={0} width={3} height={BREACH_H} fill={HULL_MID} />
        <rect x={0} y={0} width={1} height={BREACH_H} fill={HULL_LIGHT} />
        <rect x={BREACH_W - 3} y={0} width={3} height={BREACH_H} fill={HULL_MID} />
        {breachHazard(4)}
        {breachHazard(BREACH_W - 7)}
        {/* brilho de vidro/campo de forca na borda interna superior */}
        <rect x={3} y={3} width={BREACH_W - 6} height={3} fill={GLASS} />
      </svg>
    </span>
  );
}

// ----------------------------------------------------------------
// Detalhe estatico do casco: ribs com LEDs, piso de chapas com tom
// alternado, ventilacao com venezianas, placa de aviso com chevrons.
// Nada disso anima — e textura barata de ambientacao.
// ----------------------------------------------------------------

export function WallRibs() {
  const ribs = [];
  for (let x = 4; x < 236; x += 24) ribs.push(x);
  return (
    <svg
      viewBox="0 0 240 12"
      width="100%"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className="st-ribs"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={0} y={0} width={240} height={12} fill="var(--st-ceiling, #1d2630)" />
      {ribs.map((x, i) => (
        <g key={x}>
          <rect x={x} y={0} width={3} height={12} fill={HULL_MID} />
          <rect x={x} y={0} width={1} height={12} fill={HULL_LIGHT} />
          <rect x={x + 1} y={2} width={1} height={1} fill={RIVET} />
          <rect x={x + 1} y={9} width={1} height={1} fill={RIVET} />
          <rect
            x={x + 12}
            y={5}
            width={2}
            height={2}
            fill={i % 3 === 0 ? GREEN : i % 3 === 1 ? mixDn(HULL_MID, 35) : CYAN}
            opacity={i % 3 === 1 ? 1 : 0.8}
          />
        </g>
      ))}
      <rect x={0} y={11} width={240} height={1} fill={HULL_LIGHT} />
    </svg>
  );
}

export function DeckFloor() {
  const seams = [];
  for (let x = 0; x < 240; x += 30) seams.push(x);
  return (
    <svg
      viewBox="0 0 240 20"
      width="100%"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className="st-floor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={0} y={0} width={240} height={20} fill={HULL_DARK} />
      {seams.map((x, i) => (
        <g key={x}>
          {i % 2 === 0 ? (
            <rect x={x + 1} y={1} width={29} height={19} fill={mixUp(HULL_DARK, 7)} opacity="0.5" />
          ) : null}
          <rect x={x} y={1} width={1} height={19} fill={mixDn(HULL_DARK, 30)} />
          <rect x={x + 3} y={4} width={1} height={1} fill={RIVET} />
          <rect x={x + 26} y={4} width={1} height={1} fill={RIVET} />
          <rect x={x + 3} y={15} width={1} height={1} fill={RIVET} />
          <rect x={x + 26} y={15} width={1} height={1} fill={RIVET} />
          <rect x={x + 8} y={12} width={6} height={1} fill={mixDn(HULL_DARK, 30)} opacity="0.8" />
          <rect x={x + 17} y={6} width={5} height={1} fill={mixDn(HULL_DARK, 30)} opacity="0.6" />
        </g>
      ))}
      <rect x={0} y={0} width={240} height={1} fill={HULL_LIGHT} />
      <rect x={0} y={9} width={240} height={1} fill={mixDn(HULL_DARK, 30)} />
    </svg>
  );
}

const VENT_ROWS = norm([
  rep('O', 32),
  'O' + rep('m', 30) + 'O',
  'Om' + 'r' + rep('v', 26) + 'r' + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + rep('d', 28) + 'mO',
  'Om' + rep('v', 28) + 'mO',
  'Om' + 'r' + rep('v', 26) + 'r' + 'mO',
  'O' + rep('m', 30) + 'O',
  rep('O', 32),
]);

export function VentGrid() {
  return (
    <PixelSprite
      rows={VENT_ROWS}
      palette={{ O: ST_OUTLINE, m: HULL_MID, d: PAD, v: mixDn(HULL_DARK, 55), r: RIVET }}
      className="st-vent"
    />
  );
}

// tone (F7, opcional): cor dos chevrons/listras da placa -- as placas
// de area (LAB/CAFE/...) usam a cor-tema da area; default = ambar
// historico. O fill do texto e tematizado via CSS (.st-warn text).
export function WarnPlate({ text = 'DECK 07', tone }) {
  const label = String(text).toUpperCase().slice(0, 10);
  const accent = tone || AMBER;
  const w = 16 + label.length * 6;
  return (
    <svg
      viewBox={`0 0 ${w} 12`}
      height="12"
      shapeRendering="crispEdges"
      className="st-warn"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={0} y={0} width={w} height={12} fill={HULL_DARK} />
      <rect x={0} y={0} width={w} height={1} fill={RIVET} />
      <rect x={0} y={11} width={w} height={1} fill={RIVET} />
      <rect x={0} y={1} width={1} height={10} fill={RIVET} />
      <rect x={w - 1} y={1} width={1} height={10} fill={RIVET} />
      <rect x={2} y={2} width={2} height={8} fill={accent} opacity="0.85" />
      <rect x={4} y={2} width={2} height={8} fill={mixDn(HULL_DARK, 45)} />
      <rect x={6} y={2} width={2} height={8} fill={accent} opacity="0.55" />
      <rect x={w - 3} y={2} width={1} height={8} fill={accent} opacity="0.45" />
      <text
        x={11}
        y={9}
        fontFamily="'JetBrains Mono', Consolas, monospace"
        fontSize="7"
        fill="#8fa1b0"
        textRendering="optimizeSpeed"
      >
        {label}
      </text>
    </svg>
  );
}

// ----------------------------------------------------------------
// Doca de carga HD 48x32: poste com luz de status, container na cor
// do projeto com corrugacao + placa, esteira com roletes.
// ----------------------------------------------------------------

const CARGO_ROWS = norm([
  dots(39) + 'OwwO' + dots(5),
  dots(39) + 'OwwO' + dots(5),
  dots(40) + 'Or' + dots(6),
  dots(12) + rep('O', 22) + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'X' + rep('c', 18) + 'X' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'c' + 'd' + rep('c', 4) + 'd' + rep('c', 4) + 'd' + rep('c', 4) + 'd' + 'ccc' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'c' + 'd' + rep('c', 4) + 'd' + rep('c', 4) + 'd' + rep('c', 4) + 'd' + 'ccc' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'c' + rep('n', 6) + rep('c', 6) + 'OOOOO' + 'cc' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'c' + rep('n', 6) + rep('c', 6) + 'OddxO' + 'cc' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + rep('c', 12) + 'd' + 'OOOOO' + 'cc' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + 'O' + 'X' + rep('c', 18) + 'X' + 'O' + dots(6) + 'Or' + dots(6),
  dots(12) + rep('O', 22) + dots(6) + 'Or' + dots(6),
  dots(40) + 'Or' + dots(6),
  dots(40) + 'Or' + dots(6),
  dots(48),
  dots(48),
  rep('b', 44) + dots(4),
  'b' + rep('B', 42) + 'b' + dots(4),
  'b' + 'o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.o.' + 'b' + dots(4),
  'b' + rep('B', 42) + 'b' + dots(4),
  rep('b', 44) + dots(4),
  dots(3) + 'OrrO' + dots(30) + 'OrrO' + dots(7),
  dots(3) + 'OrrO' + dots(30) + 'OrrO' + dots(7),
  dots(2) + 'OrrrrO' + dots(28) + 'OrrrrO' + dots(6),
  ...Array(8).fill(dots(48)),
]);

export function CargoDockSprite({ color }) {
  const c = color || '#ffb454';
  const palette = {
    O: ST_OUTLINE,
    c, X: tint(c, 0.3), d: shade(c, 0.45),
    n: '#c9d4dd', x: c,
    b: HULL_MID, B: HULL_DARK, o: RIVET,
    r: RIVET, w: GREEN,
  };
  return <PixelSprite rows={CARGO_ROWS} palette={palette} className="st-cargo" />;
}

// ----------------------------------------------------------------
// Gato da estacao (18x12): tabby dormindo de loaf no sofa, olhos
// fechados, listras e rabo em 2 frames (swap lento via .st-cat no
// scene.css re-escopando a duracao do .r-swap-a/b).
// ----------------------------------------------------------------

const CAT_HEAD = [
  '..O..O............',
  '.ObOObO...........',
  '.ObbbbO.OOOOOOOO..',
  '.ObbbbOObbbbbbbbO.',
  '.ObeebbbbbbbbbbbO.',
  '.ObbdbbdbbdbbdbbO.',
  '..ObbbbbbbbbbbbO..',
];

const CAT_A = norm([
  ...CAT_HEAD,
  '..ObbbbbbbbbbbtO..',
  '...OOOOOOOOOOOtO..',
  '..............OtO.',
  '...............O..',
  '..................',
]);

const CAT_B = norm([
  ...CAT_HEAD,
  '..ObbbbbbbbbbbtO..',
  '...OOOOOOOOOOOtO..',
  '.............OtO..',
  '..............O...',
  '..................',
]);

export function StationCatSprite({ className = '', width = '100%' }) {
  const palette = {
    O: OUTLINE,
    b: '#b97745', d: shade('#b97745', 0.35),
    t: '#9c5f33', e: '#5a3820',
  };
  return (
    <SwapSprite
      a={CAT_A}
      b={CAT_B}
      palette={palette}
      viewBox="0 0 18 12"
      className={`st-cat-svg ${className}`.trim()}
      width={width}
    />
  );
}

// ----------------------------------------------------------------
// Wrappers de pose: reaproveitam o AvatarSprite existente (children)
// com transform ESTATICO — nunca animado aqui.
// ----------------------------------------------------------------

export function LyingAvatar({ children }) {
  return (
    <span
      className="st-lying"
      style={{ display: 'inline-block', transform: 'rotate(90deg)' }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

const SIP_MUG_ROWS = norm([
  '.OOOOOO.....',
  'OCCCCCCO.O..',
  'OAaaaaaO..O.',
  'OAaaaaaO.O..',
  'OaaaaaaO....',
  '.OOOOOO.....',
]);

export function SippingAvatar({ children }) {
  const palette = {
    O: OUTLINE,
    a: AMBER, A: mixUp(AMBER, 40), C: '#3a2616',
  };
  return (
    <span className="st-sipping" style={{ position: 'relative', display: 'inline-block' }} aria-hidden="true">
      {children}
      <span
        className="st-sip-mug"
        style={{ position: 'absolute', right: '-22%', top: '38%', width: '34%' }}
      >
        <PixelSprite rows={SIP_MUG_ROWS} palette={palette} />
        <SteamPuffs delay={0} />
      </span>
    </span>
  );
}

// Tapete pixel do lounge (F7): bandas teal + campo escuro com pontos-
// diamante. Estatico; cores saturadas legiveis nos 2 temas. Demarca
// o chao do conjunto sofa/gato/luminaria (z abaixo da mobilia).
const RUG_DOTS_A = 'bbbbbbbbbd'.repeat(6);
const RUG_DOTS_B = 'bbbbdbbbbb'.repeat(6);
const RUG_FIELD = 'Rm' + rep('b', 60) + 'mR';

const RUG_ROWS = norm([
  rep('R', 64),
  'R' + rep('m', 62) + 'R',
  RUG_FIELD,
  'Rm' + RUG_DOTS_A + 'mR',
  'Rm' + RUG_DOTS_B + 'mR',
  RUG_FIELD,
  'Rm' + RUG_DOTS_A + 'mR',
  'Rm' + RUG_DOTS_B + 'mR',
  RUG_FIELD,
  'Rm' + RUG_DOTS_A + 'mR',
  'Rm' + RUG_DOTS_B + 'mR',
  RUG_FIELD,
  'R' + rep('m', 62) + 'R',
  rep('R', 64),
]);

export function RugSprite() {
  // refino anti-ruido: pontos-diamante rebaixados (#7fd6e8 -> #4f8fa0)
  // -- o tapete chamava mais atencao que o sofa que ele demarca
  const palette = {
    R: '#27566b', m: '#3f9aa8', b: '#1d4555', d: '#4f8fa0',
  };
  return <PixelSprite rows={RUG_ROWS} palette={palette} className="sa-rug-svg" />;
}

// Objetos wow do F7 (samambaia, cacto, aquario, globo, vending,
// robo-aspirador, mural, extintor) REMOVIDOS no refino anti-ruido
// de 2026-06-12: decoracao animada competia com os sinais reais.
