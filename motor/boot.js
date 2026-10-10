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
const path = require('path');
const vaultLib = require('./vault');
const dpapi = require('./dpapi');
const logins = require('./logins');
const screens = require('./screens');
const uptime = require('./uptime');
const { DATA } = require('./paths');

let vault = null;
// Cofre dos logins do usuário deste aparelho (a cópia local da chave fica protegida pelo Windows)
function vaultOf() {
  if (!vault) {
    const u = cloud.user();
    vault = vaultLib.createVault({
      db: vaultLib.supabaseDb(cloud.client(), u.id),
      local: vaultLib.fileLocal(path.join(DATA, 'vault-key.bin'), dpapi),
      userId: u.id,
    });
  }
  return vault;
}
const VAULT_MSG = {
  ok: '🔐 Logins das contas: salvos no Supabase, cifrados',
  trancada: '🔒 Logins das contas: a chave está trancada (veja Ajustes → Logins na nuvem)',
  off: '🔒 Logins das contas: entre no painel para destrancar a chave',
};

let started = false;
let starting = null;

async function startDevice() {
  if (started) return;
  if (starting) return starting;
  starting = (async () => {
    const dev = await cloud.ensureDevice();
    console.log(`👤 ${cloud.user().email} · 💻 ${dev.name}`);
    await store.init({ client: cloud.client(), user: cloud.user(), device: dev });
    // Logins cifrados e prints no Supabase
    const v = vaultOf();
    if (v.status() !== 'ok') await v.resume().catch((e) => console.error(`⚠️  Chave dos logins: ${e.message}`));
    console.log(VAULT_MSG[v.status()]);
    screens.init({ client: cloud.client(), userId: cloud.user().id });
    await logins
      .init({ client: cloud.client(), vault: v, deviceId: dev.id, userId: cloud.user().id })
      .catch((e) => console.error(`⚠️  Logins salvos: ${e.message}`));
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
    // Rede de segurança do tempo real: relê as contas dos outros aparelhos a cada 2 min
    setInterval(() => {
      store.reloadAccounts().catch(() => {});
      logins.reload().catch(() => {});
      v.check()
        .then((st) => st === 'trancada' && console.warn(VAULT_MSG.trancada))
        .catch(() => {});
    }, 120000).unref();
    // Rotina: sessões nas horas em que este aparelho costuma ficar ligado
    uptime.start();
    store.setHours(() => uptime.hours());
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

// Login entregue pelo painel deste aparelho (depois que você entra). A senha só destranca a chave dos logins
// (fica na memória durante esta chamada; nunca é gravada).
async function link(session, password) {
  await cloud.link(session);
  if (password) {
    const r = await vaultOf()
      .unlock(password)
      .catch((e) => ({ error: e.message }));
    if (r.error) console.error(`⚠️  Chave dos logins: ${r.error}`);
    else if (r.rewrapped) console.log('🔐 Chave dos logins trancada de novo com a senha nova');
    if (started) console.log(VAULT_MSG[vaultOf().status()]);
  }
  await startDevice();
}

// Senha trocada, chave trancada (abrir com a senha antiga) ou começar uma chave nova
async function vaultAction({ mode, password, oldPassword }) {
  const v = vaultOf();
  if (mode === 'unlock') return v.unlock(password);
  if (mode === 'rewrap') return v.rewrap(password);
  if (mode === 'unlock-old') return v.unlockOld(oldPassword, password);
  if (mode === 'reset') {
    const r = await v.reset(password);
    await logins.reload();
    return r;
  }
  throw new Error('Ação desconhecida');
}

function stopAll() {
  publisher.stop();
  scheduler.stop();
  backup.stop();
  runner.stopWatchdog();
  uptime.stop(); // grava as horas ligado
}

module.exports = {
  startDevice,
  link,
  vaultAction,
  vaultStatus: () => (cloud.user() ? vaultOf().status() : 'off'),
  stopAll,
  started: () => started,
};
