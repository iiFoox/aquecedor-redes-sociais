// Piloto automático: a cada minuto, inicia sessões das contas que podem aquecer agora.
// A decisão de cada conta está em rules.decide (testada em tests/rules.test.js).
const store = require('./store');
const runner = require('./runner');
const rules = require('./rules');
const platforms = require('./platforms');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = () => Object.keys(runner.activeSessions()).length;

let timer = null;
let busy = false;

async function tick(now = new Date()) {
  const config = store.getConfig();
  // Condições gerais primeiro, para não sortear planos à toa com o piloto desligado
  if (!config.active || !rules.inWindow(rules.localMinutes(now), config.start, config.end)) return;
  if (config.pausedUntil && now.getTime() < config.pausedUntil) return;

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
      plan: store.planOf(acc, p.planForDay),
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
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
