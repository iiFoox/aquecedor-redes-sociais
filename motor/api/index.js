// API interna do motor. Só o painel fala com ela (escuta apenas em 127.0.0.1).
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const store = require('../store');
const runner = require('../runner');
const { version } = require('../../package.json');

// Atalho criado por "npm run autostart:ligar"
const AUTOSTART = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
  'WarmUp Studio.vbs',
);

function createApi() {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      sessions: Object.keys(runner.activeSessions()).length,
      pending: store.pendingCount(),
    });
  });
  // Situação do motor para a tela de ajustes
  app.get('/api/system', (_, res) => {
    res.json({
      version,
      uptime: Math.round(process.uptime()),
      pm2: process.env.pm_id !== undefined,
      restarts: Number(process.env.restart_time) || 0,
      autostart: fs.existsSync(AUTOSTART),
      sessions: Object.keys(runner.activeSessions()).length,
      pending: store.pendingCount(),
      tz: require('../rules').TZ,
    });
  });
  app.use('/api', require('./accounts'), require('./proxies'), require('./config'), require('./stream'));
  app.use('/api', (_, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // JSON quebrado no corpo vira 400; o resto, 500 com a causa no terminal
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corpo da requisição não é um JSON válido' });
    console.error('Erro na API do motor:', err);
    res.status(500).json({ error: 'Erro interno no motor' });
  });
  return app;
}

module.exports = { createApi };
