// Regras do aquecimento. Os casos usam os números reais da @alemdofato5 em 06/10.
// Nenhum teste abre o TikTok ou o Instagram.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../motor/rules');
const tiktok = require('../motor/platforms/tiktok');
const instagram = require('../motor/platforms/instagram');

const at = (s) => new Date(s);
const STARTED = '2026-10-06T14:43:55.138Z'; // 11:43 em Brasília

test('dia do aquecimento vira à meia-noite, não 24 h depois do cadastro', () => {
  const acc = { startedAt: STARTED };
  assert.equal(rules.dayOf(acc, at('2026-10-06T23:00:00-03:00')), 1);
  assert.equal(rules.dayOf(acc, at('2026-10-07T00:05:00-03:00')), 2); // antes ficava no dia 1 até 11:43
  assert.equal(rules.dayOf(acc, at('2026-10-09T08:00:00-03:00')), 4); // fase 2 começa de manhã, junto com o plano
});

test('data e hora seguem o fuso do app, não o do computador', () => {
  assert.equal(rules.localDate(at('2026-10-07T02:30:00Z')), '2026-10-06'); // 23:30 em Brasília
  assert.equal(rules.localMinutes(at('2026-10-07T02:30:00Z')), 23 * 60 + 30);
});

test('plano do dia é sorteado uma vez por data', () => {
  const daily = {};
  let calls = 0;
  const gen = (day) => ({ day, n: ++calls });
  const a = rules.ensurePlan(daily, '2026-10-07', 2, gen);
  const b = rules.ensurePlan(daily, '2026-10-07', 2, gen);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(calls, 1);
  assert.deepEqual(b.plan, a.plan);
});

test('cumprimento da meta ignora minutos e metas zeradas', () => {
  assert.equal(rules.completion({ minutes: 10, watch: 27, like: 5, follow: 0 }, { watch: 55, like: 4 }), 0.9);
  assert.equal(rules.completion({ minutes: 10, follow: 0 }, {}), 1);
});

test('teto de 120%: com 55 vídeos para 27, não abre outra sessão só pela 5ª curtida', () => {
  const plan = { minutes: 10, watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  const done = { watch: 55, like: 4, profile: 1 };
  assert.equal(rules.capOf(27), 33);
  assert.equal(rules.isCapped(plan, done, 'watch'), true);
  assert.equal(rules.canProgress(tiktok.activities, plan, done, { interests: ['IA'] }), false);
  assert.equal(rules.dayStatus(tiktok.activities, plan, done, { interests: ['IA'] }), 'limit');
});

test('teto de 120%: abaixo do teto ainda pode buscar a curtida que falta', () => {
  const plan = { watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  assert.equal(rules.dayStatus(tiktok.activities, plan, { watch: 30, like: 4 }, { interests: [] }), 'pending');
  assert.equal(rules.dayStatus(tiktok.activities, plan, { watch: 27, like: 5 }, { interests: [] }), 'done');
});

test('meta zerada no plano bloqueia a atividade que conta essa meta', () => {
  const plan = { watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  const done = { watch: 10, like: 1 };
  assert.equal(rules.activityAllowed(tiktok.activities.search, plan, done, { interests: ['IA'] }), false);
  assert.equal(rules.activityAllowed(tiktok.activities.profile, plan, done, {}), false);
  assert.equal(rules.activityAllowed(tiktok.activities.fyp, plan, done, {}), true);
});

test('busca no TikTok só roda com interesses cadastrados', () => {
  const plan = { watch: 45, like: 10, search: 1 };
  assert.equal(rules.activityAllowed(tiktok.activities.search, plan, {}, { interests: [] }), false);
  assert.equal(rules.activityAllowed(tiktok.activities.search, plan, {}, { interests: ['IA'] }), true);
});

test('Instagram: reels no teto não impede as curtidas pelo feed', () => {
  const plan = { like: 8, follow: 3, story: 6, reel: 5, explore: 1 };
  const done = { like: 2, follow: 3, story: 6, reel: 6, explore: 1 };
  assert.equal(rules.activityAllowed(instagram.activities.reels, plan, done, {}), false);
  assert.equal(rules.dayStatus(instagram.activities, plan, done, {}), 'pending');
});

test('janela de horário, inclusive passando da meia-noite', () => {
  const m = rules.toMinutes;
  assert.equal(rules.inWindow(m('07:59'), '08:00', '22:00'), false);
  assert.equal(rules.inWindow(m('08:00'), '08:00', '22:00'), true);
  assert.equal(rules.inWindow(m('21:59'), '08:00', '22:00'), true);
  assert.equal(rules.inWindow(m('22:00'), '08:00', '22:00'), false);
  assert.equal(rules.inWindow(m('23:30'), '20:00', '02:00'), true);
  assert.equal(rules.inWindow(m('01:00'), '20:00', '02:00'), true);
  assert.equal(rules.inWindow(m('03:00'), '20:00', '02:00'), false);
});

test('alertas iguais em até 30 min viram um só (as 4 tentativas sem login de 06/10)', () => {
  const alerts = [];
  const base = Date.parse('2026-10-06T14:44:31Z');
  const mk = (t) => ({ id: String(t), t, lastT: t, count: 1, level: 'warn', kind: 'login', msg: 'Sem login', resolvedAt: null });
  for (const s of [0, 11, 108, 157]) {
    const { alert, merged } = rules.mergeAlert(alerts, mk(base + s * 1000));
    if (!merged) alerts.push(alert);
  }
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].count, 4);
  assert.equal(rules.mergeAlert(alerts, mk(base + 40 * 60000)).merged, false); // 40 min depois é outro
  alerts[0].resolvedAt = base + 1000;
  assert.equal(rules.mergeAlert(alerts, mk(base + 5000)).merged, false); // resolvido não recebe repetição
});

test('tipo do alerta antigo é deduzido do texto', () => {
  assert.equal(rules.kindFromMsg('Conta não está logada no TikTok.'), 'login');
  assert.equal(rules.kindFromMsg('TikTok exibiu um captcha'), 'captcha');
  assert.equal(rules.kindFromMsg('Instagram bloqueou ações temporariamente'), 'block');
  assert.equal(rules.kindFromMsg('Erro inesperado: timeout'), 'other');
});

test('falta de login não derruba a saúde; captcha derruba', () => {
  const now = at('2026-10-06T23:00:00-03:00');
  const t = Date.parse('2026-10-06T14:44:31Z');
  const acc = {
    startedAt: STARTED,
    daily: { '2026-10-06': { sessions: 8 } },
    history: [
      { result: 'not_logged', completion: 0 },
      { result: 'not_logged', completion: 0 },
      { result: 'stopped', completion: 1 },
      { result: 'ok', completion: 1 },
    ],
    alerts: [{ t, level: 'warn', kind: 'login', count: 4 }],
  };
  const h = rules.computeHealth(acc, now);
  assert.equal(h.safety, 100);
  assert.equal(h.completion, 100); // sessões sem login não contam como meta perdida
  assert.equal(h.score, 100);
  acc.alerts.push({ t, level: 'danger', kind: 'captcha', count: 1 });
  assert.equal(rules.computeHealth(acc, now).safety, 50);
});

test('descanso entre sessões da mesma conta tem cauda longa (30 min a 3 h, mediana ~50 min)', () => {
  const human = require('../motor/human');
  const end = Date.parse('2026-10-07T10:00:00-03:00');
  const rng = human.makeRng(4);
  const gaps = Array.from({ length: 3000 }, () => (rules.nextAfter(end, rng) - end) / 60000).sort((a, b) => a - b);
  assert.ok(gaps[0] >= 30 && gaps[gaps.length - 1] <= 180);
  const median = gaps[1500];
  assert.ok(median > 44 && median < 56, `mediana ${median}`);
  assert.ok(gaps[2970] > 100, 'cauda longa: às vezes passa de 1h40');
});

test('agendador decide quando iniciar e por que não iniciou', () => {
  const config = { active: true, start: '08:00', end: '22:00', max: 2 };
  const plan = { watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  const acc = { id: 'a', interests: [], history: [], attention: null };
  const now = at('2026-10-07T10:00:00-03:00');
  const ctx = (over = {}) => ({
    now,
    config,
    runningCount: 0,
    running: false,
    browserOpen: false,
    plan,
    today: {},
    activities: tiktok.activities,
    ...over,
  });

  assert.equal(rules.decide(acc, ctx()), 'iniciar');
  assert.equal(rules.decide(acc, ctx({ config: { ...config, active: false } })), 'piloto-desligado');
  assert.equal(rules.decide(acc, ctx({ now: at('2026-10-07T23:00:00-03:00') })), 'fora-da-janela');
  assert.equal(rules.decide(acc, ctx({ config: { ...config, pausedUntil: now.getTime() + 1 } })), 'ferias');
  assert.equal(rules.decide(acc, ctx({ running: true })), 'rodando');
  assert.equal(rules.decide(acc, ctx({ browserOpen: true })), 'navegador-aberto');
  assert.equal(rules.decide(acc, ctx({ runningCount: 2 })), 'limite-simultaneo');
  assert.equal(rules.decide(acc, ctx({ today: { watch: 27, like: 5 } })), 'meta-batida');
  assert.equal(rules.decide(acc, ctx({ today: { watch: 55, like: 4 } })), 'limite-do-plano');
  assert.equal(rules.decide({ ...acc, nextAfter: now.getTime() + 60000 }, ctx()), 'intervalo');
  assert.equal(rules.decide({ ...acc, nextAfter: now.getTime() - 60000 }, ctx()), 'iniciar');
});

test('captcha e bloqueio seguram a conta até você resolver (não voltam sozinhos em 24 h)', () => {
  const config = { active: true, start: '08:00', end: '22:00', max: 2 };
  const now = at('2026-10-10T10:00:00-03:00');
  const ctx = {
    now,
    config,
    runningCount: 0,
    running: false,
    browserOpen: false,
    plan: { watch: 27, like: 5 },
    today: {},
    activities: tiktok.activities,
  };
  for (const kind of ['captcha', 'block', 'login']) {
    const acc = { id: 'a', interests: [], history: [], attention: { kind, at: now.getTime() - 3 * 86400000 } };
    assert.equal(rules.decide(acc, ctx), 'precisa-atencao', kind);
  }
});

test('trava: outro aparelho com a conta aberta segura; trava vencida ou minha não', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  assert.equal(rules.leaseHeld({ lease: null }, 'A', now), false);
  assert.equal(rules.leaseHeld({ lease: { device: 'B', until: now + 60000 } }, 'A', now), true);
  assert.equal(rules.leaseHeld({ lease: { device: 'B', until: now - 1 } }, 'A', now), false);
  assert.equal(rules.leaseHeld({ lease: { device: 'A', until: now + 60000 } }, 'A', now), false);
  assert.equal(rules.LEASE_MS, 5 * 60000);
});

test('navegador: nunca headless (o Edge sem janela se denuncia como HeadlessChrome); escondido = fora da tela', () => {
  assert.deepEqual(rules.windowMode({ headless: false }), { headless: false, args: [] });
  assert.deepEqual(rules.windowMode({ headless: true }), { headless: false, args: ['--window-position=-32000,-32000'] });
  assert.deepEqual(rules.windowMode({ headless: true }, true), { headless: false, args: [] }, 'janela de login/captcha fica à vista');
});
