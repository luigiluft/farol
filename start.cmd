@echo off
rem FAROL - iniciar (2 cliques). Se nunca instalou, roda install.cmd primeiro.
cd /d "%~dp0"

if not exist node_modules (
  echo Dependencias ausentes — rodando o instalador...
  call install.cmd
  exit /b
)
if not exist web\dist\index.html (
  echo [build] Interface ainda nao compilada...
  call npm run build
  if errorlevel 1 (echo Falha no build. & pause & exit /b 1)
)

start "" http://localhost:7777
call npm start
