// FAROL - topicos e NOMES LOGICOS da frota (decisao 2026-07-03: nome de
// sessao = topico-N, fim das estrelas aleatorias como nome primario).
// inferTopic: classifica a missao (primeiro prompt) num topico de projeto —
// o project do transcript e quase sempre 'home', o "quem e" vem daqui.
// createFleetNamer: numera sessoes DENTRO do topico por ordem de inicio,
// sem renumerar enquanto a sessao viver (numero so e liberado quando a
// sessao sai da janela). Fonte unica: o nome nasce no payload do server e
// todas as superficies (desktop/mobile/toast) enxergam o mesmo.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

// Regras do USUARIO vivem em .data/topics.json (gitignored):
// [{ "topic": "meu-projeto", "pattern": "regex-fonte" }, ...] — flags 'i',
// ordem importa (primeiro padrao que casar vence), e o arquivo SUBSTITUI a
// lista inteira quando presente. Sem arquivo, valem so os defaults genericos.
const DEFAULT_TOPIC_RULES = [
  ['torre', /torre|cockpit|7777|vault|obsidian|grafo|sala da torre/i],
  ['setup-claude', /claude|skill|mcp|hook|subagent|prompt/i],
];

// Exportado para teste (aceita path explicito). Fail-closed: arquivo ausente,
// JSON quebrado ou regex invalida => defaults, com erro logado uma vez.
export function loadTopicRules(file = path.join(DATA_DIR, 'topics.json')) {
  try {
    if (!fs.existsSync(file)) return DEFAULT_TOPIC_RULES;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rules = (Array.isArray(raw) ? raw : [])
      .filter((r) => r && typeof r.topic === 'string' && typeof r.pattern === 'string')
      .map((r) => [r.topic, new RegExp(r.pattern, 'i')]);
    return rules.length ? rules : DEFAULT_TOPIC_RULES;
  } catch (err) {
    console.error('[topics] topics.json invalido, usando defaults:', err.message);
    return DEFAULT_TOPIC_RULES;
  }
}

export const TOPIC_RULES = loadTopicRules();

export function inferTopic(firstPrompt) {
  const s = String(firstPrompt || '');
  if (!s) return 'outros';
  for (const [topic, re] of TOPIC_RULES) {
    if (re.test(s)) return topic;
  }
  return 'outros';
}

// Namer com estado proprio (factory: testavel sem vazar estado global).
// assign(sessions) espera objetos { id, topic, startedTs } e escreve .name.
// Regras: (1) quem ja tem nome mantem; (2) novos recebem o MENOR numero
// livre do topico, em ordem de startedTs; (3) numero e liberado quando o id
// some do payload (sessao saiu da janela de 4h).
export function createFleetNamer() {
  const nameById = new Map(); // id -> 'topico-N'
  const heldByTopic = new Map(); // topico -> Set<numero>

  const holdSet = (topic) => {
    let set = heldByTopic.get(topic);
    if (!set) {
      set = new Set();
      heldByTopic.set(topic, set);
    }
    return set;
  };

  return function assign(sessions) {
    const list = Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [];
    const present = new Set(list.map((s) => s.id));

    // libera numeros de sessoes que sairam da janela
    for (const [id, name] of nameById) {
      if (present.has(id)) continue;
      const cut = name.lastIndexOf('-');
      const topic = name.slice(0, cut);
      heldByTopic.get(topic)?.delete(Number(name.slice(cut + 1)));
      nameById.delete(id);
    }

    // novos entram em ordem de inicio (numeracao previsivel)
    const pending = list
      .filter((s) => !nameById.has(s.id))
      .sort((a, b) => Date.parse(a.startedTs || 0) - Date.parse(b.startedTs || 0));
    for (const s of pending) {
      const topic = s.topic || 'outros';
      const held = holdSet(topic);
      let n = 1;
      while (held.has(n)) n += 1;
      held.add(n);
      nameById.set(s.id, topic + '-' + n);
    }

    for (const s of list) s.name = nameById.get(s.id);
    return list;
  };
}
