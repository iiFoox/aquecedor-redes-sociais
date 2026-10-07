// Piloto automático: a cada minuto, inicia sessões das contas que podem aquecer agora.
// A decisão de cada conta está em rules.decide (testada em tests/rules.test.js).
// Também testa os proxies a cada 30 min (sem abrir navegador) e encerra as férias na data marcada.
const store = require('./store');
const runner = require('./runner');
const rules = require('./rules');
const backup = require('./backup');
const platforms = require('./platforms');

const PROXY_EVERY_MS = 30 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = () => Object.keys(runner.activeSessions()).length;

let timer = null;
let proxyTimer = null;
let busy = false;

// Proxy da conta falhou no último teste? (proxy fora da lista não é testado e não bloqueia)
function proxyDown(acc) {
  if (!acc.proxy) return false;
  const p = store.allProxies().find((x) => x.url === acc.proxy);
  return !!p && p.status === 'offline';
}

async function tick(now = new Date()) {
  const config = store.getConfig();
  if (config.pausedUntil && now.getTime() >= config.pausedUntil) {
    const moved = store.endVacation(now.getTime());
    console.log(`[agendador] Fim das férias. ${moved.length} conta(s) continuam de onde pararam`);
    runner.notify({ type: 'vacation', pausedUntil: null });
  }
  // Condições gerais primeiro, para não sortear planos à toa com o piloto desligado
  if (!config.active || (config.pausedUntil && now.getTime() < config.pausedUntil)) return;
  const backupHold = backup.hold(now);

  for (const acc of store.all()) {
    if (running() >= config.max) break;
    const p = platforms[acc.platform];
    if (!p) continue;
    const reason = rules.decide(acc, {
      now: new Date(),
      config,
      runningCount: running(),
      running: !!runner.getSession(acc.id),
      browserOpen: runner.isBrowserOpen(acc.id),
      backupHold,
      proxyDown: proxyDown(acc),
      plan: () => store.planOf(acc, p.planForDay),
      today: store.todayOf(acc.id),
      activities: p.activities,
    });
    if (reason !== 'iniciar') continue;
    try {
      // Atraso de 0 a 15 s para quebrar a cadência cronometrada
      await sleep(Math.floor(Math.random() * 15000));
      if (!store.getConfig().active || running() >= store.getConfig().max) break;
      console.log(`[agendador] Iniciando @${acc.username}`);
      await runner.startSession(acc);
      // Espera de 15 a 35 s antes de iniciar a próxima
      await sleep(15000 + Math.floor(Math.random() * 20000));
    } catch (e) {
      console.error(`[agendador] Erro em @${acc.username}:`, e.message);
    }
  }
}

// Testa todos os proxies da lista. Falhou? Tenta de novo em 10 s antes de marcar como fora do ar.
async function checkProxies() {
  for (const p of store.allProxies()) {
    let r = await runner.pingProxy(p.url);
    if (!r.ok) {
      await sleep(10000);
      r = await runner.pingProxy(p.url);
    }
    const before = p.status;
    store.updateProxy(p.id, {
      status: r.ok ? 'online' : 'offline',
      ms: r.ms,
      ip: r.ip || p.ip || null,
      error: r.error || null,
      lastCheck: Date.now(),
    });
    if (before === 'offline' && r.ok) {
      console.log(`[proxies] ${rules.proxyHost(p.url)} voltou`);
      for (const a of store.all().filter((x) => x.proxy === p.url))
        store.clearAttention(a.id, `O proxy ${rules.proxyHost(p.url)} voltou`, ['proxy']);
    }
    if (before !== 'offline' && !r.ok) {
      console.warn(`[proxies] ${rules.proxyHost(p.url)} caiu: ${r.error}`);
      for (const a of store.all().filter((x) => x.proxy === p.url)) {
        store.addAlert(a.id, 'warn', `O proxy ${rules.proxyHost(p.url)} não respondeu (${r.error}). A conta espera ele voltar`, 'proxy');
      }
    }
  }
  runner.notify({ type: 'proxies' });
}

// Um ciclo pode levar mais de 60 s (esperas entre contas): nunca roda dois ao mesmo tempo
function start() {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error('[agendador] Falha no ciclo:', e.message);
    } finally {
      busy = false;
    }
  }, 60000);
  const proxies = () => checkProxies().catch((e) => console.error('[proxies] Falha no teste:', e.message));
  setTimeout(proxies, 60000);
  proxyTimer = setInterval(proxies, PROXY_EVERY_MS);
}

function stop() {
  clearInterval(timer);
  clearInterval(proxyTimer);
  timer = null;
  proxyTimer = null;
}

module.exports = { start, stop, tick, checkProxies };
