const express = require('express');
const store = require('../store');
const runner = require('../runner');
const { body, schemas } = require('../validate');

const router = express.Router();

router.get('/proxies', (_, res) => res.json(store.allProxies()));

router.post('/proxies', body(schemas.newProxy), (req, res) => {
  if (store.allProxies().some((p) => p.url === req.body.url)) return res.status(409).json({ error: 'Esse proxy já está na lista' });
  res.json(store.addProxy(req.body.url));
});

router.delete('/proxies/:id', (req, res) => {
  store.removeProxy(req.params.id);
  res.json({ ok: true });
});

router.post('/proxies/:id/ping', async (req, res) => {
  const p = store.allProxies().find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proxy não encontrado' });
  const result = await runner.pingProxy(p.url);
  store.updateProxy(p.id, { status: result.ok ? 'online' : 'offline', ms: result.ms, lastCheck: Date.now() });
  res.json(store.allProxies().find((x) => x.id === p.id));
});

module.exports = router;
