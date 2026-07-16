// FAROL - registry de NOMES LOGICOS da frota (v4, 2026-07-03).
// O nome nasce no server (sessions payload: .name = 'topico-N'); o api.js
// registra aqui a cada snapshot/SSE e o callsigns.js consulta ANTES de cair
// no nome de estrela. Modulo sem dependencias de proposito: quebra o ciclo
// api.js -> callsigns.js -> roomData.js -> api.js.

const nameById = new Map();

export function registerFleetNames(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  // nao limpa o mapa inteiro: sessao que saiu da janela mantem o ultimo nome
  // conhecido (dossie/diario abertos sobre ela continuam legiveis)
  for (const s of list) {
    if (s && s.id && typeof s.name === 'string' && s.name) {
      nameById.set(s.id, s.name);
    }
  }
}

export function getFleetName(id) {
  return nameById.get(String(id || '')) || null;
}
