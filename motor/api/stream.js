const express = require('express');
const store = require('../store');
const runner = require('../runner');

const router = express.Router();

const sse = (res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
};

router.get('/feed', (_, res) => res.json(store.recentEvents(60)));

// Eventos em tempo real (status, ações, logs, alertas, avisos)
router.get('/stream', (req, res) => {
  sse(res);
  const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  runner.hub.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    runner.hub.off('event', on);
    clearInterval(ping);
  });
});

// Transmissão da tela do navegador de uma conta
router.get('/live/:id', (req, res) => {
  sse(res);
  const id = req.params.id;
  const last = runner.lastFrame(id);
  if (last) res.write(`data: ${last}\n\n`);
  const on = (fid, data) => fid === id && res.write(`data: ${data}\n\n`);
  runner.hub.on('frame', on);
  req.on('close', () => runner.hub.off('frame', on));
});

module.exports = router;
