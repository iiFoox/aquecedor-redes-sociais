// Liga o aparelho: login do usuário (cloud) → registra o aparelho → carrega as contas → liga agendador, vigia,
// backup, comandos de outros aparelhos e publicação do status. Roda no início (login salvo) ou quando você entra
// no painel pela primeira vez neste aparelho.
const cloud = require('./cloud');
const store = require('./store');
const runner = require('./runner');
const scheduler = require('./scheduler');
const backup = require('./backup');
const publisher = require('./publisher');
const actions = require('./actions');

let started = false;
let starting = null;

async function startDevice() {
  if (started) return;
  if (starting) return starting;
  starting = (async () => {
    const dev = await cloud.ensureDevice();
    console.log(`👤 ${cloud.user().email} · 💻 ${dev.name}`);
    await store.init({ client: cloud.client(), user: cloud.user(), device: dev });
    // Mudanças vindas de outros aparelhos vão para o painel; conta levada embora fecha o que estiver aberto aqui
    store.changes.on('event', (ev) => runner.notify(ev));
    store.changes.on('lost', (acc) => {
      runner.stopSession(acc.id);
      runner.closeBrowser(acc.id).catch(() => {});
      runner.notify({ type: 'remote', id: acc.id });
    });
    store.changes.on('gained', (acc) => {
      store.addLog(acc.id, `Conta passou a rodar em ${dev.name}`);
      runner.notify({ type: 'remote', id: acc.id });
    });
    cloud.startHeartbeat();
    await cloud.listenCommands(actions.execute);
    publisher.start();
    scheduler.start();
    runner.startWatchdog();
    backup.start();
    started = true;
  })();
  try {
    await starting;
  } finally {
    starting = null;
  }
}

// Login entregue pelo painel deste aparelho (depois que você entra)
async function link(session) {
  await cloud.link(session);
  await startDevice();
}

function stopAll() {
  publisher.stop();
  scheduler.stop();
  backup.stop();
  runner.stopWatchdog();
}

module.exports = { startDevice, link, stopAll, started: () => started };
