# FAROL — guia do beta fechado

Valeu por testar. Isso aqui leva **5 minutos** de verdade.

## Instalar (Windows)

1. Baixe o projeto: botão verde **Code → Download ZIP** (ou `git clone`), extraia onde quiser.
2. **Dê 2 cliques em `install.cmd`.** Ele instala tudo, faz 3 perguntas
   (onde está seu vault de notas, chave opcional, seus projetos) e abre o
   Farol no navegador.

Pra abrir de novo depois: 2 cliques em `start.cmd`.

Requisitos: [Node 24+](https://nodejs.org) e o [Claude Code](https://claude.com/claude-code)
instalado (é ele que gera os dados que o Farol mostra). Vault Obsidian é ideal,
mas qualquer pasta com arquivos `.md` serve.

## O que olhar primeiro

1. **Comando do Dia** — sua home: quem está trabalhando e quem está te esperando.
2. Abra 1-2 sessões do Claude Code e vá na aba **TORRE**: suas sessões viram
   naves no universo das suas notas.
3. **Cockpit** — o que cada sessão está vendo, ao vivo.
4. **Uso** — quanto cada projeto te custou de tokens.

Sem sessões do Claude Code rodando, o Farol fica em estado vazio — é normal.
Ele ganha vida conforme você trabalha.

Quer destravar as telas de Agenda, Projetos e Pendências? Leia o
**[docs/GUIA.md](docs/GUIA.md)** — 5 min, mostra o que alimenta cada view e as
convenções opcionais (ex.: daily note com `- [14:00] evento` vira sua agenda).

## Como reportar

- Bug ou ideia: abra uma **Issue** aqui no repo (print ajuda muito; a página
  `http://localhost:7777/api/health` diz o estado da sua instalação).
- Travou na instalação: me chama direto com o print do erro.

## As 2 perguntas que eu vou te fazer no fim da semana

1. Você abriu o Farol quantos dias essa semana?
2. Se custasse dinheiro, você pagaria? Quanto?

Respostas honestas valem mais que elogio. Se a resposta for "não usei", isso
também é dado — me conta o porquê.
