const path = require('path');
const express = require('express');
const store = require('../store');
const runner = require('../runner');
const rules = require('../rules');
const platforms = require('../platforms');
const { PHASES, READY_DAY, CHECKLIST, phaseFor } = require('../platforms/phases');
const { body, schemas } = require('../validate');
const backup = require('../backup');

const router = express.Router();

const alertOut = (x) => ({ t: x.t, lastT: x.lastT, count: x.count, level: x.level, kind: x.kind, msg: x.msg, resolved: !!x.resolvedAt });

const MONTH_MS = 30 * 86400000;
const GRAVE = ['captcha', 'block'];
const OK_RESULTS = ['ok', 'limit'];

const proxyOf = (a) => (a.proxy ? store.allProxies().find((p) => p.url === a.proxy) : null);

// Por que o piloto automático não está abrindo sessão nesta conta agora (ou 'iniciar')
function scheduleReason(a, p, plan, today) {
  const px = proxyOf(a);
  return rules.decide(a, {
    now: new Date(),
    config: store.getConfig(),
    runningCount: 0,
    running: !!runner.getSession(a.id),
    browserOpen: runner.isBrowserOpen(a.id),
    backupHold: backup.hold(),
    proxyDown: !!px && px.status === 'offline',
    plan,
    today,
    activities: p.activities,
    slots: () => store.slotsOf(a, p.planForDay),
    lastStartAny: store.lastStartAny(Object.values(runner.activeSessions()).map((x) => x.startedAt)),
  });
}

function summarize(a, full = false) {
  const p = platforms[a.platform];
  const day = store.dayOf(a);
  const s = runner.getSession(a.id);
  const plan = store.planOf(a, p.planForDay);
  const today = a.daily[store.localDate()] || {};
  const out = {
    id: a.id,
    platform: a.platform,
    username: a.username,
    interests: a.interests,
    proxy: !!a.proxy,
    proxyHost: a.proxy ? rules.proxyHost(a.proxy) : null,
    proxyStatus: proxyOf(a)?.status || (a.proxy ? 'unknown' : null),
    window: a.window || null,
    schedule: scheduleReason(a, p, plan, today),
    startedAt: a.startedAt,
    day,
    phase: phaseFor(day),
    plan,
    today,
    completion: rules.completion(plan, today),
    dayStatus: rules.dayStatus(p.activities, plan, today, a),
    attention: a.attention,
    warmProgress: Math.min(100, Math.round(((day - 1) / (READY_DAY - 1)) * 100)),
    health: rules.computeHealth(a),
    sessions: a.history.length,
    nextAfter: a.nextAfter || null,
    // Rotina de hoje: horários planejados e quanto da meta cada sessão cobre
    slots: (a.daily[store.localDate()] || {}).slots || [],
    checklist: a.checklist || {},
    // Últimos 60 dias (meta batida por dia), sessões de hoje (agenda) e números de 30 dias (análises)
    days: rules.dayHistory(a, 60),
    todaySessions: rules.sessionsToday(a.history),
    month: (() => {
      const since = Date.now() - MONTH_MS;
      const ran = a.history.filter((h) => Date.parse(h.date) >= since);
      return {
        sessions: ran.length,
        ok: ran.filter((h) => OK_RESULTS.includes(h.result)).length,
        grave: a.alerts.filter((x) => x.t >= since && GRAVE.includes(x.kind)).length,
      };
    })(),
    lastScreen: runner.listScreens(a.id)[0] || null,
    alerts: a.alerts.slice(-5).reverse().map(alertOut),
    loginOpen: runner.isBrowserOpen(a.id),
    browserPurpose: runner.browserPurpose(a.id),
    live: s
      ? { status: s.status, statusUntil: s.statusUntil, statusAt: s.statusAt, stats: s.stats, startedAt: s.startedAt, endsAt: s.endsAt }
      : null,
  };
  if (full) {
    out.events = a.events.slice(-150).reverse();
    out.history = a.history.slice(-30).reverse();
    out.alerts = a.alerts.slice(-20).reverse().map(alertOut);
    out.screens = runner.listScreens(a.id).slice(0, 12);
    out.persona = a.persona || null;
    out.proxyUrl = a.proxy || ''; // só no detalhe, para o seletor de proxy (o painel é local)
  }
  return out;
}

// Carrega a conta do :id ou responde 404
function account(req, res, next) {
  req.account = store.get(req.params.id);
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

router.get('/accounts', (_, res) => res.json(store.all().map((a) => summarize(a))));
router.get('/accounts/:id', account, (req, res) => res.json(summarize(req.account, true)));

router.post('/accounts', body(schemas.newAccount), (req, res) => {
  const { platform, username, proxy, interests } = req.body;
  if (store.all().some((a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: `@${username} já está cadastrada no ${platforms[platform].name}` });
  }
  // "auto": o proxy online da lista com menos contas
  const url = proxy === 'auto' ? rules.pickProxy(store.allProxies(), store.all()) : proxy;
  if (proxy === 'auto' && !url) return res.status(409).json({ error: 'Nenhum proxy online na lista para escolher' });
  store.ensureProxy(url);
  const acc = store.add({ platform, username, proxy: url, interests });
  store.addLog(acc.id, `Conta adicionada (${platforms[platform].name}). Dia 1 do aquecimento`);
  // Conta nova ainda não tem login: o piloto espera em vez de abrir o navegador à toa
  store.setAttention(acc.id, 'login', 'Conta nova: clique em "Login" e entre na conta.');
  res.json(summarize(acc));
});

// Muda proxy, interesses ou janela de horário da conta
router.patch('/accounts/:id', account, body(schemas.accountPatch), (req, res) => {
  const patch = { ...req.body };
  if (patch.checklist) {
    const before = req.account.checklist || {};
    patch.checklist = { ...before, ...patch.checklist };
    const complete = CHECKLIST.every((c) => patch.checklist[c.key]);
    if (complete && !CHECKLIST.every((c) => before[c.key]))
      store.addLog(req.account.id, 'Checklist "conta pronta" completo: pode começar a postar');
  }
  if ('proxy' in patch) {
    if (runner.getSession(req.account.id) || runner.isBrowserOpen(req.account.id)) {
      return res.status(409).json({ error: 'Feche a sessão ou o navegador desta conta antes de trocar o proxy' });
    }
    if (patch.proxy === 'auto') {
      patch.proxy = rules.pickProxy(
        store.allProxies(),
        store.all().filter((x) => x.id !== req.account.id),
      );
      if (!patch.proxy) return res.status(409).json({ error: 'Nenhum proxy online na lista para escolher' });
    }
    store.ensureProxy(patch.proxy);
    if (!patch.proxy) patch.proxy = null;
  }
  store.updateAccount(req.account.id, patch);
  const what = [
    'window' in patch && (patch.window ? `horário ${patch.window.start}–${patch.window.end}` : 'horário geral'),
    'proxy' in patch && (patch.proxy ? `proxy ${rules.proxyHost(patch.proxy)}` : 'sem proxy'),
    'interests' in patch && 'interesses',
  ].filter(Boolean);
  if (what.length) store.addLog(req.account.id, `Conta atualizada: ${what.join(', ')}`);
  res.json(summarize(req.account));
});

// Prints de tela tirados em captcha, bloqueio, erro ou sessão travada
router.get('/accounts/:id/screens/:file', account, (req, res) => {
  if (!/^[\w-]+\.jpg$/.test(req.params.file)) return res.status(400).json({ error: 'Arquivo inválido' });
  res.sendFile(path.join(runner.screensDir(req.account.id), req.params.file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Print não encontrado' });
  });
});

router.delete('/accounts/:id', account, async (req, res) => {
  runner.stopSession(req.account.id);
  await runner.closeBrowser(req.account.id);
  store.remove(req.account.id);
  res.json({ ok: true });
});

// Navegador para você: login (fecha sozinho ao detectar o login) ou captcha (você fecha quando terminar)
async function openBrowser(req, res, purpose) {
  try {
    await runner.openBrowser(req.account, purpose);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
}
router.post('/accounts/:id/login', account, (req, res) => openBrowser(req, res, 'login'));
router.post('/accounts/:id/browser', account, body(schemas.openBrowser), (req, res) => openBrowser(req, res, req.body.purpose));
const closeBrowser = async (req, res) => {
  await runner.closeBrowser(req.account.id);
  res.json({ ok: true });
};
router.post('/accounts/:id/login/close', account, closeBrowser);
router.post('/accounts/:id/browser/close', account, closeBrowser);

router.post('/accounts/:id/start', account, async (req, res) => {
  try {
    await runner.startSession(req.account, { manual: true }); // clicou em Iniciar: vai até 100% do dia
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

router.post('/accounts/:id/stop', account, (req, res) => {
  runner.stopSession(req.account.id);
  res.json({ ok: true });
});

// Liberar: tira o aviso (bloqueio, captcha ou login) e fecha os alertas abertos da conta
router.post('/accounts/:id/release', account, (req, res) => {
  store.clearAttention(req.account.id, 'Conta liberada por você');
  runner.notify({ type: 'attention', id: req.account.id, attention: null });
  res.json(summarize(req.account));
});

module.exports = router;
