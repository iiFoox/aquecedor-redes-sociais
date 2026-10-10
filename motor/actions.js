// Ações nas contas. Conta deste aparelho: roda aqui. Conta de outro aparelho: vira comando para o aparelho dono
// (cloud.sendCommand), que executa pelo mesmo código (execute). Assim o painel de qualquer aparelho comanda qualquer conta.
const store = require('./store');
const runner = require('./runner');
const rules = require('./rules');
const cloud = require('./cloud');
const screens = require('./screens');
const logins = require('./logins');
const { CHECKLIST } = require('./platforms/phases');

const fail = (msg, status = 409) => Object.assign(new Error(msg), { status });

// Muda proxy, interesses, janela de horário ou checklist (no aparelho dono da conta)
function applyPatch(acc, body) {
  const patch = { ...body };
  if (patch.checklist) {
    const before = acc.checklist || {};
    patch.checklist = { ...before, ...patch.checklist };
    const complete = CHECKLIST.every((c) => patch.checklist[c.key]);
    if (complete && !CHECKLIST.every((c) => before[c.key]))
      store.addLog(acc.id, 'Checklist "conta pronta" completo: pode começar a postar');
  }
  if ('proxy' in patch) {
    if (runner.getSession(acc.id) || runner.isBrowserOpen(acc.id))
      throw fail('Feche a sessão ou o navegador desta conta antes de trocar o proxy');
    if (patch.proxy === 'auto') {
      patch.proxy = rules.pickProxy(
        store.allProxies(),
        store.all().filter((x) => x.id !== acc.id),
      );
      if (!patch.proxy) throw fail('Nenhum proxy online na lista para escolher');
    }
    store.ensureProxy(patch.proxy, store.userId());
    if (!patch.proxy) patch.proxy = null;
  }
  store.updateAccount(acc.id, patch);
  const what = [
    'window' in patch && (patch.window ? `horário ${patch.window.start}–${patch.window.end}` : 'horário geral'),
    'proxy' in patch && (patch.proxy ? `proxy ${rules.proxyHost(patch.proxy)}` : 'sem proxy'),
    'interests' in patch && 'interesses',
  ].filter(Boolean);
  if (what.length) store.addLog(acc.id, `Conta atualizada: ${what.join(', ')}`);
}

// Executa a ação AQUI (a conta é deste aparelho)
async function local(kind, acc, payload = {}) {
  switch (kind) {
    case 'start':
      return runner.startSession(acc, { manual: true }); // clicou em Iniciar: vai até 100% do dia
    case 'stop':
      return runner.stopSession(acc.id);
    case 'login':
      return runner.openBrowser(acc, 'login');
    case 'captcha':
      // Sessão esperando você no captcha: traz a janela dela para a frente (não abre outra)
      if (await runner.showSessionWindow(acc.id)) return;
      return runner.openBrowser(acc, 'captcha');
    case 'close-browser':
      return runner.closeBrowser(acc.id);
    case 'release':
      store.clearAttention(acc.id, 'Conta liberada por você');
      return runner.notify({ type: 'attention', id: acc.id, attention: null });
    case 'patch':
      return applyPatch(acc, payload);
    case 'remove':
      runner.stopSession(acc.id);
      await runner.closeBrowser(acc.id);
      screens.removeAll(acc.id).catch(() => {}); // o login salvo sai junto com a conta (banco)
      logins.forget(acc.id);
      return store.remove(acc.id);
    case 'move-out': {
      // Outro aparelho pediu a conta: encerra o que estiver aberto aqui e passa
      const s = runner.getSession(acc.id);
      runner.stopSession(acc.id);
      if (s && s.done) await s.done.catch(() => {}); // espera a sessão fechar e gravar o histórico
      await runner.closeBrowser(acc.id);
      store.addLog(acc.id, 'Conta levada para outro aparelho');
      return store.releaseAccount(acc.id, payload.to);
    }
    default:
      throw fail(`Ação desconhecida: ${kind}`, 400);
  }
}

const onlineOf = async (deviceId) => {
  const list = await cloud.listDevices().catch(() => []);
  const d = list.find((x) => x.id === deviceId);
  return { online: !!(d && d.online), name: d ? d.name : 'outro aparelho' };
};

// Ação pedida pelo painel deste aparelho para qualquer conta do usuário
async function run(kind, acc, payload = {}) {
  if (store.isMine(acc)) {
    await local(kind, acc, payload);
    return { ok: true };
  }
  if (!acc.deviceId) throw fail('Esta conta ainda não roda em nenhum aparelho. Clique em "Rodar neste aparelho".');
  const dev = await onlineOf(acc.deviceId);
  if (kind === 'login' || kind === 'captcha')
    throw fail(`O navegador desta conta abre no aparelho dono dela (${dev.name}). Abra o app lá, ou traga a conta para este aparelho.`);
  if (kind === 'remove' && !dev.online) {
    // Aparelho dono desligado: apaga direto (as regras do banco garantem que é sua)
    const r = await cloud.client().from('accounts').delete().eq('id', acc.id);
    if (r.error) throw fail(r.error.message, 500);
    store.forget(acc.id);
    screens.removeAll(acc.id).catch(() => {});
    logins.forget(acc.id);
    return { ok: true };
  }
  if (!dev.online) throw fail(`${dev.name} está desligado. O pedido fica na fila por 10 min; ligue o app lá ou traga a conta para cá.`);
  await cloud.sendCommand(acc.deviceId, kind, acc.id, payload);
  return { ok: true, queued: true, device: dev.name };
}

// "Rodar neste aparelho": conta sem aparelho vem direto; de outro aparelho ligado, pede para ele soltar;
// de aparelho desligado há mais de 3 min, vem direto (ele não está rodando nada).
async function claim(acc) {
  if (store.isMine(acc)) return { ok: true };
  if (!acc.deviceId) {
    await store.claimAccount(acc.id);
    store.addLog(acc.id, `Conta passou a rodar em ${cloud.device().name}`);
    return { ok: true };
  }
  const dev = await onlineOf(acc.deviceId);
  if (!dev.online) {
    // Parece desligado, mas a trava ainda vale: pode estar sem internet com a conta aberta. Espera vencer.
    if (rules.leaseHeld(acc, cloud.device().id))
      throw fail(
        `${dev.name} estava com a conta aberta há pouco. Tente de novo depois das ${new Date(acc.lease.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
      );
    await store.claimAccount(acc.id);
    store.addLog(acc.id, `Conta trazida de ${dev.name} (desligado) para ${cloud.device().name}`);
    return { ok: true };
  }
  await cloud.sendCommand(acc.deviceId, 'move-out', acc.id, { to: cloud.device().id });
  return { ok: true, queued: true, device: dev.name };
}

// Comando que chegou de outro aparelho
async function execute(cmd) {
  if (cmd.kind === 'pause-all' || cmd.kind === 'resume-all') return store.setConfig({ active: cmd.kind === 'resume-all' });
  const acc = store.get(cmd.account_id);
  if (!acc) throw new Error('Conta não encontrada neste aparelho');
  if (!store.isMine(acc)) throw new Error('Esta conta não roda mais neste aparelho');
  store.addLog(acc.id, `Pedido de outro aparelho: ${LABEL[cmd.kind] || cmd.kind}`);
  await local(cmd.kind, acc, cmd.payload || {});
}

const LABEL = {
  start: 'iniciar',
  stop: 'parar',
  'close-browser': 'fechar o navegador',
  release: 'liberar',
  patch: 'mudar ajustes',
  remove: 'apagar a conta',
  'move-out': 'levar a conta para outro aparelho',
};

module.exports = { run, claim, execute, local, applyPatch };
