// O aparelho: ligar à conta do usuário (o painel entrega o login), ver e renomear.
const express = require('express');
const cloud = require('../cloud');
const boot = require('../boot');
const store = require('../store');
const runner = require('../runner');
const power = require('../power');
const platforms = require('../platforms');

const router = express.Router();

router.get('/_device', (req, res) => {
  const u = cloud.user();
  const d = cloud.device();
  res.json({
    linked: !!u,
    ready: boot.started(),
    mine: !!u && u.id === req.userId, // o aparelho é de quem está no painel
    email: u && u.id === req.userId ? u.email : null,
    device: d && u && u.id === req.userId ? { id: d.id, name: d.name, named: !!d.named } : null,
    vault: u && u.id === req.userId ? boot.vaultStatus() : null, // chave dos logins: ok | trancada | off
    needsLogin: cloud.needsLogin(), // o login do aparelho caiu: entrar de novo no painel
  });
});

// Login do usuário que acabou de entrar no painel deste aparelho (tokens do Supabase Auth)
router.post('/_device/link', async (req, res) => {
  const { access_token, refresh_token, password } = req.body || {};
  if (typeof access_token !== 'string' || typeof refresh_token !== 'string') return res.status(400).json({ error: 'Login inválido' });
  try {
    await boot.link({ access_token, refresh_token }, typeof password === 'string' ? password : null);
    if (cloud.user().id !== req.userId) return res.status(403).json({ error: 'Login de outro usuário', otherUser: true });
    res.json({ ok: true, device: cloud.device() });
  } catch (e) {
    res.status(e.code === 'OTHER_USER' ? 409 : 500).json({ error: e.message, otherUser: e.code === 'OTHER_USER' });
  }
});

// Chave dos logins: trancar de novo com a senha nova, abrir com a senha antiga ou começar uma nova.
// Só o painel chama, e só depois de conferir a senha atual no Supabase Auth.
router.post('/_device/vault', async (req, res) => {
  if (!cloud.ready() || cloud.user().id !== req.userId) return res.status(403).json({ error: 'Aparelho de outro usuário' });
  const { mode, password, oldPassword } = req.body || {};
  if (!['unlock', 'rewrap', 'unlock-old', 'reset'].includes(mode) || typeof password !== 'string' || !password)
    return res.status(400).json({ error: 'Pedido inválido' });
  if (mode === 'unlock-old' && typeof oldPassword !== 'string') return res.status(400).json({ error: 'Informe a senha antiga' });
  try {
    const r = await boot.vaultAction({ mode, password, oldPassword });
    if (r.wrong) return res.status(400).json({ error: 'A senha antiga não abre a chave', vault: r.status });
    if (mode === 'unlock' && r.status !== 'ok')
      return res
        .status(400)
        .json({ error: 'A senha atual não abre a chave. Tente a senha antiga ou comece uma chave nova.', vault: r.status });
    res.json({ ok: true, vault: r.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Para o aplicativo (desktop/main.js), com a senha interna ----------

// Ícone da bandeja: situação geral (cor) e o que precisa de você (notificações)
router.get('/_device/tray', (req, res) => {
  const ready = boot.started();
  const mine = ready ? store.mine() : [];
  const sessions = runner.activeSessions();
  res.json({
    linked: !!cloud.user(),
    needsLogin: cloud.needsLogin(),
    ready,
    email: cloud.user() ? cloud.user().email : null,
    device: cloud.device() ? cloud.device().name : null,
    accounts: mine.length,
    running: Object.keys(sessions).length,
    browsers: runner.openBrowsers(), // janelas de login/captcha abertas
    pilot: ready ? !!store.getConfig().active : false,
    power: power.hold(),
    vault: boot.vaultStatus(),
    attention: mine
      .filter((a) => a.attention)
      .map((a) => ({
        id: a.id,
        username: a.username,
        platform: platforms[a.platform] ? platforms[a.platform].name : a.platform,
        kind: a.attention.kind,
        msg: a.attention.msg,
      })),
  });
});

// Energia: { battery: { onBattery, level } } a cada mudança; { event: 'suspend' } antes de o Windows dormir
router.post('/_device/power', async (req, res) => {
  const b = req.body || {};
  if (b.event === 'suspend') {
    // Para as sessões direito (gravam o histórico) e fecha as janelas abertas
    const open = Object.keys(runner.activeSessions());
    for (const id of open) {
      runner.stopSession(id);
      store.addLog(id, 'O aparelho vai dormir: sessão encerrada', 'warn');
    }
    await Promise.race([runner.closeAll(), new Promise((r) => setTimeout(r, 15000))]);
    await store.flush().catch(() => {});
    return res.json({ ok: true, stopped: open.length });
  }
  if (b.battery && typeof b.battery === 'object') {
    const r = power.setBattery({ onBattery: !!b.battery.onBattery, level: Number.isFinite(b.battery.level) ? b.battery.level : null });
    if (r.changed)
      console.log(r.hold ? `🔋 Bateria abaixo de ${power.LOW}%: sem sessão nova até ligar na tomada` : '🔌 Energia ok: piloto liberado');
    return res.json({ ok: true, hold: r.hold, changed: r.changed });
  }
  res.status(400).json({ error: 'Pedido inválido' });
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
