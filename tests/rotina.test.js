// Rotina de gente de verdade: sessões planejadas por dia, perto do horário preferido da conta,
// de tamanhos diferentes, e contas que não abrem em horários casados.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../motor/rules');
const human = require('../motor/human');
const tiktok = require('../motor/platforms/tiktok');
const { createCtl } = require('../motor/ctl');
const { simulate } = require('../motor/sim/simulate');

const WIN = { start: '08:00', end: '22:00' };
const minuteOf = (ms) => rules.localMinutes(new Date(ms));
const slotsFor = (seed, opts = {}) =>
  rules.planSlots({
    date: '2026-10-08',
    window: WIN,
    persona: human.makePersona(seed),
    planMinutes: 30,
    rng: human.makeRng(seed),
    ...opts,
  });

test('rotina: dentro da janela, 45 min entre sessões, tamanhos crescentes e a última fecha 100%', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = slotsFor(seed);
    assert.ok(s.length >= 1 && s.length <= 4);
    s.forEach((x, i) => {
      const m = minuteOf(x.at);
      assert.ok(m >= 8 * 60 && m <= 22 * 60 - 20, `s${seed}: sessão às ${m} min fora da janela`);
      assert.equal(rules.localDate(new Date(x.at)), '2026-10-08');
      if (i > 0) {
        assert.ok(x.at - s[i - 1].at >= 45 * 60000, `s${seed}: sessões coladas`);
        assert.ok(x.target > s[i - 1].target);
      }
    });
    assert.equal(s[s.length - 1].target, 1);
  }
});

test('rotina: plano curto tem menos sessões; fim de semana tem menos e mais tarde', () => {
  const avg = (date, planMinutes) => {
    let n = 0;
    let first = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = rules.planSlots({ date, window: WIN, persona: human.makePersona(seed), planMinutes, rng: human.makeRng(seed) });
      n += s.length;
      first += minuteOf(s[0].at);
    }
    return { n: n / 400, first: first / 400 };
  };
  assert.ok(avg('2026-10-08', 8).n <= 1.01); // fase 1 do Instagram (8 min): uma sessão
  const weekday = avg('2026-10-08', 30); // quinta
  const weekend = avg('2026-10-10', 30); // sábado
  assert.ok(weekend.n < weekday.n, `fim de semana ${weekend.n} x semana ${weekday.n}`);
  assert.ok(weekend.first > weekday.first, 'fim de semana deveria começar mais tarde');
});

test('rotina: horário preferido da conta pesa (noturna x matinal)', () => {
  const share = (peak) => {
    let near = 0;
    let all = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const persona = { ...human.makePersona(seed), peak, spread: 1.5 };
      for (const x of rules.planSlots({ date: '2026-10-08', window: WIN, persona, planMinutes: 30, rng: human.makeRng(seed) })) {
        all++;
        if (Math.abs(minuteOf(x.at) - peak * 60) <= 120) near++;
      }
    }
    return near / all;
  };
  // Sorteio uniforme na janela de 14 h daria ~27% a até 2 h do pico
  assert.ok(share(20) > 0.45, `noturna: ${share(20)}`);
  assert.ok(share(10) > 0.45, `matinal: ${share(10)}`);
});

test('rotina: motor ligado no meio do dia não planeja sessão no passado; janela que passa da meia-noite funciona', () => {
  const now = Date.parse('2026-10-08T15:30:00-03:00');
  for (let seed = 1; seed <= 100; seed++) {
    for (const x of slotsFor(seed, { notBefore: now })) assert.ok(x.at >= now);
  }
  const night = rules.planSlots({
    date: '2026-10-08',
    window: { start: '20:00', end: '02:00' },
    persona: human.makePersona(3),
    planMinutes: 30,
    rng: human.makeRng(3),
  });
  for (const x of night) assert.ok(rules.inWindow(minuteOf(x.at), '20:00', '02:00'));
});

test('agendador: espera a sessão planejada e não abre colado em outra conta', () => {
  const config = { active: true, start: '08:00', end: '22:00', max: 2 };
  const plan = { watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  const now = new Date('2026-10-08T15:00:00-03:00');
  const acc = { id: 'a', interests: [], history: [], attention: null };
  const ctx = (over) => ({
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
  assert.equal(rules.decide(acc, ctx({ slots: [{ at: now.getTime() + 600000, target: 0.5 }] })), 'agendada');
  assert.equal(rules.decide(acc, ctx({ slots: [{ at: now.getTime() - 600000, target: 0.5 }] })), 'iniciar');
  // Primeira sessão feita: olha a segunda
  assert.equal(
    rules.decide(acc, ctx({ today: { sessions: 1 }, slots: [{ at: 0 }, { at: now.getTime() + 60000, target: 1 }] })),
    'agendada',
  );
  // Outra conta abriu há 1 min: espera de 4 a 14 min
  assert.equal(rules.decide(acc, ctx({ lastStartAny: now.getTime() - 60000 })), 'espacamento');
  assert.equal(rules.decide(acc, ctx({ lastStartAny: now.getTime() - 15 * 60000 })), 'iniciar');
  const gaps = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => rules.spacingMs({ id }, '2026-10-08')));
  assert.ok(gaps.size > 2, 'espaçamento igual para todas as contas');
});

test('sessão curta da rotina para quando cobre a parte dela do dia', () => {
  const done = { watch: 0, like: 0 };
  const state = { stop: false, stats: {}, startedAt: 0, endsAt: 1e12, lastProgress: 0, lastBeat: 0 };
  const hooks = { status() {}, action() {}, log() {}, alert() {} };
  const ctl = createCtl({ state, plan: { watch: 20, like: 4 }, done: () => done, hooks, target: 0.5, now: () => 0 });
  assert.equal(ctl.goalsDone(), false);
  done.watch = 10;
  done.like = 2;
  assert.equal(ctl.goalsDone(), true);
  const full = createCtl({ state, plan: { watch: 20, like: 4 }, done: () => done, hooks, now: () => 0 });
  assert.equal(full.goalsDone(), false);
});

test('simulador: horários mudam de um dia para o outro e o dia sempre fecha a meta', async () => {
  const r = await simulate({ account: { platform: 'tiktok', username: 't', interests: ['IA'] }, days: 7, seed: 12 });
  const firstOfDay = {};
  for (const s of r.sessions) if (!(s.date in firstOfDay)) firstOfDay[s.date] = minuteOf(s.start);
  const starts = Object.values(firstOfDay);
  const mean = starts.reduce((a, b) => a + b, 0) / starts.length;
  const sd = Math.sqrt(starts.reduce((a, b) => a + (b - mean) ** 2, 0) / starts.length);
  assert.ok(sd > 45, `primeira sessão quase sempre no mesmo horário (desvio ${sd.toFixed(0)} min)`);
  const perDay = Object.values(r.daily).map((d) => d.sessions || 0);
  assert.ok(new Set(perDay).size > 1, 'sempre o mesmo número de sessões por dia');
  for (const d of Object.values(r.daily))
    if (d.plan) assert.notEqual(rules.dayStatus(tiktok.activities, d.plan, d, { interests: ['IA'] }), 'pending');
});
