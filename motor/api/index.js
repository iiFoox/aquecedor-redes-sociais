// API interna do motor. Só o painel fala com ela (escuta apenas em 127.0.0.1).
const express = require('express');
const store = require('../store');
const runner = require('../runner');

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
  app.use('/api', require('./accounts'), require('./proxies'), require('./config'), require('./analytics'), require('./stream'));
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
