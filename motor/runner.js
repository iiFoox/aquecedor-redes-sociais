const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const store = require('./store');
const rules = require('./rules');
const platforms = require('./platforms');
const { phaseFor } = require('./platforms/phases');
const { createBot, AbortError } = require('./bot');
const { createCtl } = require('./ctl');
const human = require('./human');
const { checkProxy } = require('./proxycheck');

const hub = new EventEmitter();
hub.setMaxListeners(200);

const sessions = {}; // id -> estado da sessão em andamento
const manual = {}; // id -> { ctx, purpose } navegador aberto para você (login ou captcha)
const lastFrames = {}; // id -> último quadro (base64 jpeg)
let lock = null; // motivo do bloqueio (ex.: backup dos perfis em andamento)

const emit = (ev) => hub.emit('event', { t: Date.now(), ...ev });
const profileDir = (id) => path.join(__dirname, '..', 'data', 'profiles', id);
const screensDir = (id) => path.join(__dirname, '..', 'data', 'screens', id);
const KEEP_SCREENS = 30; // prints guardados por conta

// Vigia: sessão sem nenhum sinal por 15 min, ou 5 min além do teto de segurança, está travada
const WATCH_SILENT_MS = 15 * 60000;
const WATCH_OVER_MS = 5 * 60000;

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

const BROWSER_UI_PX = 133; // barra de tarefas do Windows (48) + abas e endereço do Edge (~85)

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

  // Microsoft Edge instalado no Windows (não o Chromium do Playwright, que quase ninguém usa para ver TikTok).
  // Sem user-agent inventado: o Edge se apresenta como ele mesmo, coerente em tudo que o site cruza.
  // Tela da conta = monitor; a área da página desconta a barra de tarefas e a barra do navegador.
  const scr = account.viewport || { w: 1366, h: 768 };
  const opts = {
    channel: 'msedge',
    headless: visible ? false : !!conf.headless,
    screen: { width: scr.w, height: scr.h },
    viewport: { width: scr.w, height: scr.h - BROWSER_UI_PX },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args,
  };
  if (account.proxy) opts.proxy = proxyOpt(account.proxy);
  try {
    return await chromium.launchPersistentContext(profileDir(account.id), opts);
  } catch (e) {
    // Sem cair para outro navegador: trocar de navegador muda o "aparelho" da conta
    if (/msedge|Edge|executable|distribution/i.test(e.message))
      throw new Error(`Não consegui abrir o Microsoft Edge (${e.message.split('\n')[0]}). O robô usa o Edge instalado no Windows`);
    throw e;
  }
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
  if (lock) throw new Error(lock);
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

// manual: você clicou em Iniciar. Aí a sessão vai até 100% do dia; as sessões em partes (rotina) são do piloto.
async function startSession(account, { manual = false } = {}) {
  const id = account.id;
  if (lock) throw new Error(lock);
  if (sessions[id]) throw new Error('Sessão já em execução');
  if (account.attention) throw new Error(`Resolva o aviso da conta antes: ${account.attention.msg}`);
  const px = account.proxy && store.allProxies().find((p) => p.url === account.proxy);
  if (px && px.status === 'offline') throw new Error('O proxy desta conta falhou no último teste. Teste de novo em Proxies.');
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
  const capMin = rules.sessionCap(plan);

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
    lastBeat: Date.now(), // último sinal de vida (status, ação ou log), para o vigia
    ctx: null,
    page: null,
    killed: null,
  });

  // Parte do dia que esta sessão cobre (rotina): sessões de tamanhos diferentes; a última fecha 100%
  const slots = store.slotsOf(account, platform.planForDay);
  const slot = slots[store.todayOf(id).sessions || 0];
  const target = manual || !slot ? 1 : slot.target;
  const ctl = createCtl({
    state: s,
    plan,
    target,
    done: () => store.todayOf(id),
    hooks: {
      status: (text, until) => emit({ type: 'status', id, text, until }),
      action(type, detail) {
        store.recordAction(id, type, detail);
        emit({ type: 'action', id, action: type, detail, stats: s.stats });
      },
      log(msg, level) {
        store.addLog(id, msg, level);
        emit({ type: 'log', id, msg, level });
      },
      alert(level, msg, kind) {
        store.addAlert(id, level, msg, kind);
        emit({ type: 'alert', id, level, msg });
      },
    },
  });
  const { goalKeys, left } = ctl;

  emit({ type: 'session', id, running: true });
  const pend = goalKeys
    .filter((k) => left(k) > 0)
    .map((k) => `${k} ${left(k)}`)
    .join(', ');
  ctl.log(
    `Sessão iniciada: Dia ${day}, Fase ${phase.n} (${phase.name}). Faltam: ${pend}. ${target < 1 ? `Sessão da rotina: roda até ${Math.round(target * 100)}% do dia` : 'Roda até bater 100% das metas do dia'} (teto de segurança ${capMin} min)`,
  );
  s.done = run(account, platform, s, ctl);
}

async function run(account, platform, s, ctl) {
  let ctx;
  let page;
  let result = 'ok';
  let error = null;
  let screenshot = null;
  try {
    ctx = s.ctx = await launch(account);
    page = s.page = ctx.pages()[0] || (await ctx.newPage());

    // Minimiza a janela para rodar em segundo plano
    try {
      const cdp = await ctx.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    } catch {
      /* modo invisível não tem janela */
    }

    await startScreencast(page, account.id);
    // Personalidade da conta + humor do dia (pequena variação de um dia para o outro)
    const bot = createBot(page, ctl, { persona: account.persona, mood: human.dayMood(account.persona, rules.localDate()) });
    bot.guard = () => guard(page, platform, account);
    const likeLeft = ctl.left('like');
    const reason = await platform.run({ page, bot, ctl, plan: s.plan, account });
    const noLike = rules.noLikeWarning(likeLeft, s.stats);
    if (noLike) ctl.alert('warn', noLike, 'error');
    if (reason === 'goals' && rules.completion(s.plan, store.todayOf(account.id)) < 1)
      ctl.log(`Parte desta sessão feita (${Math.round(ctl.target * 100)}% do dia). O resto fica para a próxima sessão ✔`);
    else if (reason === 'goals') ctl.log('Todas as metas do dia foram batidas ✔');
    else if (reason === 'limit') {
      result = 'limit';
      ctl.log('O que falta passaria de 120% do plano do dia. Encerrando sem forçar; o resto fica para amanhã', 'warn');
    } else if (reason === 'stall') ctl.log('10 min sem progresso nas metas restantes. Encerrando para não forçar a conta', 'warn');
    else ctl.log('Teto de segurança da sessão atingido. O restante fica para a próxima sessão', 'warn');
  } catch (e) {
    if (s.killed) {
      result = 'watchdog';
      error = s.killed;
      screenshot = s.screenshot || null;
    } else if (e.code === 'STOPPED') {
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
    // Print da tela para você ver o que aconteceu (captcha, bloqueio e erro)
    if (!screenshot && page && ['captcha', 'block', 'error'].includes(result)) screenshot = await snap(page, account.id, result);
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
      screenshot,
      // Resumo dos tempos desta sessão (pausas e tempo por vídeo) para o card "Naturalidade"
      timing: Object.fromEntries(Object.entries(s.samples || {}).map(([k, v]) => [k, human.timingSummary(v)])),
    });
    delete sessions[account.id];
    emit({ type: 'session', id: account.id, running: false, result });
  }
}

// Print da tela em data/screens/<conta>/. Guarda os 30 mais recentes. Nunca derruba a sessão.
async function snap(page, id, tag) {
  try {
    const dir = screensDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${stamp}_${tag}.jpg`;
    await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 70, timeout: 5000 });
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    old.slice(0, Math.max(0, old.length - KEEP_SCREENS)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    return file;
  } catch {
    return null;
  }
}

function listScreens(id) {
  try {
    return fs
      .readdirSync(screensDir(id))
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Vigia: fecha o navegador de uma sessão travada (página que parou de responder).
// Fechar o navegador faz a sessão terminar e gravar o histórico normalmente, com resultado "watchdog".
async function watchdog(now = Date.now()) {
  for (const [id, s] of Object.entries(sessions)) {
    if (s.killed) continue;
    const silent = now - s.lastBeat > WATCH_SILENT_MS;
    const over = now - s.endsAt > WATCH_OVER_MS;
    if (!silent && !over) continue;
    s.killed = silent ? 'Sessão travada: 15 min sem nenhum sinal' : 'Sessão passou 5 min do teto de segurança';
    s.stop = true;
    console.warn(`[vigia] ${s.killed} (${id}). Fechando o navegador`);
    store.addLog(id, `${s.killed}. O vigia fechou o navegador`, 'warn');
    store.addAlert(id, 'warn', `${s.killed}. O vigia fechou o navegador`, 'error');
    if (s.page) s.screenshot = await snap(s.page, id, 'travou');
    if (s.ctx) await s.ctx.close().catch(() => {});
  }
}
let watchTimer = null;
function startWatchdog() {
  if (!watchTimer) watchTimer = setInterval(() => watchdog().catch(() => {}), 60000);
}
function stopWatchdog() {
  clearInterval(watchTimer);
  watchTimer = null;
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

// Trava novas sessões e janelas (ex.: durante o backup). null destrava.
function setLock(reason) {
  lock = reason;
}
const busy = () => Object.keys(sessions).length + Object.keys(manual).length > 0;

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
  pingProxy: checkProxy,
  listScreens,
  screensDir,
  watchdog,
  startWatchdog,
  stopWatchdog,
  setLock,
  busy,
};
