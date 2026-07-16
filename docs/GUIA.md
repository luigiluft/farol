# FAROL — guia de operação (como alimentar cada tela)

> Instalou e abriu? Este guia mostra o que alimenta cada view e como
> estruturar seus arquivos pra tirar o máximo. Em português porque o beta
> é BR — versão EN vem se houver demanda.

## O princípio

O Farol **não pede que você mude seu jeito de trabalhar**. Ele lê duas coisas
que já existem: seus arquivos `.md` (vault) e os transcripts do Claude Code.
A maior parte das telas funciona de cara com qualquer vault. Algumas telas
ganham superpoderes com convenções simples — todas opcionais.

## O que funciona de cara (zero convenção)

| View | O que alimenta | Observação |
|---|---|---|
| **Torre (universo)** | Qualquer pasta de `.md` | Pastas de 1º nível viram planetas; `[[wikilinks]]` viram as constelações — quanto mais você linka, mais bonito fica |
| **Notas** | Seu vault inteiro | Editor completo: criar, renomear, excluir, buscar |
| **Comando** | Sessões do Claude Code | Quem trabalha, quem espera você, gasto do dia |
| **Cockpit** | Transcripts do Claude Code | Terminal, olho, pergunta pendente — tudo automático |
| **Uso** | Transcripts do Claude Code | Tokens por dia/projeto/modelo, sem configurar nada |
| **Sala** | Sessões do Claude Code | A frota em pixel-art |
| **Diário** | Transcripts (+ chave opcional) | Sem `OPENROUTER_API_KEY` = resumo mecânico; com = prosa |

Sem sessões do Claude Code rodando, essas telas ficam em estado vazio — é
normal. Abra uma sessão e veja a nave aparecer.

## Convenções opcionais (cada uma destrava algo)

### 1. Estrutura PARA (recomendada, não obrigatória)

O Farol foi criado sobre um vault [PARA](https://fortelabs.com/blog/para/):

```
vault/
  0-Inbox/       <- capturas rapidas (vira o cinturao de detritos no universo)
  1-Projects/    <- um subdiretorio por projeto
  2-Areas/
  3-Resources/
  6-Daily/       <- uma nota por dia: AAAA-MM-DD.md
```

Qualquer estrutura funciona — mas `1-Projects/` e `6-Daily/` destravam as
views abaixo.

### 2. View **Projetos**: subpastas de `1-Projects/`

Cada subpasta de `1-Projects/` vira um card. Só isso.

### 3. View **Agenda** + tile HOJE: daily notes com seção Agenda

Arquivo `6-Daily/2026-07-06.md`:

```markdown
# Segunda, 6 de julho

## Agenda

- [09:00] Daily do time
- [14:00 - 15:30] Call com cliente
- [19:00] Academia

## Tarefas

- [ ] Revisar proposta
- [x] Pagar boleto
```

O formato das linhas de evento é `- [HH:MM] texto` (ou `- [HH:MM - HH:MM]`
com fim). A view Agenda monta o calendário e a timeline do dia a partir disso.

**Google Calendar?** O Farol não conecta em serviço nenhum (local-first,
por design). Se você quiser seus eventos do Google aqui, escreva-os na daily
note — à mão ou com a automação que preferir (um script seu, Zapier, etc.).
Integração nativa está no roadmap se houver demanda.

### 4. Card **Pendências** (no Comando): pasta `_Pendencias`

Um arquivo por pendência em `1-Projects/_Pendencias/`, com status no
frontmatter:

```markdown
---
status: 🔴
effort: 15-30min
---

Ligar pro contador antes de sexta.
```

Status: `🔴` urgente · `🟡` importante · `⚪` quando der. O Comando mostra
as top por urgência.

### 5. Nomes da frota: `.data/topics.json`

O wizard (`npm run setup`) já cria. Suas sessões ganham nomes como
`meuapp-1` em vez de aleatórios. Pra editar depois:

```json
[
  { "topic": "meuapp", "pattern": "meuapp|checkout|loja" },
  { "topic": "blog",   "pattern": "blog|post|artigo" }
]
```

A primeira regra que casar com o seu primeiro prompt da sessão dá o nome.

### 6. View **Esteira**: suas automações (avançado, Windows)

Se você tem tarefas agendadas (Task Scheduler), declare-as em
`.data/esteira.json` pra vê-las com histórico de execução:

```json
{
  "MinhaAutomacao": {
    "what": "Faz backup das fotos",
    "src": ["Pasta X"], "dst": ["NAS"],
    "cadence": "diario 02:00", "claude": false
  }
}
```

Log rico por execução: rode o comando da task através de
`scripts/esteira-log.mjs` (veja o cabeçalho do arquivo).

## Extras opcionais

| Extra | Como ligar |
|---|---|
| Prosa do Diário | `OPENROUTER_API_KEY` no `.env` ([chave aqui](https://openrouter.ai/keys)) |
| Olho AO VIVO no Cockpit | `scripts/chrome-cdp.cmd` (Chrome dedicado com CDP) |
| Abrir no boot do Windows | agendar `scripts/torre-autostart.mjs` como tarefa de logon |
| Celular (PWA) | mesma rede/VPN privada → `http://<seu-pc>:7777` → "Adicionar à tela inicial" |

## Só quero ver funcionando

`npm run demo` — sobe tudo com um vault fictício e sessões fake trabalhando.
Bom pra conhecer as telas antes de plugar nos seus dados.
