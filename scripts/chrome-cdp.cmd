@echo off
rem A TORRE - Chrome com debug port pro olho AO VIVO do Cockpit.
rem O live-browser.mjs conecta em 127.0.0.1:9222 (TORRE_CDP_PORT) e faz
rem screencast do que este Chrome mostra. Chrome 136+ BLOQUEIA o debug port
rem no perfil default -> perfil dedicado em %LOCALAPPDATA%\torre\chrome-cdp.
rem 1a vez: instalar e logar a extensao "Claude in Chrome" NESTE perfil se a
rem ideia e a IA dirigir este Chrome (o olho mostra qualquer aba dele).
setlocal
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo chrome.exe nao encontrado nos caminhos padrao
  exit /b 1
)
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%LocalAppData%\torre\chrome-cdp" --no-first-run --no-default-browser-check
endlocal
