// FAROL - entry point (scaffold). Monta App no #root.
// Sem StrictMode de proposito: evita double-mount de EventSource (SSE) e d3 em dev.
// F7: initTheme() roda ANTES do createRoot para o <html> ja nascer com
// data-theme correto (default light) e nenhum frame piscar no tema errado.
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './theme.js';
import './index.css';

initTheme();
createRoot(document.getElementById('root')).render(<App />);
