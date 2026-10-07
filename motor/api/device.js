// O aparelho: ligar à conta do usuário (o painel entrega o login), ver e renomear.
const express = require('express');
const cloud = require('../cloud');
const boot = require('../boot');

const router = express.Router();

router.get('/_device', (req, res) => {
  const u = cloud.user();
  const d = cloud.device();
  res.json({
    linked: !!u,
    ready: boot.started(),
    mine: !!u && u.id === req.userId, // o aparelho é de quem está no painel
    email: u && u.id === req.userId ? u.email : null,
    device: d && u && u.id === req.userId ? { id: d.id, name: d.name } : null,
  });
});

// Login do usuário que acabou de entrar no painel deste aparelho (tokens do Supabase Auth)
router.post('/_device/link', async (req, res) => {
  const { access_token, refresh_token } = req.body || {};
  if (typeof access_token !== 'string' || typeof refresh_token !== 'string') return res.status(400).json({ error: 'Login inválido' });
  try {
    await boot.link({ access_token, refresh_token });
    if (cloud.user().id !== req.userId) return res.status(403).json({ error: 'Login de outro usuário', otherUser: true });
    res.json({ ok: true, device: cloud.device() });
  } catch (e) {
    res.status(e.code === 'OTHER_USER' ? 409 : 500).json({ error: e.message, otherUser: e.code === 'OTHER_USER' });
  }
});

router.put('/_device', async (req, res) => {
  if (!cloud.ready() || cloud.user().id !== req.userId) return res.status(403).json({ error: 'Aparelho de outro usuário' });
  try {
    res.json(await cloud.renameDevice(req.body && req.body.name));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
