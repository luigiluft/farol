// FAROL - MiniAvatar (Q3): o mesmo avatar determinístico da Sala, em
// tamanho de lista. Dá identidade (rosto + cor do projeto) às superfícies
// DENSAS (Quadro de Voos, Operações, Mobile) sem a cena-diorama completa
// — essa fica exclusiva da Sala. Reusa AvatarSprite (sprites.jsx); pose
// estática 'idle' (lista não é lugar de animar typing).
import { AvatarSprite } from './sprites.jsx';
import { projectColor } from './roomData.js';

export default function MiniAvatar({ session, width = 16 }) {
  if (!session) return null;
  return (
    <span
      className="mini-av"
      style={{ display: 'inline-flex', alignItems: 'flex-end', flex: '0 0 auto', lineHeight: 0 }}
      aria-hidden="true"
    >
      <AvatarSprite id={session.id} uniform={projectColor(session.project)} pose="idle" width={width} />
    </span>
  );
}
