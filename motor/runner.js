const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const EventEmitter = require('events');
const store = require('./store');
const rules = require('./rules');
const platforms = require('./platforms');
const { phaseFor } = require('./platforms/phases');
const { createBot, AbortError } = require('./bot');

const hub = new EventEmitter();
hub.setMaxListeners(200);

const sessions = {}; // id -> estado da sessão em andamento
const manual = {}; // id -> { ctx, purpose } navegador aberto para você (login ou captcha)
const lastFrames = {}; // id -> último quadro (base64 jpeg)

const emit = (ev) => hub.emit('event', { t: Date.now(), ...ev });
const profileDir = (id) => path.join(__dirname, '..', 'data', 'profiles', id);

// Aviso que aparece no painel quando a conta precisa de você: o motivo + o que fazer
const ATTENTION = {
  login: { reason: (p) => `${p} pediu login`, todo: 'Clique em "Login" e entre na conta.' },
  captcha: { reason: (p) => `${p} pediu um captcha`, todo: 'Clique em "Abrir navegador", resolva o captcha e feche a janela.' },
  block: { reason: (p) => `${p} bloqueou ações`, todo: 'A conta fica parada até você clicar em "Liberar".' },
};

function proxyOpt(p) {
  try {
    const u = new URL(p);
    return {
      server: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username) || undefined,
      password: decodeURIComponent(u.password) || undefined,
    };
  } catch {
    return { server: p };
  }
}

// visible: força a janela à vista (navegador manual), ignorando o modo invisível
async function launch(account, { visible = false } = {}) {
  const conf = store.getConfig();
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];
  if (conf.muteAudio !== false) args.push('--mute-audio');

  const opts = {
    headless: visible ? false : !!conf.headless,
    viewport: account.viewport ? { width: account.viewport.w, height: account.viewport.h } : { width: 1280, height: 800 },
    userAgent: account.userAgent || undefined,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args,
  };
  if (account.proxy) opts.proxy = proxyOpt(account.proxy);
  return chromium.launchPersistentContext(profileDir(account.id), opts);
}

// Transmite a tela do navegador via CDP (Chrome DevTools Protocol)
async function startScreencast(page, id) {
  const cdp = await page.context().newCDPSession(page);
  let last = 0;
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const now = Date.now();
    if (now - last < 120) return; // ~8 fps no máximo
    last = now;
    lastFrames[id] = data;
    hub.emit('frame', id, data);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });
  return cdp;
}

// A conta precisa de você: grava o aviso, cria o alerta e avisa o painel
function needsAttention(account, kind, reason) {
  const info = ATTENTION[kind];
  const msg = `${reason || info.reason(platforms[account.platform].name)}. ${info.todo}`;
  store.setAttention(account.id, kind, msg);
  store.addAlert(account.id, kind === 'login' ? 'warn' : 'danger', msg, kind);
  emit({ type: 'attention', id: account.id, attention: store.get(account.id).attention });
}

// Captcha, bloqueio ou login pedido no meio da sessão: para na hora, sem esperar
async function guard(page, platform, account) {
  const p = await platform.detectProblem(page).catch(() => null);
  if (!p) return;
  const kind = p.kind === 'logout' ? 'login' : p.kind;
  needsAttention(account, kind, p.msg);
  throw new AbortError(p.msg, kind.toUpperCase());
}

// Abre o navegador da conta para você. purpose 'login': página de login, fecha sozinho ao detectar o login.
// purpose 'captcha': abre a plataforma; quando você fecha a janela, a conta volta para a fila.
async function openBrowser(account, purpose = 'login') {
  if (sessions[account.id]) throw new Error('Há uma sessão rodando nesta conta. Pare a sessão antes.');
  if (manual[account.id]) return;
  const platform = platforms[account.platform];
  const ctx = await launch(account, { visible: true });
  manual[account.id] = { ctx, purpose };
  let check = null;
  ctx.on('close', () => {
    clearInterval(check);
    delete manual[account.id];
    if (purpose === 'captcha' && account.attention && account.attention.kind === 'captcha') {
      store.clearAttention(account.id, 'Janela fechada depois do captcha. A conta voltou para a fila', ['captcha']);
      emit({ type: 'attention', id: account.id, attention: null });
    } else {
      store.addLog(account.id, 'Janela do navegador fechada, sessão salva no perfil');
    }
    emit({ type: 'login', id: account.id, open: false, purpose });
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await startScreencast(page, account.id).catch(() => {});
  page.goto(purpose === 'login' ? platform.loginUrl : platform.homeUrl).catch(() => {});
  store.addLog(
    account.id,
    purpose === 'login' ? 'Janela de login aberta. Entre na conta normalmente' : 'Navegador aberto para você resolver o captcha',
  );
  emit({ type: 'login', id: account.id, open: true, purpose });

  if (purpose === 'login') {
    check = setInterval(async () => {
      try {
        const cookies = await ctx.cookies();
        if (cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
          clearInterval(check);
          store.clearAttention(account.id, 'Login detectado! Fechando a janela automaticamente', ['login']);
          emit({ type: 'attention', id: account.id, attention: store.get(account.id)?.attention || null });
          await closeBrowser(account.id);
        }
      } catch {
        /* janela fechando */
      }
    }, 3000);
  }
}

async function closeBrowser(id) {
  if (manual[id]) await manual[id].ctx.close().catch(() => {});
}

async function startSession(account) {
  const id = account.id;
  if (sessions[id]) throw new Error('Sessão já em execução');
  if (account.attention) throw new Error(`Resolva o aviso da conta antes: ${account.attention.msg}`);
  await closeBrowser(id);

  const platform = platforms[account.platform];
  const day = store.dayOf(account);
  const plan = store.planOf(account, platform.planForDay);
  const phase = phaseFor(day);
  const status = rules.dayStatus(platform.activities, plan, store.todayOf(id), account);
  if (status === 'done') throw new Error('As metas desta conta já foram batidas hoje. Volte amanhã.');
  if (status === 'limit') throw new Error('O que falta hoje passaria do limite de 120% do plano. Volte amanhã.');

  // Sem timer fixo: a sessão roda até bater as metas. Só existe um teto de segurança
  // (2,5x o tempo estimado, entre 30 e 90 min) e um detector de travamento (10 min sem progresso).
  const capMin = Math.min(90, Math.max(30, Math.round(plan.minutes * 2.5)));
  const STALL_MS = 10 * 60000;
  const goalKeys = Object.keys(plan).filter((k) => k !== 'minutes' && plan[k] > 0);

  const s = (sessions[id] = {
    stop: false,
    day,
    phase: phase.n,
    plan,
    stats: {},
    status: 'Iniciando navegador...',
    statusUntil: null,
    statusAt: Date.now(),
    startedAt: Date.now(),
    endsAt: Date.now() + capMin * 60000,
    lastProgress: Date.now(),
  });

  const done = () => store.todayOf(id);
  const left = (k) => (plan[k] || 0) - (done()[k] || 0);
  const ctl = {
    stats: s.stats,
    plan,
    shouldStop: () => s.stop,
    timeLeft: () => s.endsAt - Date.now(),
    elapsed: () => Date.now() - s.startedAt,
    left,
    // Meta já no teto de 120% do plano do dia
    capped: (k) => rules.isCapped(plan, done(), k),
    allowed: (act, acc) => rules.activityAllowed(act, plan, done(), acc),
    useful: (act) => rules.activityUseful(act, plan, done()),
    // Todas as metas batidas? (ignora metas marcadas como inalcançáveis nesta sessão)
    goalsDone: (skip = []) => goalKeys.every((k) => skip.includes(k) || left(k) <= 0),
    stalled: () => Date.now() - s.lastProgress > STALL_MS,
    status(text, ms) {
      s.status = text;
      s.statusAt = Date.now();
      s.statusUntil = ms ? Date.now() + ms : null;
      emit({ type: 'status', id, text, until: s.statusUntil });
    },
    action(type, detail = '') {
      if (goalKeys.includes(type) && left(type) > 0) s.lastProgress = Date.now();
      s.stats[type] = (s.stats[type] || 0) + 1;
      store.recordAction(id, type, detail);
      emit({ type: 'action', id, action: type, detail, stats: s.stats });
    },
    log(msg, level = 'info') {
      store.addLog(id, msg, level);
      emit({ type: 'log', id, msg, level });
    },
    alert(level, msg, kind) {
      store.addAlert(id, level, msg, kind);
      emit({ type: 'alert', id, level, msg });
    },
  };

  emit({ type: 'session', id, running: true });
  const pend = goalKeys
    .filter((k) => left(k) > 0)
    .map((k) => `${k} ${left(k)}`)
    .join(', ');
  ctl.log(
    `Sessão iniciada: Dia ${day}, Fase ${phase.n} (${phase.name}). Faltam: ${pend}. Roda até bater as metas (teto de segurança ${capMin} min)`,
  );
  s.done = run(account, platform, s, ctl);
}

async function run(account, platform, s, ctl) {
  let ctx;
  let result = 'ok';
  let error = null;
  try {
    ctx = await launch(account);
    const page = ctx.pages()[0] || (await ctx.newPage());

    // Minimiza a janela para rodar em segundo plano
    try {
      const cdp = await ctx.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    } catch {
      /* modo invisível não tem janela */
    }

    await startScreencast(page, account.id);
    const bot = createBot(page, ctl);
    bot.guard = () => guard(page, platform, account);
    const reason = await platform.run({ page, bot, ctl, plan: s.plan, account });
    if (reason === 'goals') ctl.log('Todas as metas do dia foram batidas ✔');
    else if (reason === 'limit') {
      result = 'limit';
      ctl.log('O que falta passaria de 120% do plano do dia. Encerrando sem forçar; o resto fica para amanhã', 'warn');
    } else if (reason === 'stall') ctl.log('10 min sem progresso nas metas restantes. Encerrando para não forçar a conta', 'warn');
    else ctl.log('Teto de segurança da sessão atingido. O restante fica para a próxima sessão', 'warn');
  } catch (e) {
    if (e.code === 'STOPPED') {
      result = 'stopped';
      ctl.log('Sessão interrompida por você', 'warn');
    } else if (e.code === 'NOT_LOGGED' || e.code === 'LOGIN') {
      result = 'not_logged';
      if (e.code === 'NOT_LOGGED') needsAttention(account, 'login', e.message.replace(/\.\s*Clique.*$/, ''));
    } else if (e.code === 'CAPTCHA') {
      result = 'captcha';
      error = e.message;
    } else if (e.code === 'BLOCK') {
      result = 'block';
      error = e.message;
    } else if (e.code) {
      result = e.code.toLowerCase();
      error = e.message;
    } else {
      result = 'error';
      error = e.message.split('\n')[0];
      ctl.alert('warn', `Erro inesperado: ${error}`, 'error');
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    const minutes = +((Date.now() - s.startedAt) / 60000).toFixed(1);
    store.addSession(account.id, {
      date: new Date().toISOString(),
      startedAt: new Date(s.startedAt).toISOString(),
      day: s.day,
      phase: s.phase,
      minutes,
      stats: s.stats,
      plan: s.plan,
      completion: rules.completion(s.plan, store.todayOf(account.id)),
      result,
      error,
    });
    delete sessions[account.id];
    emit({ type: 'session', id: account.id, running: false, result });
  }
}

function stopSession(id) {
  if (sessions[id]) {
    sessions[id].stop = true;
    sessions[id].status = 'Encerrando com segurança...';
    emit({ type: 'status', id, text: sessions[id].status });
  }
}

async function closeAll() {
  const running = Object.values(sessions);
  running.forEach((s) => (s.stop = true));
  await Promise.all(Object.values(manual).map((m) => m.ctx.close().catch(() => {})));
  // Espera cada sessão fechar o navegador e gravar o histórico (store.addSession)
  await Promise.all(running.map((s) => s.done).filter(Boolean));
}

async function pingProxy(url) {
  const start = Date.now();
  let browser;
  try {
    browser = await chromium.launch({ proxy: proxyOpt(url) });
    const page = await browser.newPage();
    const res = await page.goto('https://api.myip.com', { timeout: 15000 });
    const ms = Date.now() - start;
    await browser.close();
    return { ok: res.ok(), ms };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, ms: 0, error: e.message };
  }
}

module.exports = {
  hub,
  notify: emit,
  openBrowser,
  closeBrowser,
  startSession,
  stopSession,
  closeAll,
  getSession: (id) => sessions[id],
  isBrowserOpen: (id) => !!manual[id],
  browserPurpose: (id) => (manual[id] ? manual[id].purpose : null),
  lastFrame: (id) => lastFrames[id],
  activeSessions: () => sessions,
  pingProxy,
};
