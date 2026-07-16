// FAROL - sprites.jsx (HD, F6): barrel da geracao 4.0 "Torre HD".
// O modulo monolitico do F4 foi dividido em dois (limite de tamanho de
// arquivo) preservando TODOS os exports publicos deste caminho:
// - sprites-crew.jsx: nucleo pixel-art (pixelRects/PixelSprite/
//   SwapSprite/norm/shade/tint) + avatares deterministicos + minions.
// - sprites-props.jsx: mesa, porta, drones, LED, Zzz, StatusLamp.
// Consumidores seguem importando de './sprites.jsx' sem mudanca.
export {
  SPRITE_COLORS, OUTLINE,
  AVATAR_ACCESSORIES, hashSeed, gerarAvatar, AvatarSprite, OperatorSprite,
  gerarMinionAvatar, MinionAvatarSprite, MinionSprite,
} from './sprites-crew.jsx';

export {
  DeskSprite, DoorSprite, DroneSprite, CargoDroneSprite,
  LedSprite, ZzzSprite, StatusLamp,
} from './sprites-props.jsx';
