// FAROL - sprites-props.jsx (HD, F6): objetos da sala compacta.
// Mesa 3.0 (64x44): monitor com bezel, linhas de codigo, LED de power,
// caneca com alca e cafe, torre de PC com vents e LED, sticky notes
// penduradas no tampo e pes com sapata. Porta 3.0 (32x52): janela com
// brilho, keypad, barra de empurrar, faixa de hazard e kick plate;
// frame aberto com vao escuro, folha de perfil e luz vazando.
// Drones HD (24x12 / 24x18 com caixote), LED 8x8, Zzz e StatusLamp.
// Grids construidos por concatenacao com repeat() (largura auditavel)
// e norm() como rede de seguranca. Contratos CSS preservados: .r-cl*,
// .r-caret, .r-glow, .r-door, .door-shut/.door-open, .r-drone,
// .r-led*, .r-zzz*.
import {
  SPRITE_COLORS as C, OUTLINE, pixelRects, norm, PixelSprite, SwapSprite, hexA, tint,
  AvatarSprite,
} from './sprites-crew.jsx';

const dots = (n) => '.'.repeat(n);

/* ----------------------------------------------------------------
   Mesa 3.0 (64x44). Prop screen: 'on' = codigo correndo + glow na
   cor do projeto; 'dim' = linhas congeladas; 'off' = tela apagada.
   Monitor cols 8-45; caneca cols 49-59; torre de PC cols 47-56;
   tampo rows 28-30; pes cols 3-6 / 57-60.
   ---------------------------------------------------------------- */

const DESK_SCREEN_ROW = dots(8) + 'Oob' + 's'.repeat(32) + 'boO' + dots(18);
const DESK_LEG_ROW = '...ODdO' + dots(40) + 'OmmmmmmmmO' + 'ODdO...';

const DESK_ROWS = norm([
  dots(8) + 'O'.repeat(38) + dots(18),
  dots(8) + 'O' + 'o'.repeat(36) + 'O' + dots(18),
  ...Array(19).fill(DESK_SCREEN_ROW),
  dots(8) + 'Oob' + 's'.repeat(32) + 'boO' + '....OOOOOO........',
  dots(8) + 'Oob' + 's'.repeat(32) + 'boO' + '...O' + 'C'.repeat(6) + 'O.......',
  dots(8) + 'Oo' + 'b'.repeat(34) + 'oO' + '...OAaaaaaO.OO....',
  dots(8) + 'O' + 'o'.repeat(17) + 'rr' + 'o'.repeat(14) + 'gg' + 'o' + 'O' + '...OAaaaaaO..O....',
  dots(8) + 'O'.repeat(38) + '...OAaaaaaO.OO....',
  dots(24) + 'OttttO' + dots(16) + '...O' + 'a'.repeat(6) + 'O' + dots(7),
  dots(21) + 'OTTttttttTTO' + dots(17) + 'OOOOOO' + dots(8),
  '.' + 'W'.repeat(62) + '.',
  '.' + 'w'.repeat(62) + '.',
  '..' + 'd'.repeat(60) + '..',
  '...ODdO...OyyyO.OyyyO' + dots(26) + 'OOOOOOOOOO' + 'ODdO...',
  '...ODdO...OyyyO.OyyyO' + dots(26) + 'OgmmmmmmmO' + 'ODdO...',
  '...ODdO...OyyyO.OYYYO' + dots(26) + 'OmmmmmmmmO' + 'ODdO...',
  '...ODdO...OYYYO......' + dots(26) + 'OmvvvvvvmO' + 'ODdO...',
  DESK_LEG_ROW,
  '...ODdO' + dots(40) + 'OmvvvvvvmO' + 'ODdO...',
  DESK_LEG_ROW,
  '...ODdO' + dots(40) + 'OmvvvvvvmO' + 'ODdO...',
  DESK_LEG_ROW,
  DESK_LEG_ROW,
  DESK_LEG_ROW,
  DESK_LEG_ROW,
  '..OddddO' + dots(39) + 'OOOOOOOOOO' + 'OddddO.',
]);

// Linhas de codigo na tela (build-up staggered via CSS .r-cl*).
function CodeLines({ color, frozen = false }) {
  const f = frozen ? ' r-cl-frozen' : '';
  return (
    <g fill={color}>
      <rect className={`r-cl r-cl1${f}`} x="14" y="4" width="18" height="2" />
      <rect className={`r-cl r-cl2${f}`} x="14" y="7" width="24" height="2" />
      <rect className={`r-cl r-cl3${f}`} x="14" y="10" width="14" height="2" />
      <rect className={`r-cl r-cl1${f}`} x="14" y="13" width="21" height="2" />
      <rect className={`r-cl r-cl2${f}`} x="14" y="16" width="10" height="2" />
      {frozen ? null : <rect className="r-caret" x="14" y="19" width="3" height="2" fill={color} />}
    </g>
  );
}

export function DeskSprite({ screen = 'off', accent = C.accent, className = '', width = '100%' }) {
  const on = screen === 'on';
  const dim = screen === 'dim';
  const sFill = on ? hexA(accent, 0.13) : dim ? hexA(accent, 0.05) : '#0b0f14';
  // F7: casco/mobilia em var(--st-*) (tema claro); tela continua dark
  const palette = {
    O: 'var(--st-outline, #05080d)',
    o: 'var(--st-hull-mid, #2c3a4a)', b: '#1c2734', s: sFill,
    t: '#1c2734', T: '#33424f',
    W: 'var(--st-hull-light, #4a5866)', w: 'var(--st-hull-mid, #2e3a47)',
    d: 'var(--st-hull-dark, #1a2430)', D: 'var(--st-hull-mid, #283440)',
    a: C.amber, A: tint(C.amber, 0.4), C: '#3a2616',
    y: '#e8d27a', Y: '#b89f4a',
    m: 'var(--st-hull-mid, #222e3a)', v: '#101820', g: on ? accent : '#21303d',
    r: 'var(--st-rivet, #5d6b78)',
  };
  return (
    <PixelSprite
      rows={DESK_ROWS}
      palette={palette}
      className={className}
      width={width}
      overlay={on ? <CodeLines color={accent} /> : dim ? <CodeLines color={hexA(accent, 0.45)} frozen /> : null}
    >
      {on ? <rect className="r-glow" x="8" y="0" width="38" height="26" fill={accent} /> : null}
    </PixelSprite>
  );
}

/* ----------------------------------------------------------------
   Porta da sala HD (32x52): moldura dupla, janela com brilho, LED de
   status, keypad com display, barra de empurrar, hazard stripes e
   kick plate. Prop open troca para o frame aberto (vao escuro + folha
   de perfil + luz vazando) com crossfade de opacity via CSS .r-door.
   ---------------------------------------------------------------- */

const DOOR_PANEL_ROW = 'Ooe' + 'p'.repeat(26) + 'eoO';
const DOOR_WINDOW_EDGE = 'Ooe' + 'p'.repeat(7) + 'O'.repeat(12) + 'p'.repeat(7) + 'eoO';
const DOOR_HANDLE = 'Ooe' + 'p' + 'aa' + 'p'.repeat(23) + 'eoO';

function doorKeypadRow(pad) {
  return 'Ooe' + 'p' + 'aa' + 'p'.repeat(15) + pad + 'ppp' + 'eoO';
}

function hazardRow(offset) {
  let s = '';
  for (let i = 0; i < 26; i += 1) s += (i + offset) % 4 < 2 ? 'z' : 'Z';
  return 'Ooe' + s + 'eoO';
}

const DOOR_SHUT = norm([
  'O'.repeat(32),
  'O' + 'o'.repeat(30) + 'O',
  'Oo' + 'e'.repeat(28) + 'oO',
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  'Ooe' + 'p'.repeat(11) + 'gggg' + 'p'.repeat(11) + 'eoO',
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  DOOR_WINDOW_EDGE,
  'Ooe' + 'p'.repeat(7) + 'OGGggggggggO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OGggggggggGO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OggggggggggO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OggggggggggO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OggggggggggO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OggggggggggO' + 'p'.repeat(7) + 'eoO',
  'Ooe' + 'p'.repeat(7) + 'OggggggggggO' + 'p'.repeat(7) + 'eoO',
  DOOR_WINDOW_EDGE,
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  DOOR_PANEL_ROW,
  doorKeypadRow('OOOOO'),
  doorKeypadRow('OnnnO'),
  doorKeypadRow('OKKKO'),
  doorKeypadRow('OKKKO'),
  doorKeypadRow('OOOOO'),
  DOOR_HANDLE,
  DOOR_HANDLE,
  ...Array(12).fill(DOOR_PANEL_ROW),
  hazardRow(0),
  hazardRow(1),
  hazardRow(2),
  DOOR_PANEL_ROW,
  'Ooe' + 'r'.repeat(26) + 'eoO',
  'Ooe' + 'k'.repeat(26) + 'eoO',
  'Ooe' + 'k'.repeat(26) + 'eoO',
  'Ooe' + 'k'.repeat(26) + 'eoO',
  'Oo' + 'e'.repeat(28) + 'oO',
  'O' + 'o'.repeat(30) + 'O',
  'O'.repeat(32),
]);

// Vao aberto: interior escuro (24 cols), folha da porta de perfil na
// direita, luz vazando no chao em degraus (lightFrom = col do degrau).
function doorOpenRow(lightFrom) {
  let interior = '';
  for (let i = 0; i < 24; i += 1) interior += i >= lightFrom ? 'l' : 'k';
  return 'Oo' + interior + 'O' + 'pp' + 'e' + 'oO';
}

const DOOR_OPEN = norm([
  'O'.repeat(32),
  'O' + 'o'.repeat(30) + 'O',
  ...Array(44).fill(doorOpenRow(99)),
  doorOpenRow(18),
  doorOpenRow(14),
  doorOpenRow(10),
  doorOpenRow(6),
  'O' + 'o'.repeat(30) + 'O',
  'O'.repeat(32),
]);

export function DoorSprite({ open = false, className = '', width = '100%' }) {
  // F7: folha/moldura seguem o casco; vao interno continua escuro
  const palette = {
    O: 'var(--st-outline, #05080d)',
    o: 'var(--st-hull-mid, #243140)', e: 'var(--st-hull-light, #33424f)',
    p: 'var(--st-hull-dark, #15202c)',
    g: '#0d1620', G: 'rgba(127, 214, 232, 0.4)',
    a: C.amber, n: C.accent, K: '#3b4a58',
    z: '#7a5a1f', Z: '#11161d',
    r: 'var(--st-rivet, #5d6b78)', k: '#0e151d',
    l: 'rgba(61, 220, 132, 0.13)',
  };
  return (
    <svg
      viewBox="0 0 32 52"
      width={width}
      className={`r-door${open ? ' is-open' : ''} ${className}`.trim()}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <g className="door-shut">{pixelRects(DOOR_SHUT, palette)}</g>
      <g className="door-open">{pixelRects(DOOR_OPEN, { ...palette, k: '#04060a' })}</g>
    </svg>
  );
}

/* ----------------------------------------------------------------
   Drone HD (24x12): rotores em 2 frames (largo/borrado), bracos,
   corpo com visor e olhos de camera, skids de pouso.
   ---------------------------------------------------------------- */

const DRONE_BODY = [
  '....Obb......bbO........',
  '.....ObbbbbbbbO.........',
  '....ObbeeeeeebbO........',
  '....ObbeEeeEebbO........',
  '.....ObbbbbbbbO.........',
  '......Obb..bbO..........',
  '.....Obbb..bbbO.........',
];

const DRONE_A = norm([
  '..RRRR........RRRR......',
  '....OO........OO........',
  ...DRONE_BODY,
  '........................',
  '........................',
  '........................',
]);

const DRONE_B = norm([
  '.....RR........RR.......',
  '....OO........OO........',
  ...DRONE_BODY,
  '........................',
  '........................',
  '........................',
]);

function dronePalette() {
  return {
    O: OUTLINE, R: '#dde9f3', b: '#5d6b78',
    e: '#070c11', E: C.cyan,
  };
}

export function DroneSprite({ className = '', width = 22 }) {
  return (
    <SwapSprite
      a={DRONE_A}
      b={DRONE_B}
      palette={dronePalette()}
      viewBox="0 0 24 12"
      className={`r-drone ${className}`.trim()}
      width={width}
    />
  );
}

/* ----------------------------------------------------------------
   Drone de carga HD (24x18): mesmo corpo + cabo e caixote ambar com
   cintas e highlight.
   ---------------------------------------------------------------- */

const CARGO_TAIL = [
  '...........OO...........',
  '...........OO...........',
  '......OOOOOOOOOOOO......',
  '.....OaAAAAAAAAAAaO.....',
  '.....OadaaaaaaaadaO.....',
  '.....OaaaaaaaaaaaaO.....',
  '......OOOOOOOOOOOO......',
];

const CARGO_A = norm([
  '..RRRR........RRRR......',
  '....OO........OO........',
  ...DRONE_BODY.slice(0, 5),
  '......Obb..bbO..........',
  ...CARGO_TAIL,
  '........................',
  '........................',
]);

const CARGO_B = norm([
  '.....RR........RR.......',
  '....OO........OO........',
  ...DRONE_BODY.slice(0, 5),
  '......Obb..bbO..........',
  ...CARGO_TAIL,
  '........................',
  '........................',
]);

export function CargoDroneSprite({ className = '', width = 24 }) {
  const palette = {
    ...dronePalette(),
    a: C.amber, A: tint(C.amber, 0.35), d: '#7a5a1f',
  };
  return (
    <SwapSprite
      a={CARGO_A}
      b={CARGO_B}
      palette={palette}
      viewBox="0 0 24 17"
      className={`r-drone ${className}`.trim()}
      width={width}
    />
  );
}

/* ----------------------------------------------------------------
   Foguete de subagent HD (18x31): SpaceX-level (Falcon 9 / Starship) --
   ALTO mas com CORPO ENCORPADO (cilindro solido ~6px de largura, bem
   mais grosso que aletas/pernas; nao mais agulha fininha). Corpo
   branco/cinza-claro com detalhe limpo. IDENTIDADE da cor do projeto
   vive nos ACENTOS: nariz ('c'), uma FAIXA horizontal bold ('c') e as
   aletas/pernas ('c') -- foguete de projeto verde = corpo branco,
   nariz/faixa/aletas verdes. Forma: (a) NARIZ pontudo no topo (cone
   Falcon); (b) GRID FINS ('G') saindo das laterais no terco superior;
   (c) FRESTA fina de windshield ('W'/'#') alta no corpo; (d) PERNAS de
   pouso ('L') abertas na base (estilo Falcon); (e) fileira de BOCAIS
   ('n', ambar) rente na base. Corpo claro 'A', highlight 'H'. A cabine
   '#' recebe o piloto embarcado (boardedId). A CHAMA (prop flame) e
   FILHA do .r-ship-wrap (posicionada nos bocais), entao viaja COM o
   foguete na decolagem -- nunca fica pra tras na plataforma.
   ---------------------------------------------------------------- */

const SHIP_ROWS = norm([
  '........cc........',
  '........cc........',
  '.......OccO.......',
  '.......OccO.......',
  '......OcAAcO......',
  '......OAAAAO......',
  '.....OHAAAAAO.....',
  '.....OAAAAAAO.....',
  '....GOHAAAAAOG....',
  '....GOAAAAAAOG....',
  '....GOAAAAAAOG....',
  '.....OAAAAAAO.....',
  '.....OAWWWWAO.....',
  '.....OW####WO.....',
  '.....OAWWWWAO.....',
  '.....OHAAAAAO.....',
  '.....OAAAAAAO.....',
  '.....OccccccO.....',
  '.....OccccccO.....',
  '.....OAAAAAAO.....',
  '.....OHAAAAAO.....',
  '.....OAAAAAAO.....',
  '.....OAAAAAAO.....',
  '.....OHAAAAAO.....',
  '.....OAAAAAAO.....',
  '.....OAAAAAAO.....',
  '....cOHAAAAAOc....',
  '...ccOAAAAAAOcc...',
  '..ccLOAAAAAAOLcc..',
  '.cL..OnnnnnnO..Lc.',
  'L....On....nO....L',
]);

const SHIP_W = SHIP_ROWS[0].length; // 18 (apos norm)
const SHIP_H = SHIP_ROWS.length;    // 31
// Janela/cabine: cols 6..11, rows 12..14 (windshield) -- quadro do piloto.
const COCKPIT = { x: 6, y: 12, w: 6, h: 3 };

export function ShipSprite({
  color = C.accent, boardedId = null, flame = false, className = '', width = 56,
}) {
  const palette = {
    O: OUTLINE,
    A: 'var(--st-hull-light, #d8e0e8)', // corpo branco/cinza-claro (Falcon)
    H: '#f4fbff',                       // highlight (lado iluminado, quase branco)
    c: color,                           // acentos: nariz + faixa + aletas (cor do projeto)
    G: tint(color, 0.35),              // grid fins (cor do projeto, 1 tom acima)
    L: 'var(--st-rivet, #9aa8b8)',      // pernas de pouso (cinza metalico)
    W: '#dff1ff',                       // moldura do windshield
    n: C.amber,                         // bocais do propulsor
    '#': 'rgba(8, 14, 22, .92)',        // interior escuro do windshield (cabine)
  };
  return (
    <span className="r-ship-wrap" style={{ position: 'relative', display: 'block' }}>
      <PixelSprite
        rows={SHIP_ROWS}
        palette={palette}
        className={`r-ship${boardedId ? ' r-ship-boarded' : ''} ${className}`.trim()}
        width={width}
      >
        {boardedId ? (
          <rect className="r-cockpit-lit" x={COCKPIT.x} y={COCKPIT.y} width={COCKPIT.w} height={COCKPIT.h} fill={color} opacity="0.32" />
        ) : null}
      </PixelSprite>
      {boardedId ? (
        <span
          className="r-ship-pilot"
          style={{
            position: 'absolute',
            // quadro do windshield em % do sprite (cabine = onde o piloto aparece)
            left: `${((COCKPIT.x - 1) / SHIP_W) * 100}%`,
            top: `${((COCKPIT.y - 3) / SHIP_H) * 100}%`,
            width: `${((COCKPIT.w + 2) / SHIP_W) * 100}%`,
          }}
          aria-hidden="true"
        >
          <AvatarSprite id={boardedId} uniform={color} pose="idle" />
        </span>
      ) : null}
      {/* CHAMA nos bocais: FILHA do wrapper -> viaja com o foguete na
          decolagem. Largura/posicao em % do sprite (bocais ~cols 6-11). */}
      {flame ? <span className="r-ship-flame" aria-hidden="true" /> : null}
    </span>
  );
}

/* ----------------------------------------------------------------
   Plataforma de pouso HD (28x10): chapa metalica com luzes de borda
   na cor do projeto e marca de bocal. Estatica; a nave grande pousa
   por cima dela (a decolagem e animada no scene.css).
   ---------------------------------------------------------------- */

const PAD_ROWS = norm([
  '............................',
  '...OllO............OllO.....',
  '..OOOOOOOOOOOOOOOOOOOOOOOO..',
  '.OmMMMMMMMMMMMMMMMMMMMMMMmO.',
  '.OmMMMMMMMMMMMMMMMMMMMMMMmO.',
  '.OOmmmmmmmmmmmmmmmmmmmmmmOO.',
  '..OddOOOOOOOOOOOOOOOOOOddO..',
  '..OddO..............OddO....',
  '..OOOO..............OOOO....',
  '............................',
]);

export function LaunchPadSprite({ color = C.accent, lit = false, className = '', width = '100%' }) {
  const palette = {
    O: OUTLINE,
    l: lit ? color : C.amber,                 // luzes de borda
    m: 'var(--st-hull-mid, #283440)',
    M: 'var(--st-hull-dark, #1a2430)',
    d: 'var(--st-hull-mid, #222e3a)',
  };
  return (
    <PixelSprite
      rows={PAD_ROWS}
      palette={palette}
      className={`r-pad ${className}`.trim()}
      width={width}
    >
      {lit ? <rect className="r-glow" x="3" y="1" width="22" height="6" fill={color} opacity="0.18" /> : null}
    </PixelSprite>
  );
}

/* ----------------------------------------------------------------
   Rack de servidor HD (22x28): gabinete vertical de unidades
   empilhadas -- cada uma com 2 LEDs de status (cor do projeto / ambar
   / vermelho), 8 ranhuras de ventilacao e divisoria escura. Casco em
   var(--st-*) (segue o tema claro/escuro como a DeskSprite). Estatico.
   ---------------------------------------------------------------- */

const rackUnit = (led) => [
  'Oo' + 'hh' + led + led + 'h' + 'vvvvvvvv' + 'h' + 'hhhh' + 'oO',
  'Oo' + 'h'.repeat(18) + 'oO',
  'Oo' + 'd'.repeat(18) + 'oO',
];

const RACK_ROWS = norm([
  'O'.repeat(22),
  'O' + 'o'.repeat(20) + 'O',
  ...rackUnit('g'), ...rackUnit('a'), ...rackUnit('g'), ...rackUnit('r'),
  ...rackUnit('g'), ...rackUnit('a'), ...rackUnit('g'), ...rackUnit('g'),
  'O' + 'W'.repeat(20) + 'O',
  'O' + 'o'.repeat(20) + 'O',
  'OO' + '.'.repeat(18) + 'OO',
]);

export function ServerRackSprite({ accent = C.accent, className = '', width = '100%' }) {
  const palette = {
    O: 'var(--st-outline, #05080d)',
    o: 'var(--st-hull-mid, #2c3a4a)',
    h: 'var(--st-hull-dark, #1a2430)',
    d: '#0e151d', v: '#0a0f15',
    W: 'var(--st-hull-light, #4a5866)',
    g: accent, a: C.amber, r: C.red,
  };
  return (
    <PixelSprite
      rows={RACK_ROWS}
      palette={palette}
      className={`r-rack ${className}`.trim()}
      width={width}
    />
  );
}

/* ----------------------------------------------------------------
   LED de estado da mesa HD (8x8): bulbo com brilho + base. ativa =
   verde pulsando, ociosa = ambar fixo, dormindo = apagado.
   ---------------------------------------------------------------- */

const LED_ROWS = norm([
  '..llll..',
  '.lLLlll.',
  '.llllll.',
  '.llllll.',
  '..llll..',
  '...OO...',
  '..OooO..',
  '.OooooO.',
]);

const LED_STATE_COLORS = { ativa: C.accent, ociosa: C.amber, dormindo: C.border };

export function LedSprite({ state = 'dormindo', className = '', width = 10 }) {
  const color = LED_STATE_COLORS[state] || C.dim;
  const palette = { l: color, L: tint(color, 0.5), O: OUTLINE, o: '#2b333d' };
  return (
    <svg
      viewBox="0 0 8 8"
      width={width}
      className={`r-led r-led-${state} ${className}`.trim()}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {state === 'ativa' ? <rect className="r-glow" x="0" y="0" width="8" height="5" fill={C.accent} opacity="0.2" /> : null}
      <g className="r-led-bulb">{pixelRects(LED_ROWS, palette)}</g>
    </svg>
  );
}

/* ----------------------------------------------------------------
   Zzz: tres Z em pixel flutuando (opacity + translateY, com stagger).
   ---------------------------------------------------------------- */

const Z_BIG = ['zzzz', '..z.', '.z..', 'zzzz'];
const Z_SMALL = ['zzz', '.z.', 'zzz'];

export function ZzzSprite({ className = '', width = '100%' }) {
  const palette = { z: 'var(--text, #c9d4dd)' };
  return (
    <svg
      viewBox="0 0 14 12"
      width={width}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(0, 8)"><g className="r-zzz r-zzz-1">{pixelRects(Z_BIG, palette)}</g></g>
      <g transform="translate(6, 4)"><g className="r-zzz r-zzz-2">{pixelRects(Z_SMALL, palette)}</g></g>
      <g transform="translate(11, 0)"><g className="r-zzz r-zzz-3">{pixelRects(Z_SMALL, palette)}</g></g>
    </svg>
  );
}

/* ----------------------------------------------------------------
   Lampada de status HD (16x12): bulbo com brilho + pedestal + halo.
   ---------------------------------------------------------------- */

const LAMP_ROWS = norm([
  '.....llllll.....',
  '....lLLlllll....',
  '...llllllllll...',
  '...llllllllll...',
  '....llllllll....',
  '.....llllll.....',
  '.......OO.......',
  '......OooO......',
  '.....OooooO.....',
  '.....OooooO.....',
  '....OOOOOOOO....',
  '................',
]);

const LAMP_COLORS = { ok: C.accent, warn: C.amber, crit: C.red, unknown: C.dim };

export function StatusLamp({ status = 'unknown', className = '', width = 14 }) {
  const color = LAMP_COLORS[status] || C.dim;
  const pulse = status === 'warn' || status === 'crit';
  const palette = { l: color, L: tint(color, 0.5), O: OUTLINE, o: '#2b333d' };
  return (
    <svg
      viewBox="0 0 16 12"
      width={width}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="4" r="5.6" fill={color} className={pulse ? 'r-glow' : undefined} opacity="0.18" />
      {pixelRects(LAMP_ROWS, palette)}
    </svg>
  );
}
