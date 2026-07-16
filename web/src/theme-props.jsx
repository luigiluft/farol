// FAROL - theme-props.jsx (v5 salas temáticas por projeto).
// Props pixel-art TEMÁTICOS por projeto, portados fielmente da simulação
// v5 (torre-sala-sim.html, validada visualmente com o dono em 2026-06-23).
// Cada tema conhecido ganha 1 prop de PAREDE (wall) + 2 de CHÃO (floor) que dizem
// o ramo do negócio sem texto (ex.: logística, esporte,
// fiscal).  Projeto sem tema cai no neutro (NeutralBoard +
// CrateProp), nunca quebra. SVG estático crispEdges; zero animação aqui.
// A cor (`c`) vem do tema do projeto (roomThemes.js); o resto é fixo.

// Tema A — logística: mapa de rotas (parede), pallet de carga (chão),
// planta (toque agro).
const ROUTE_PINS = [[4, 15], [12, 9], [20, 12], [25, 5]];
const ROUTE_SEGS = [[4, 15, 12, 9], [12, 9, 20, 12], [20, 12, 25, 5]];

function routeDots(seg) {
  const out = [];
  for (let t = 0; t < 6; t += 1) {
    const x = seg[0] + ((seg[2] - seg[0]) * t) / 6;
    const y = seg[1] + ((seg[3] - seg[1]) * t) / 6;
    out.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
  }
  return out;
}

export function RouteMap({ accent: c = '#3ddc84' }) {
  return (
    <svg width="58" height="40" viewBox="0 0 29 20" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="29" height="20" fill="#0c141c" stroke={c} />
      <rect x="0" y="0" width="29" height="2" fill={c} opacity=".5" />
      <rect x="2" y="4" width="25" height="14" fill="#0a1820" />
      <g fill={c}>
        {ROUTE_PINS.map(([x, y], i) => (
          <rect key={i} x={x - 1} y={y - 1} width="3" height="3" />
        ))}
      </g>
      <g fill="#46586c">
        {ROUTE_SEGS.flatMap((seg, si) => routeDots(seg).map((d, di) => (
          <rect key={`${si}-${di}`} x={d.x} y={d.y} width="1" height="1" />
        )))}
      </g>
      <rect x="11" y="8" width="2" height="2" fill="#ffb454" />
    </svg>
  );
}

export function Pallet({ accent: c = '#3ddc84' }) {
  return (
    <svg width="40" height="30" viewBox="0 0 20 15" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="2" width="7" height="6" fill="#b8906d" />
      <rect x="2" y="2" width="7" height="1" fill="#cda47e" />
      <rect x="2" y="4" width="7" height="1" fill={c} opacity=".7" />
      <rect x="11" y="3" width="7" height="5" fill="#a07850" />
      <rect x="11" y="3" width="7" height="1" fill="#c39a72" />
      <rect x="6" y="0" width="6" height="3" fill="#9a7048" />
      <rect x="6" y="0" width="6" height="1" fill="#b78a5c" />
      <rect x="1" y="11" width="18" height="2" fill="#6f4d3a" />
      <rect x="1" y="13" width="18" height="1" fill="#523a2c" />
      <rect x="2" y="9" width="3" height="2" fill="#5a3f30" />
      <rect x="9" y="9" width="3" height="2" fill="#5a3f30" />
      <rect x="15" y="9" width="3" height="2" fill="#5a3f30" />
    </svg>
  );
}

export function PlantProp() {
  return (
    <svg width="30" height="40" viewBox="0 0 15 20" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="0" width="3" height="7" fill="#3ddc84" />
      <rect x="3" y="3" width="3" height="5" fill="#37c878" />
      <rect x="9" y="3" width="3" height="5" fill="#37c878" />
      <rect x="2" y="6" width="3" height="4" fill="#2fae68" />
      <rect x="10" y="6" width="3" height="4" fill="#2fae68" />
      <rect x="4" y="12" width="7" height="7" fill="#8a5a3c" />
      <rect x="4" y="12" width="7" height="2" fill="#a06a46" />
    </svg>
  );
}

// Tema B — esporte: leaderboard (parede), golf bag (chão), putting green
// com bandeira (chão).
export function Leaderboard({ accent: c = '#4dd0e1' }) {
  return (
    <svg width="50" height="40" viewBox="0 0 25 20" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="25" height="20" fill="#0c141c" stroke={c} />
      <rect x="0" y="0" width="25" height="3" fill={c} opacity=".55" />
      <rect x="2" y="1" width="2" height="2" fill="#0a0e13" />
      <polygon points="3,1 7,1.6 3,2.2" fill="#0a0e13" />
      <rect x="3" y="6" width="2" height="2" fill={c} />
      <rect x="7" y="6" width="12" height="2" fill="#46586c" />
      <rect x="3" y="10" width="2" height="2" fill={c} opacity=".7" />
      <rect x="7" y="10" width="9" height="2" fill="#34465a" />
      <rect x="3" y="14" width="2" height="2" fill={c} opacity=".5" />
      <rect x="7" y="14" width="14" height="2" fill="#34465a" />
    </svg>
  );
}

export function GolfBag({ accent: c = '#4dd0e1' }) {
  return (
    <svg width="20" height="42" viewBox="0 0 10 21" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="0" width="1" height="8" fill="#9aa8b8" />
      <rect x="4" y="0" width="1" height="8" fill="#9aa8b8" />
      <rect x="6" y="1" width="1" height="7" fill="#9aa8b8" />
      <rect x="1.5" y="0" width="2" height="1" fill="#e8eef5" />
      <rect x="3.5" y="0" width="2" height="1" fill="#e8eef5" />
      <rect x="5.5" y="1" width="2" height="1" fill="#e8eef5" />
      <rect x="2" y="7" width="6" height="13" rx="2" fill="#222c36" />
      <rect x="2" y="7" width="6" height="13" rx="2" fill="none" stroke={c} />
      <rect x="2" y="11" width="6" height="2" fill={c} opacity=".8" />
      <rect x="3" y="15" width="4" height="1" fill="#46586c" />
    </svg>
  );
}

export function PuttGreen({ accent: c = '#4dd0e1' }) {
  return (
    <svg width="50" height="26" viewBox="0 0 25 13" shapeRendering="crispEdges" aria-hidden="true">
      <ellipse cx="12" cy="9" rx="11" ry="3.6" fill="#2f8f5a" />
      <ellipse cx="12" cy="9" rx="11" ry="3.6" fill="none" stroke="#3dbf72" opacity=".7" />
      <ellipse cx="12" cy="9" rx="7" ry="2.2" fill="#36a566" />
      <rect x="15" y="1" width="1" height="8" fill="#cfcfcf" />
      <polygon points="16,1 21,2.3 16,3.6" fill={c} />
      <ellipse cx="15.5" cy="9" rx="1.1" ry="0.6" fill="#05080d" />
      <circle cx="8" cy="9" r="1" fill="#fff" />
    </svg>
  );
}

// Tema C — fiscal: nota fiscal NF-e (parede), terminal POS (chão),
// prateleira de loja (chão), bandeirinha BR (selo de marca).
const NFE_BARCODE = [3, 4, 4.6, 5.6, 6.2, 7.2, 8, 9, 9.6, 10.6, 11.2, 12.2, 13];

export function NFe({ accent: c = '#b48cfa' }) {
  return (
    <svg width="34" height="44" viewBox="0 0 17 22" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="0" width="15" height="20" fill="#eef4fb" />
      <rect x="1" y="0" width="15" height="3" fill={c} />
      <rect x="2.5" y="1" width="8" height="1" fill="#fff" />
      <rect x="3" y="5" width="11" height="1" fill="#46586c" />
      <rect x="3" y="7" width="8" height="1" fill="#8aa0b4" />
      <rect x="3" y="9" width="11" height="1" fill="#8aa0b4" />
      <rect x="3" y="11" width="6" height="1" fill="#46586c" />
      <g fill="#1f2933">
        {NFE_BARCODE.map((x, i) => (
          <rect key={i} x={x} y="14" width={i % 2 ? 0.4 : 0.8} height="4" />
        ))}
      </g>
      <polygon points="1,20 3,20 2,22" fill="#eef4fb" />
      <polygon points="5,20 7,20 6,22" fill="#eef4fb" />
      <polygon points="9,20 11,20 10,22" fill="#eef4fb" />
      <polygon points="13,20 15,20 14,22" fill="#eef4fb" />
    </svg>
  );
}

export function PosTerminal({ accent: c = '#b48cfa' }) {
  return (
    <svg width="34" height="30" viewBox="0 0 17 15" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="8" width="13" height="6" fill="#2a3742" stroke="#05080d" />
      <rect x="4" y="2" width="9" height="7" fill="#1b242e" stroke="#05080d" />
      <rect x="5" y="3" width="7" height="4" fill={c} opacity=".7" />
      <rect x="5" y="3" width="7" height="1" fill="#fff" opacity=".3" />
      <rect x="4" y="10" width="2" height="1" fill="#46586c" />
      <rect x="7" y="10" width="2" height="1" fill="#46586c" />
      <rect x="10" y="10" width="2" height="1" fill="#46586c" />
      <rect x="4" y="12" width="2" height="1" fill="#46586c" />
      <rect x="7" y="12" width="2" height="1" fill="#46586c" />
      <rect x="11" y="11" width="2" height="2" fill={c} />
      <rect x="6" y="14" width="5" height="1" fill="#d4c08a" />
    </svg>
  );
}

export function ShopShelf() {
  return (
    <svg width="38" height="30" viewBox="0 0 19 15" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="1" width="17" height="13" fill="#161e26" stroke="#05080d" />
      <rect x="1" y="7" width="17" height="1" fill="#2a3742" />
      <rect x="1" y="13" width="17" height="1" fill="#2a3742" />
      <rect x="3" y="3" width="3" height="4" fill="#ff6e9c" />
      <rect x="7" y="2" width="3" height="5" fill="#5ea2ff" />
      <rect x="11" y="3" width="3" height="4" fill="#c8e64c" />
      <rect x="14" y="4" width="3" height="3" fill="#ffb454" />
      <rect x="3" y="9" width="3" height="4" fill="#4dd0e1" />
      <rect x="7" y="9" width="4" height="4" fill="#b48cfa" />
      <rect x="12" y="10" width="3" height="3" fill="#3ddc84" />
    </svg>
  );
}

// Selo BR: bandeirinha do Brasil (marca do tema fiscal). Sem texto.
export function BrTag() {
  return (
    <svg width="18" height="13" viewBox="0 0 18 13" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="18" height="13" fill="#1f9e57" />
      <polygon points="9,1.5 16.5,6.5 9,11.5 1.5,6.5" fill="#ffd83a" />
      <circle cx="9" cy="6.5" r="2.7" fill="#1c3a8a" />
      <rect x="6.6" y="6" width="4.8" height="0.9" fill="#fff" transform="rotate(-8 9 6.5)" />
    </svg>
  );
}

// NEUTRO — projeto sem tema definido: caixote genérico (chão) + quadro de
// status liso (parede). Mantém a sala legível sem fingir uma identidade.
export function CrateProp({ accent: c = '#5d6b78' }) {
  return (
    <svg width="28" height="24" viewBox="0 0 14 12" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="14" height="12" fill="#26323e" stroke="#05080d" />
      <rect x="0" y="0" width="14" height="2" fill="#3a4a5a" />
      <rect x="0" y="5" width="14" height="1" fill={c} opacity=".6" />
      <rect x="6" y="2" width="2" height="8" fill="#1b242e" />
    </svg>
  );
}

export function NeutralBoard({ accent: c = '#5d6b78' }) {
  return (
    <svg width="50" height="40" viewBox="0 0 25 20" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="25" height="20" fill="#0c141c" stroke={c} />
      <rect x="0" y="0" width="25" height="3" fill={c} opacity=".45" />
      <rect x="3" y="6" width="16" height="1" fill="#46586c" />
      <rect x="3" y="9" width="12" height="1" fill="#34465a" />
      <rect x="3" y="12" width="14" height="1" fill="#34465a" />
      <rect x="3" y="15" width="9" height="1" fill="#34465a" />
    </svg>
  );
}

// Relógio de parede (comum a todas as salas): ponteiro na cor do tema.
export function WallClock({ accent: c = '#4dd0e1' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill="#0c141c" stroke="#46586c" />
      <rect x="5.5" y="2.5" width="1" height="3.5" fill={c} />
      <rect x="6" y="6" width="3" height="1" fill="#cfe6ff" />
    </svg>
  );
}

// Radar de controle (parede, comum a todas as salas — on-brand "Torre de
// Controle"): scope redondo com anéis concêntricos, cunha de varredura e
// blips. Acento na cor do tema. Estático (varredura = só o frame; CSS pode
// girar a cunha depois sem mexer aqui). width="100%" → escala pelo container.
export function RadarScope({ accent: c = '#4dd0e1', width = '100%' }) {
  return (
    <svg width={width} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <circle cx="14" cy="14" r="13" fill="#0a1820" stroke="#46586c" />
      <circle cx="14" cy="14" r="13" fill="none" stroke={c} strokeOpacity=".35" />
      <circle cx="14" cy="14" r="9.3" fill="none" stroke={c} strokeOpacity=".22" />
      <circle cx="14" cy="14" r="5.4" fill="none" stroke={c} strokeOpacity=".22" />
      <line x1="14" y1="1.4" x2="14" y2="26.6" stroke={c} strokeOpacity=".14" />
      <line x1="1.4" y1="14" x2="26.6" y2="14" stroke={c} strokeOpacity=".14" />
      <polygon points="14,14 26.5,7.5 27,14.2" fill={c} fillOpacity=".30" />
      <line x1="14" y1="14" x2="26.6" y2="7.6" stroke={c} strokeWidth=".7" />
      <rect x="18.6" y="9.2" width="1.5" height="1.5" fill={c} />
      <rect x="9" y="17.4" width="1.4" height="1.4" fill="#ffb454" />
      <rect x="16.5" y="18" width="1.2" height="1.2" fill={c} fillOpacity=".7" />
      <circle cx="14" cy="14" r="1.15" fill={c} />
    </svg>
  );
}
