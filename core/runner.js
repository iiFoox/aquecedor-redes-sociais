const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const EventEmitter = require('events');
const store = require('./store');
const platforms = require('../platforms');
const { phaseFor } = require('../platforms/phases');
const { completion } = require('./metrics');
const { createBot, AbortError } = require('./bot');

const hub = new EventEmitter();
hub.setMaxListeners(200);

const sessions = {}; // id -> estado da sessão em andamento
const loginCtx = {}; // id -> contexto do navegador de login
const lastFrames = {}; // id -> último quadro (base64 jpeg)

// O cursor visual foi removido por segurança (Poluição de DOM/Fingerprinting)
const SHOW_CURSOR = false;

const emit = (ev) => hub.emit('event', { t: Date.now(), ...ev });
const profileDir = (id) => path.join(__dirname, '..', 'data', 'profiles', id);

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

async function launch(account) {
  const conf = store.getConfig();
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ];
  if (conf.muteAudio !== false) args.push('--mute-audio');

  const opts = {
    headless: !!conf.headless,
    viewport: account.viewport ? { width: account.viewport.w, height: account.viewport.h } : { width: 1280, height: 800 },
    userAgent: account.userAgent || undefined,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args,
  };
  if (account.proxy) opts.proxy = proxyOpt(account.proxy);
  const ctx = await chromium.launchPersistentContext(profileDir(account.id), opts);
  return ctx;
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

async function guard(page, platform, ctl, bot) {
  const p = await platform.detectProblem(page).catch(() => null);
  if (!p) return;
  if (p.kind === 'captcha') {
    ctl.alert('warn', `${p.msg}. Resolva manualmente na janela do navegador (aguardando até 3 min)`);
    ctl.status('🚨 RESOLVA O CAPTCHA NA JANELA DO NAVEGADOR!', 180000);
    
    // Tenta desminimizar a janela e trazer pra frente para o usuário resolver
    try {
      const cdp = await page.context().newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    } catch (e) {}

    const end = Date.now() + 180000;
    while (Date.now() < end) {
      await bot.wait(3000, 3000, '🚨 AGUARDANDO SOLUÇÃO DO CAPTCHA...');
      if (!(await platform.detectProblem(page).catch(() => null))) {
        ctl.log('Verificação resolvida, minimizando e continuando ✔');
        // Minimiza de novo após resolver
        try {
          const cdp = await page.context().newCDPSession(page);
          const { windowId } = await cdp.send('Browser.getWindowForTarget');
          await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        } catch (e) {}
        return;
      }
    }
    ctl.alert('danger', 'Captcha não resolvido a tempo. Sessão encerrada');
    throw new AbortError('Captcha não resolvido', 'CAPTCHA');
  }
  ctl.alert('danger', `${p.msg}. Sessão encerrada por segurança`);
  throw new AbortError(p.msg, p.kind.toUpperCase());
}

async function openLogin(account) {
  if (sessions[account.id]) throw new Error('Há uma sessão em execução nesta conta');
  if (loginCtx[account.id]) return;
  const ctx = await launch(account);
  loginCtx[account.id] = ctx;
  ctx.on('close', () => {
    delete loginCtx[account.id];
    store.addLog(account.id, 'Janela de login fechada, sessão salva no perfil');
    emit({ type: 'login', id: account.id, open: false });
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await startScreencast(page, account.id).catch(() => {});
  page.goto(platforms[account.platform].loginUrl).catch(() => {});
  store.addLog(account.id, 'Janela de login aberta. Faça login manualmente');
  emit({ type: 'login', id: account.id, open: true });
  
  const check = setInterval(async () => {
    try {
      const cookies = await ctx.cookies();
      if (cookies.some(c => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
        clearInterval(check);
        store.addLog(account.id, 'Login detectado! Fechando a janela automaticamente.');
        await closeLogin(account.id);
      }
    } catch(e) {}
  }, 3000);
  ctx.on('close', () => clearInterval(check));
}

async function closeLogin(id) {
  if (loginCtx[id]) await loginCtx[id].close().catch(() => {});
}

async function startSession(account) {
  const id = account.id;
  if (sessions[id]) throw new Error('Sessão já em execução');
  await closeLogin(id);

  const platform = platforms[account.platform];
  const day = store.dayOf(account);
  const plan = store.planOf(account, platform.planForDay);
  const phase = phaseFor(day);
  
  if (completion(plan, store.todayOf(id)) >= 1) {
    throw new Error('As metas desta conta já foram 100% concluídas por hoje! Volte amanhã.');
  }

  // SEM timer fixo: a sessão roda até bater TODAS as metas.
  // Só existe um teto de segurança (2.5x o tempo estimado, entre 30 e 90 min)
  // e um detector de travamento (10 min sem nenhum progresso de meta).
  const capMin = Math.min(90, Math.max(30, Math.round(plan.minutes * 2.5)));
  const STALL_MS = 10 * 60000;
  const goalKeys = Object.keys(plan).filter((k) => k !== 'minutes' && plan[k] > 0);

  const s = (sessions[id] = {
    stop: false, day, phase: phase.n, plan, stats: {},
    status: 'Iniciando navegador...', statusUntil: null, statusAt: Date.now(),
    startedAt: Date.now(), endsAt: Date.now() + capMin * 60000, lastProgress: Date.now(),
  });

  const left = (k) => (plan[k] || 0) - (store.todayOf(id)[k] || 0);
  const ctl = {
    stats: s.stats,
    plan,
    shouldStop: () => s.stop,
    timeLeft: () => s.endsAt - Date.now(),
    elapsed: () => Date.now() - s.startedAt,
    left,
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
    alert(level, msg) {
      store.addAlert(id, level, msg);
      emit({ type: 'alert', id, level, msg });
    },
  };

  emit({ type: 'session', id, running: true });
  const pend = goalKeys.filter((k) => left(k) > 0).map((k) => `${k} ${left(k)}`).join(', ');
  ctl.log(`Sessão iniciada: Dia ${day}, Fase ${phase.n} (${phase.name}). Faltam: ${pend}. Roda até bater as metas (teto de segurança ${capMin} min)`);
  s.done = run(account, platform, s, ctl);
}

async function run(account, platform, s, ctl) {
  let ctx;
  let result = 'ok';
  let error = null;
  try {
    ctx = await launch(account);
    const page = ctx.pages()[0] || (await ctx.newPage());
    
    // Minimizar a janela para rodar em segundo plano
    try {
      const cdp = await ctx.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    } catch (e) {}
    
    await startScreencast(page, account.id);
    const bot = createBot(page, ctl);
    bot.guard = () => guard(page, platform, ctl, bot);
    const reason = await platform.run({ page, bot, ctl, plan: s.plan, account });
    if (reason === 'goals') ctl.log('Todas as metas do dia foram batidas ✔');
    else if (reason === 'stall') ctl.log('10 min sem progresso nas metas restantes. Encerrando para não forçar a conta', 'warn');
    else ctl.log('Teto de segurança da sessão atingido. O restante fica para a próxima sessão', 'warn');
  } catch (e) {
    if (e.code === 'STOPPED') {
      result = 'stopped';
      ctl.log('Sessão interrompida por você', 'warn');
    } else if (e.code === 'NOT_LOGGED') {
      result = 'not_logged';
      ctl.alert('warn', e.message);
    } else if (e.code) {
      result = e.code.toLowerCase();
      error = e.message;
    } else {
      result = 'error';
      error = e.message.split('\n')[0];
      ctl.alert('warn', `Erro inesperado: ${error}`);
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    const minutes = +((Date.now() - s.startedAt) / 60000).toFixed(1);
    store.addSession(account.id, {
      date: new Date().toISOString(), day: s.day, phase: s.phase, minutes,
      stats: s.stats, plan: s.plan,
      completion: completion(s.plan, store.todayOf(account.id)),
      result, error,
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
  await Promise.all(Object.values(loginCtx).map((c) => c.close().catch(() => {})));
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
    if (browser) await browser.close().catch(()=>{});
    return { ok: false, ms: 0, error: e.message };
  }
}

module.exports = {
  hub,
  openLogin,
  closeLogin,
  startSession,
  stopSession,
  closeAll,
  getSession: (id) => sessions[id],
  isLoginOpen: (id) => !!loginCtx[id],
  lastFrame: (id) => lastFrames[id],
  activeSessions: () => sessions,
  pingProxy,
};
