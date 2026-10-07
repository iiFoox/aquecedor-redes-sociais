const path = require('path');
const express = require('express');
const store = require('../store');
const runner = require('../runner');
const rules = require('../rules');
const platforms = require('../platforms');
const { PHASES, READY_DAY, CHECKLIST } = require('../platforms/phases');
const { body, schemas } = require('../validate');

const router = express.Router();

const { summarize } = require('../summary');
const actions = require('../actions');
const cloud = require('../cloud');

// Aparelhos do usuário (cache de 20 s): para mostrar onde cada conta roda
let devCache = { at: 0, list: [] };
async function devices() {
  if (Date.now() - devCache.at < 20000) return devCache.list;
  devCache = { at: Date.now(), list: cloud.ready() ? await cloud.listDevices().catch(() => devCache.list) : [] };
  return devCache.list;
}

// Carrega a conta do :id ou responde 404 (conta de outro usuário também é 404: nem confirma que existe)
async function account(req, res, next) {
  // Conta que este aparelho ainda não conhece (criada agora em outro aparelho): relê do banco uma vez
  if (!store.get(req.params.id)) await store.reloadAccounts().catch(() => {});
  req.account = store.ownsAccount(req.userId, req.params.id) ? store.get(req.params.id) : null;
  if (!req.account) return res.status(404).json({ error: 'Conta não encontrada' });
  next();
}

router.get('/meta', (_, res) => {
  res.json({
    phases: PHASES,
    readyDay: READY_DAY,
    checklist: CHECKLIST,
    platforms: Object.fromEntries(Object.entries(platforms).map(([k, p]) => [k, { name: p.name, actions: p.actions, plans: p.plans }])),
  });
});

router.get('/accounts', async (req, res) => {
  const d = await devices();
  res.json(store.accountsOf(req.userId).map((a) => summarize(a, false, d)));
});
router.get('/accounts/:id', account, async (req, res) => res.json(summarize(req.account, true, await devices())));
router.get('/devices', async (_, res) => {
  devCache.at = 0;
  res.json(await devices());
});

router.post('/accounts', body(schemas.newAccount), async (req, res) => {
  const { platform, username, proxy, interests } = req.body;
  if (store.all().some((a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: `@${username} já está cadastrada no ${platforms[platform].name}` });
  }
  // "auto": o proxy online da lista com menos contas
  const url = proxy === 'auto' ? rules.pickProxy(store.proxiesOf(req.userId), store.all()) : proxy;
  if (proxy === 'auto' && !url) return res.status(409).json({ error: 'Nenhum proxy online na lista para escolher' });
  store.ensureProxy(url, req.userId);
  const acc = store.add({ platform, username, proxy: url, interests, ownerId: req.userId });
  store.addLog(acc.id, `Conta adicionada (${platforms[platform].name}). Dia 1 do aquecimento`);
  // Conta nova ainda não tem login: o piloto espera em vez de abrir o navegador à toa
  store.setAttention(acc.id, 'login', 'Conta nova: clique em "Login" e entre na conta.');
  res.json(summarize(acc, false, await devices()));
});

// Ações: rodam aqui se a conta é deste aparelho; senão viram comando para o aparelho dono
const act =
  (kind, payloadOf = () => ({})) =>
  async (req, res) => {
    try {
      const r = await actions.run(kind, req.account, payloadOf(req));
      if (r.queued) return res.json({ ...r, message: `Pedido enviado para ${r.device}` });
      res.json(kind === 'remove' ? r : summarize(store.get(req.account.id) || req.account, false, await devices()));
    } catch (e) {
      res.status(e.status || 409).json({ error: e.message });
    }
  };

// Muda proxy, interesses ou janela de horário da conta
router.patch(
  '/accounts/:id',
  account,
  body(schemas.accountPatch),
  act('patch', (req) => req.body),
);

// Prints de tela tirados em captcha, bloqueio, erro ou sessão travada
router.get('/accounts/:id/screens/:file', account, (req, res) => {
  if (!/^[\w-]+\.jpg$/.test(req.params.file)) return res.status(400).json({ error: 'Arquivo inválido' });
  res.sendFile(path.join(runner.screensDir(req.account.id), req.params.file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Print não encontrado' });
  });
});

router.delete('/accounts/:id', account, act('remove'));
router.post('/accounts/:id/login', account, act('login'));
router.post('/accounts/:id/browser', account, body(schemas.openBrowser), (req, res) =>
  act(req.body.purpose === 'captcha' ? 'captcha' : 'login')(req, res),
);
router.post('/accounts/:id/login/close', account, act('close-browser'));
router.post('/accounts/:id/browser/close', account, act('close-browser'));
router.post('/accounts/:id/start', account, act('start'));
router.post('/accounts/:id/stop', account, act('stop'));
// Liberar: tira o aviso (bloqueio, captcha ou login) e fecha os alertas abertos da conta
router.post('/accounts/:id/release', account, act('release'));

// "Rodar neste aparelho" (conta sem aparelho, ou trazida de outro)
router.post('/accounts/:id/claim', account, async (req, res) => {
  try {
    const r = await actions.claim(req.account);
    if (r.queued) return res.json({ ...r, message: `Pedido enviado para ${r.device}: a conta vem para cá quando ele soltar` });
    res.json(summarize(req.account, false, await devices()));
  } catch (e) {
    res.status(e.status || 409).json({ error: e.message });
  }
});

module.exports = router;
