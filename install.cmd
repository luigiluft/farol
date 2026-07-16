@echo off
rem FAROL - instalador de 2 cliques (Windows). Faz tudo: dependencias,
rem configuracao (3 perguntas), build e abre no navegador.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node 24+ em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

echo [1/4] Instalando dependencias (1-2 min)...
call npm install --no-audit --no-fund
if errorlevel 1 (echo Falha no npm install. & pause & exit /b 1)

echo.
echo [2/4] Configurando (3 perguntas)...
call npm run setup
if errorlevel 1 (pause & exit /b 1)

echo.
echo [3/4] Compilando a interface...
call npm run build
if errorlevel 1 (echo Falha no build. & pause & exit /b 1)

echo.
echo [4/4] Abrindo o Farol...
start "" http://localhost:7777
call npm start
