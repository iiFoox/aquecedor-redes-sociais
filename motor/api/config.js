const express = require('express');
const store = require('../store');
const runner = require('../runner');
const backup = require('../backup');
const { body, schemas } = require('../validate');

const router = express.Router();

router.get('/config', (_, res) => res.json(store.getConfig()));

// ---------- Metas personalizadas (modelos) ----------
const platforms = require('../platforms');
const custom = require('../custom');

router.get('/metas', (_, res) => res.json({ templates: store.getConfig().goalTemplates || [], limits: custom.LIMITS }));
router.post('/metas', (req, res) => {
  try {
    const p = platforms[req.body && req.body.platform];
    if (!p) return res.status(400).json({ error: 'Plataforma inválida' });
    const t = custom.normalizeTemplate(req.body, p.plans, p.actions);
    res.json(store.saveTemplate(t));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.delete('/metas/:id', (req, res) => {
  if (!store.templateById(req.params.id)) return res.status(404).json({ error: 'Modelo não encontrado' });
  store.removeTemplate(req.params.id);
  res.json({ ok: true });
});
router.post('/config', body(schemas.configPatch), (req, res) => res.json(store.setConfig(req.body)));

// ---------- Backup dos logins ----------

router.get('/backup', (_, res) => res.json(backup.status()));
router.post('/backup', async (_, res) => {
  try {
    await backup.run();
    res.json(backup.status());
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// ---------- Férias ----------

// Para tudo até a data de volta. As sessões em andamento fecham com segurança.
router.post('/vacation', body(schemas.vacation), (req, res) => {
  const untilMs = Date.parse(`${req.body.until}T00:00:00-03:00`);
  if (untilMs <= Date.now()) return res.status(400).json({ error: 'A data de volta precisa ser no futuro' });
  Object.keys(runner.activeSessions()).forEach((id) => runner.stopSession(id));
  const config = store.startVacation(untilMs);
  runner.notify({ type: 'vacation', pausedUntil: untilMs });
  res.json(config);
});

// Voltou antes: as contas continuam de onde pararam
router.delete('/vacation', (_, res) => {
  store.endVacation();
  runner.notify({ type: 'vacation', pausedUntil: null });
  res.json(store.getConfig());
});

module.exports = router;
