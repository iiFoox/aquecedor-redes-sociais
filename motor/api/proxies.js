const express = require('express');
const store = require('../store');
const runner = require('../runner');
const { body, schemas } = require('../validate');

const router = express.Router();

// Lista com quantas contas usam cada proxy
router.get('/proxies', (_, res) => {
  const accounts = store.all();
  res.json(
    store.allProxies().map((p) => ({
      ...p,
      accounts: accounts.filter((a) => a.proxy === p.url).map((a) => ({ id: a.id, username: a.username, platform: a.platform })),
    })),
  );
});

router.post('/proxies', body(schemas.newProxy), (req, res) => {
  if (store.allProxies().some((p) => p.url === req.body.url)) return res.status(409).json({ error: 'Esse proxy já está na lista' });
  res.json(store.addProxy(req.body.url));
});

router.delete('/proxies/:id', (req, res) => {
  const p = store.allProxies().find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proxy não encontrado' });
  const users = store.all().filter((a) => a.proxy === p.url);
  if (users.length) {
    return res
      .status(409)
      .json({ error: `Esse proxy está em uso por ${users.map((a) => `@${a.username}`).join(', ')}. Troque o proxy delas antes.` });
  }
  store.removeProxy(p.id);
  res.json({ ok: true });
});

// Teste na hora, sem abrir navegador
router.post('/proxies/:id/ping', async (req, res) => {
  const p = store.allProxies().find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proxy não encontrado' });
  const r = await runner.pingProxy(p.url);
  store.updateProxy(p.id, {
    status: r.ok ? 'online' : 'offline',
    ms: r.ms,
    ip: r.ip || p.ip || null,
    error: r.error || null,
    lastCheck: Date.now(),
  });
  res.json(store.allProxies().find((x) => x.id === p.id));
});

module.exports = router;
