// Fase 2: janela por conta, férias, backup, escolha de proxy e validação dos campos novos.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../motor/rules');
const tiktok = require('../motor/platforms/tiktok');
const { schemas } = require('../motor/validate');

const at = (s) => new Date(s);
const config = { active: true, start: '08:00', end: '22:00', max: 2 };
const plan = { watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
const acc = { id: 'a', interests: [], history: [], attention: null };
const ctx = (over = {}) => ({
  now: at('2026-10-07T10:00:00-03:00'),
  config,
  runningCount: 0,
  running: false,
  browserOpen: false,
  plan,
  today: {},
  activities: tiktok.activities,
  ...over,
});

test('janela da conta substitui a janela geral', () => {
  const night = { ...acc, window: { start: '20:00', end: '02:00' } };
  assert.equal(rules.decide(night, ctx()), 'fora-da-janela'); // 10:00, fora da janela dela
  assert.equal(rules.decide(night, ctx({ now: at('2026-10-07T23:30:00-03:00') })), 'iniciar'); // geral já fechou, a dela não
  assert.equal(rules.decide(acc, ctx({ now: at('2026-10-07T23:30:00-03:00') })), 'fora-da-janela');
  assert.deepEqual(rules.windowOf(acc, config), { start: '08:00', end: '22:00' });
});

test('backup pendente e proxy fora do ar seguram sessões novas', () => {
  assert.equal(rules.decide(acc, ctx({ backupHold: true })), 'backup');
  assert.equal(rules.decide(acc, ctx({ proxyDown: true })), 'proxy-fora');
});

test('plano só é sorteado quando a decisão chega na meta', () => {
  let calls = 0;
  const lazy = () => {
    calls++;
    return plan;
  };
  rules.decide({ ...acc, window: { start: '20:00', end: '21:00' } }, ctx({ plan: lazy }));
  assert.equal(calls, 0);
  assert.equal(rules.decide(acc, ctx({ plan: lazy })), 'iniciar');
  assert.equal(calls, 1);
});

test('férias: só os dias inteiros entre a saída e a volta contam', () => {
  const from = Date.parse('2026-10-06T15:00:00-03:00');
  assert.deepEqual(rules.vacationDays(from, Date.parse('2026-10-09T00:00:00-03:00')), ['2026-10-07', '2026-10-08']);
  assert.deepEqual(rules.vacationDays(from, Date.parse('2026-10-06T20:00:00-03:00')), []); // voltou no mesmo dia
  assert.deepEqual(rules.vacationDays(from, Date.parse('2026-10-07T09:00:00-03:00')), []); // voltou no dia seguinte
});

test('férias: o aquecimento continua do dia em que parou', () => {
  const started = '2026-10-06T14:43:55.138Z'; // dia 1 em 06/10
  const days = ['2026-10-07', '2026-10-08'];
  const { startedAt, skipped } = rules.shiftStart(started, days);
  assert.equal(skipped, 2);
  // Saiu no dia 1 (06/10), voltou em 09/10: é o dia 2, não o dia 4
  assert.equal(rules.dayOf({ startedAt }, at('2026-10-09T10:00:00-03:00')), 2);
  // Conta cadastrada no meio das férias só anda os dias depois do cadastro
  assert.equal(rules.shiftStart('2026-10-07T18:00:00Z', days).skipped, 1);
});

test('férias não derrubam a consistência da saúde', () => {
  const now = at('2026-10-09T20:00:00-03:00');
  const base = {
    startedAt: '2026-10-03T12:00:00Z',
    history: [{ result: 'ok', completion: 1 }],
    alerts: [],
    daily: {
      '2026-10-03': { sessions: 2 },
      '2026-10-04': { sessions: 2 },
      '2026-10-05': { sessions: 2 },
      '2026-10-06': { sessions: 2 },
      '2026-10-09': { sessions: 1 },
    },
  };
  assert.equal(rules.computeHealth(base, now).consistency, 71); // 5 de 7 dias
  const vac = { ...base, daily: { ...base.daily, '2026-10-07': { vacation: true }, '2026-10-08': { vacation: true } } };
  assert.equal(rules.computeHealth(vac, now).consistency, 100);
});

test('saúde: metas pelo dia inteiro, não por sessão (a 1ª sessão da rotina cobre só parte do dia)', () => {
  const now = at('2026-10-07T11:00:00-03:00');
  const plan = { watch: 29, like: 5, profile: 1 };
  // Conta nova: 1ª sessão (37% do dia) fez a parte dela; não é meta perdida
  const novo = {
    startedAt: '2026-10-07T12:00:00Z',
    history: [{ result: 'ok', completion: 0.43 }],
    alerts: [],
    daily: { '2026-10-07': { plan, sessions: 1, watch: 11, like: 2, profile: 1, slots: [{ target: 0.37 }, { target: 1 }] } },
  };
  assert.equal(rules.computeHealth(novo, now).completion, 100);
  // Com dias anteriores: média dos últimos dias que acabaram
  const antigo = {
    ...novo,
    startedAt: '2026-10-01T12:00:00Z',
    daily: {
      ...novo.daily,
      '2026-10-06': { plan, sessions: 2, watch: 29, like: 5, profile: 1 },
      '2026-10-05': { plan, sessions: 2, watch: 29, like: 0, profile: 1 },
    },
  };
  assert.equal(rules.computeHealth(antigo, now).completion, 83); // (100% + 67%) / 2
});

test('proxy fora do ar não derruba a saúde', () => {
  const now = at('2026-10-06T23:00:00-03:00');
  const a = {
    startedAt: '2026-10-06T12:00:00Z',
    daily: { '2026-10-06': { sessions: 1 } },
    history: [{ result: 'ok', completion: 1 }],
    alerts: [{ t: now.getTime() - 1000, level: 'warn', kind: 'proxy' }],
  };
  assert.equal(rules.computeHealth(a, now).safety, 100);
});

test('backup: a partir das 04:00, uma vez por dia; falhou, tenta de novo em 30 min', () => {
  const d = (s) => at(`2026-10-07T${s}-03:00`);
  assert.equal(rules.backupDue(d('03:59:00'), null), false);
  assert.equal(rules.backupDue(d('04:00:00'), null), true);
  assert.equal(rules.backupDue(d('15:00:00'), null), true); // computador desligado às 4h: faz quando ligar
  assert.equal(rules.backupDue(d('15:00:00'), { at: d('04:01:00').getTime() }), false);
  assert.equal(rules.backupDue(d('04:00:00'), { at: Date.parse('2026-10-06T04:01:00-03:00') }), true);
  const failed = { at: Date.parse('2026-10-06T04:01:00-03:00'), triedAt: d('04:00:00').getTime(), error: 'x' };
  assert.equal(rules.backupDue(d('04:20:00'), failed), false);
  assert.equal(rules.backupDue(d('04:31:00'), failed), true);
});

test('proxy automático: o online com menos contas, depois o mais rápido', () => {
  const proxies = [
    { url: 'http://a:1', status: 'online', ms: 300 },
    { url: 'http://b:1', status: 'online', ms: 900 },
    { url: 'http://c:1', status: 'offline', ms: 0 },
    { url: 'http://d:1', status: 'online', ms: 100 },
  ];
  const accounts = [{ proxy: 'http://d:1' }, { proxy: 'http://a:1' }];
  assert.equal(rules.pickProxy(proxies, accounts), 'http://b:1');
  assert.equal(rules.pickProxy(proxies, []), 'http://d:1');
  assert.equal(rules.pickProxy([{ url: 'http://c:1', status: 'offline' }], []), null);
  assert.equal(rules.proxyHost('http://u:senha@1.2.3.4:8080'), '1.2.3.4:8080'); // nunca mostra a senha
});

test('edição da conta: só os campos enviados mudam', () => {
  assert.deepEqual(schemas.accountPatch.parse({ window: { start: '20:00', end: '02:00' } }), { window: { start: '20:00', end: '02:00' } });
  assert.deepEqual(schemas.accountPatch.parse({ window: null }), { window: null });
  assert.deepEqual(schemas.accountPatch.parse({ proxy: 'auto' }), { proxy: 'auto' });
  assert.deepEqual(schemas.accountPatch.parse({ proxy: '' }), { proxy: '' });
  assert.deepEqual(schemas.accountPatch.parse({}), {});
  assert.equal(schemas.accountPatch.safeParse({ window: { start: '25:00', end: '02:00' } }).success, false);
  assert.equal(schemas.accountPatch.safeParse({ proxy: 'lixo' }).success, false);
  assert.equal(schemas.newAccount.parse({ username: 'ok', proxy: 'auto' }).proxy, 'auto');
});

test('férias: exige a data de volta no formato certo', () => {
  assert.equal(schemas.vacation.parse({ until: '2026-10-20' }).until, '2026-10-20');
  assert.equal(schemas.vacation.safeParse({ until: '20/10/2026' }).success, false);
  assert.equal(schemas.vacation.safeParse({}).success, false);
});
