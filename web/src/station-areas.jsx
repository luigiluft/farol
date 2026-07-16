// FAROL - F5.10 A ESTACAO (S2; F7 C6): areas estaticas do interior.
// Composicao presentacional pura sobre os sprites do S1
// (station-sprites.jsx): casco (teto/janela/parede/piso), area de
// cafe, lounge (so sofa+tapete = ancora), holotable e doca de carga.
// AreaZones = divisorias de vidro + placas + faixas de piso. (BIBLIOTECA
// removida no redesign painel-de-operacao 2026-06-18; o QUADRO DE CHAMADAS
// que tomou a vaga vive no RoomScene/CallsBoard, nao aqui.)
// Nada aqui tem estado ou efeito; todo movimento e CSS (.st-*/.sa-*)
// com guard de prefers-reduced-motion em scene.css/station-areas.css.
// Sombras = retangulos escuros com alpha (denso e barato; nao anima).
import {
  CoffeeBarSprite, CouchSprite,
  HoloTableSprite, WallRibs, DeckFloor,
  VentGrid, WarnPlate, CargoDockSprite,
  RugSprite, HangarBreach,
} from './station-sprites.jsx';
import { LaunchPadSprite, ServerRackSprite } from './sprites-props.jsx';
import { RadarScope } from './theme-props.jsx';
import Graph from './Graph.jsx';
import { projectColor, actionLabel, isAwaiting } from './roomData.js';
import './station-areas.css';

const CARGO_CAP = 6;

// Tokens do casco consumidos direto nos fills (definidos em scene.css).
const HULL_MID = 'var(--st-hull-mid, #2a3742)';
const HULL_LIGHT = 'var(--st-hull-light, #384757)';
const RIVET = 'var(--st-rivet, #5d6b78)';
const ST_OUTLINE = 'var(--st-outline, #05080d)';
const GLASS = 'var(--st-glass, rgba(127, 214, 232, 0.18))';
const GLASS_EDGE = 'var(--st-glass-edge, rgba(127, 214, 232, 0.38))';

// Cor-tema por area (placas, faixas de piso e LEDs proprios).
const AREA_TONES = {
  lab: 'var(--accent, #3ddc84)',
  cafe: 'var(--amber, #ffb454)',
  lounge: 'var(--cyan, #4dd0e1)',
  hangar: 'var(--cyan, #4dd0e1)',
  doca: 'var(--amber, #ffb454)',
};

// Wrapper de prop estatica: posicao/largura em % da cena via style.
function Prop({ x, y, w, z = 2, cls = '', children }) {
  const style = { left: `${x}%`, top: `${y}%`, width: `${w}%`, zIndex: z };
  return (
    <div className={cls ? `st-prop ${cls}` : 'st-prop'} style={style} aria-hidden="true">
      {children}
    </div>
  );
}

// Sombra simples sob a mobilia: rect escuro com alpha (estatico).
function Shadow({ x, y, w, z = 1 }) {
  const style = { left: `${x}%`, top: `${y}%`, width: `${w}%`, zIndex: z };
  return <div className="st-shadow" style={style} aria-hidden="true" />;
}

// Casco da estacao: teto com ribs + strips LED, janela panoramica
// full-width, parede de fundo e piso de chapas com grades de
// ventilacao, placas de aviso e cabos. A JANELA mostra o UNIVERSO REAL
// do vault: um Graph embedded (scope global, mesma data da view Grafo)
// renderiza ao vivo dentro da moldura. embedded ja esconde busca/hud/
// legenda; o wrapper .st-window-graph fixa pointer-events:none -- e uma
// VISTA pela janela, nunca uma superficie de controle (nao rouba
// click/scroll da cena). fitZoom>1 e o enquadre de VIEWPORT: aproxima
// pra as galaxias PREENCHEREM o vidro (cortar topo/base e desejado --
// uma janela mostra um pedaco, nao o universo inteiro encolhido). A
// moldura/borda do casco fica no .st-window.
export function StationShell() {
  return (
    <>
      <div className="st-ceiling" aria-hidden="true"><WallRibs /></div>
      <div className="st-ceil-led" aria-hidden="true" />
      <div className="st-ceil-led st-ceil-led-b" aria-hidden="true" />
      <div className="st-window">
        <div className="st-window-graph">
          <Graph scope="global" embedded fitZoom={1.9} />
        </div>
      </div>
      <div className="scene-wall" aria-hidden="true" />
      <div className="scene-floor" aria-hidden="true" />
      <div className="st-deck" aria-hidden="true"><DeckFloor /></div>
      <Prop x={21} y={92} w={9}><VentGrid /></Prop>
      <Prop x={45} y={93} w={8}><WarnPlate text="DECK 07" /></Prop>
      {/* consoles do LAB na faixa de chão entre a janela e as mesas
          (cor segue o tema; z acima do piso pra não sumir atrás da parede) */}
      <Prop x={15} y={38.5} w={7.5} z={5}><RadarScope accent="var(--accent, #4dd0e1)" /></Prop>
      <Prop x={72} y={34} w={5} z={5}><ServerRackSprite /></Prop>
    </>
  );
}

// Area de cafe (deck fundo, direita): balcao metalico. Vapor SO na
// caneca de quem esta no cafe (SippingAvatar) -- a maquina parada
// nao emite; vapor vira SINAL de "tem agente ocioso aqui".
export function CoffeeArea() {
  return (
    <>
      <Shadow x={83} y={61.8} w={11} />
      <Prop x={83} y={49.5} w={10.5} z={7}>
        <CoffeeBarSprite />
      </Prop>
    </>
  );
}

// Lounge (deck frente, direita): TAPETE pixel demarcando o chao + sofa
// (ancora de standby/sono dos agentes ociosos). Decoracao morta (planta,
// gato, luminaria, mesinha-holo) REMOVIDA a pedido do dono -- a sala vira
// painel de operacao, nao cenario. O sofa fica: e ancora real de estado.
export function LoungeArea() {
  return (
    <>
      <Prop x={84} y={78.6} w={13} z={3}><RugSprite /></Prop>
      <Shadow x={85.5} y={84.5} w={10} />
      <Prop x={86} y={75} w={9.6} z={6}><CouchSprite /></Prop>
    </>
  );
}

// Holotable central na base da parede: mini-universo holografico com
// pontos nas cores das galaxias (animacao interna do sprite via CSS).
export function HoloTableArea({ colors }) {
  return (
    <>
      <Shadow x={49} y={45.6} w={9} />
      <Prop x={48.8} y={36.8} w={8.8} z={6}><HoloTableSprite colors={colors} /></Prop>
    </>
  );
}

// ------------------------------------------------------------------
// F7 C6: divisao clara dos espacos. Divisorias de VIDRO entre as
// areas, placa-nome por area (WarnPlate tone) e faixa de piso na
// cor-tema. As divisorias sao VISUAIS: as ancoras logicas de
// RoomScene (SLOTS/CAFE_SPOTS/LOUNGE_SEATS/POD_SPOTS) nao mudam.
// ------------------------------------------------------------------

// Divisoria de vidro pixel com caixilho (alta) ou guarda-corpo (low).
function GlassPartition({ low = false }) {
  if (low) {
    return (
      <svg viewBox="0 0 120 20" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
        <rect x={2} y={3} width={116} height={13} fill={GLASS} />
        <rect x={2} y={3} width={116} height={1} fill={GLASS_EDGE} />
        <rect x={0} y={0} width={120} height={3} fill={HULL_MID} />
        <rect x={0} y={0} width={120} height={1} fill={HULL_LIGHT} />
        {[0, 39, 78, 117].map((x) => (
          <g key={x}>
            <rect x={x} y={3} width={3} height={14} fill={HULL_MID} />
            <rect x={x} y={3} width={1} height={14} fill={HULL_LIGHT} />
          </g>
        ))}
        <rect x={0} y={17} width={120} height={2} fill={HULL_MID} />
        <rect x={0} y={19} width={120} height={1} fill={ST_OUTLINE} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 132" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x={3} y={4} width={18} height={122} fill={GLASS} />
      <rect x={3} y={4} width={1} height={122} fill={GLASS_EDGE} />
      <rect x={20} y={4} width={1} height={122} fill={GLASS_EDGE} />
      <rect x={3} y={64} width={18} height={2} fill={GLASS_EDGE} />
      <rect x={0} y={0} width={24} height={4} fill={HULL_MID} />
      <rect x={0} y={0} width={24} height={1} fill={HULL_LIGHT} />
      {[0, 21].map((x) => (
        <g key={x}>
          <rect x={x} y={4} width={3} height={122} fill={HULL_MID} />
          <rect x={x} y={4} width={1} height={122} fill={HULL_LIGHT} />
          <rect x={x + 1} y={10} width={1} height={1} fill={RIVET} />
          <rect x={x + 1} y={120} width={1} height={1} fill={RIVET} />
        </g>
      ))}
      <rect x={0} y={126} width={24} height={6} fill={HULL_MID} />
      <rect x={0} y={126} width={24} height={1} fill={HULL_LIGHT} />
      <rect x={0} y={131} width={24} height={1} fill={ST_OUTLINE} />
    </svg>
  );
}

// Faixa de piso na cor-tema da area (alpha baixo, estatica).
function AreaStripe({ x, y, w, tone }) {
  const style = { left: `${x}%`, top: `${y}%`, width: `${w}%`, '--sa-tone': tone };
  return <div className="sa-stripe" style={style} aria-hidden="true" />;
}

function AreaPlate({ x, y, w, text, tone }) {
  return <Prop x={x} y={y} w={w} z={6}><WarnPlate text={text} tone={tone} /></Prop>;
}

// Zonas da estacao: HANGAR | LAB | CAFE | LOUNGE | BIBLIOTECA |
// DOCA -- faixa de piso + placa por area e divisorias de vidro.
// Refino anti-ruido (2026-06-12): LEDs de area e decalques de
// circulacao REMOVIDOS -- a placa + faixa ja orientam; cada ponto
// de luz extra competia com os sinais reais (mesas/balao/telao).
export function AreaZones() {
  const T = AREA_TONES;
  return (
    <>
      <AreaStripe x={1} y={51.5} w={19} tone={T.hangar} />
      <AreaStripe x={25} y={48.2} w={53} tone={T.lab} />
      <AreaStripe x={80.5} y={66.8} w={18.5} tone={T.cafe} />
      <AreaStripe x={80.5} y={88.5} w={18.5} tone={T.lounge} />
      <AreaStripe x={1} y={95.5} w={13} tone={T.doca} />
      <Prop x={20.2} y={45} w={2.8} z={9} cls="sa-part"><GlassPartition /></Prop>
      <Prop x={78.4} y={45} w={2.8} z={9} cls="sa-part"><GlassPartition /></Prop>
      <Prop x={82.5} y={69} w={13.5} z={6} cls="sa-part"><GlassPartition low /></Prop>
      <AreaPlate x={5} y={50.2} w={7} text="HANGAR" tone={T.hangar} />
      <AreaPlate x={53} y={43.5} w={4} text="LAB" tone={T.lab} />
      <AreaPlate x={83.2} y={47.2} w={4.4} text="CAFE" tone={T.cafe} />
      <AreaPlate x={91.8} y={79} w={5.5} text="LOUNGE" tone={T.lounge} />
      <AreaPlate x={2} y={86} w={4.2} text="DOCA" tone={T.doca} />
    </>
  );
}

// ------------------------------------------------------------------
// DOCA DE NAVES (S2.2): o HANGAR substitui o dormitorio. A area
// esquerda vira um hangar ABERTO AO ESPACO -- uma brecha no casco
// (HangarBreach: starfield + galaxias) no alto, por onde as naves
// saem; embaixo, as PLATAFORMAS de pouso (chapas). As naves grandes
// (paradas E em decolagem) sao renderizadas pelo RoomScene (LaunchBay)
// como o MESMO elemento por plataforma -- a nave parada e a que decola.
// Aqui mora SO a cenografia FIXA do hangar: a brecha e as plataformas.
// ------------------------------------------------------------------

// Plataformas de pouso (% da cena; alinhadas com LAUNCH_PADS do
// RoomScene). A brecha fica ACIMA delas: a nave decola subindo.
const HANGAR_PADS = [
  { x: 3.0, y: 73.5, w: 9.5 },
  { x: 11.5, y: 73.5, w: 9.5 },
];

export function HangarBay({ colors }) {
  const pads = colors && colors.length ? colors : ['#3ddc84', '#4dd0e1'];
  return (
    <div className="st-hangar" role="group" aria-label="Doca de naves">
      {/* brecha no casco aberta ao espaco -- saida das naves */}
      <div className="st-hangar-breach" aria-hidden="true">
        <HangarBreach galaxyColors={colors} />
      </div>
      {/* plataformas de pouso (chapas estaticas); a nave fica por cima,
          renderizada pelo RoomScene */}
      {HANGAR_PADS.map((p, i) => (
        <div key={`hp-${i}`} className="st-hangar-slot" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%` }}>
          <span className="st-hangar-pad"><LaunchPadSprite color={pads[i % pads.length]} width="100%" /></span>
        </div>
      ))}
    </div>
  );
}

// #3 esteira de fluxo: posicao da carga (sessao kind=tarefa) no belt = PROGRESSO.
// Feito (awaiting) -> ponta direita carimbado; com checklist -> done/total; sem
// checklist -> por estado (ativa=meio em andamento, senao entrada/fila a esquerda).
function cargoProgress(s) {
  if (isAwaiting(s)) return 0.94;
  const tasks = Array.isArray(s.tasks) ? s.tasks.filter((t) => t && t.title) : [];
  if (tasks.length) {
    const done = tasks.filter((t) => t.status === 'completed').length;
    return 0.08 + (done / tasks.length) * 0.82;
  }
  return s.state === 'ativa' ? 0.5 : 0.12;
}

// Esteira de carga: sessoes kind=tarefa como containers na cor do projeto, que
// ANDAM no belt conforme o checklist avanca (transition em left) e saem
// carimbadas na ponta. O belt rola (estrias) = "esteira de verdade". Cap 6.
export function CargoDock({ cargo }) {
  if (!cargo || cargo.length === 0) return null;
  const shown = cargo.slice(0, CARGO_CAP);
  const extra = cargo.length - shown.length;
  return (
    <div className="scene-cargo" aria-label="Esteira de carga">
      <span className="cargo-label">esteira</span>
      <div className="cargo-belt-track" aria-hidden="true" />
      {shown.map((s) => (
        <span
          key={s.id}
          className={`st-cargo-item cargo-${s.state}${isAwaiting(s) ? ' cargo-feito' : ''}`}
          style={{ left: `${Math.round(cargoProgress(s) * 100)}%` }}
          tabIndex={0}
        >
          <CargoDockSprite color={projectColor(s.project)} />
          {isAwaiting(s) ? <span className="cargo-check" aria-hidden="true">✓</span> : null}
          <span className="desk-tooltip cargo-tooltip" role="tooltip">
            <span className="tt-title">{s.project || 'sessao'}</span>
            <span className="tt-row"><span className="tt-key">acao</span><span>{actionLabel(s) || 'n/d'}</span></span>
            {s.promptPreview ? <span className="tt-preview">{s.promptPreview}</span> : null}
          </span>
        </span>
      ))}
      {extra > 0 ? <span className="cargo-badge">+{extra}</span> : null}
    </div>
  );
}
