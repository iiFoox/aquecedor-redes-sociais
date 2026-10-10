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

test('sessão curta da rotina cobre a parte dela de cada meta, não da média (caso do perfil único)', () => {
  // Caso real: 1ª sessão do dia (37%), plano com 1 perfil. Perfil + 3 vídeos + 1 curtida dava 43% de média
  // e a sessão acabava em 50 s. Agora precisa de ~37% de cada meta.
  const done = { profile: 1, watch: 3, like: 1 };
  const state = { stop: false, stats: {}, startedAt: 0, endsAt: 1e12, lastProgress: 0, lastBeat: 0 };
  const hooks = { status() {}, action() {}, log() {}, alert() {} };
  const plan = { minutes: 12, watch: 29, like: 5, follow: 0, profile: 1, search: 0 };
  const ctl = createCtl({ state, plan, done: () => done, hooks, target: 0.37, now: () => 0 });
  assert.equal(ctl.goalsDone(), false);
  done.watch = 11;
  assert.equal(ctl.goalsDone(), false); // faltam curtidas: 37% de 5 = 2
  done.like = 2;
  assert.equal(ctl.goalsDone(), true);
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
  // Número de sessões por dia varia (olhando várias contas: uma ou outra pode repetir a semana toda)
  let varied = 0;
  for (let s = 1; s <= 6; s++) {
    const q = await simulate({ account: { platform: 'tiktok', username: 't', interests: ['IA'] }, days: 7, seed: s });
    if (new Set(Object.values(q.daily).map((d) => d.sessions || 0)).size > 1) varied++;
  }
  assert.ok(varied >= 4, `só ${varied} de 6 contas variaram o número de sessões por dia`);
  for (const d of Object.values(r.daily))
    if (d.plan) assert.notEqual(rules.dayStatus(tiktok.activities, d.plan, d, { interests: ['IA'] }), 'pending');
});

test('prioridade: o que falta no dia manda na escolha da atividade', () => {
  // O caso do print: vídeos batidos (35/34), faltam 6 curtidas e 1 perfil
  const plan = { minutes: 12, watch: 34, like: 6, follow: 0, profile: 1, search: 0 };
  const done = { watch: 35 };
  const g = tiktok.activities;
  const fyp = rules.activityPriority(g.fyp, plan, done);
  const profile = rules.activityPriority(g.profile, plan, done);
  assert.equal(profile, 1); // falta 100% dos perfis e não passa nada do plano
  assert.equal(fyp, 0.25); // só curtidas faltam por ali, e cada vídeo a mais passa do plano
  assert.ok(profile > fyp * 2);
  // Nada falta que a atividade adiante: prioridade zero
  assert.equal(rules.activityPriority(g.profile, plan, { ...done, profile: 1 }), 0);
  // Começo do dia: o Para Você adianta vídeos e curtidas (as duas metas inteiras)
  assert.equal(rules.activityPriority(g.fyp, plan, {}), 2);
  assert.equal(rules.missingText(plan, done, tiktok.actions), '6 curtidas, 1 perfis visitados');
});

test('sessão com vídeos já batidos vai atrás das curtidas e do perfil sem passar do teto', async () => {
  const { simulateSession } = require('../motor/sim/simulate');
  const { createFakeClock } = require('../motor/sim/fakePage');
  for (let seed = 1; seed <= 20; seed++) {
    const plan = { minutes: 12, watch: 34, like: 6, follow: 0, profile: 1, search: 0 };
    const today = { watch: 35 };
    const r = await simulateSession({
      account: { platform: 'tiktok', username: 't', interests: [], persona: human.makePersona(seed) },
      platform: tiktok,
      plan,
      today,
      clock: createFakeClock(Date.parse('2026-10-08T15:00:00-03:00')),
      rng: human.makeRng(seed),
    });
    assert.equal(today.profile, 1, `semente ${seed}: perfil ficou para trás (${r.reason})`);
    assert.ok(today.watch <= Math.ceil(34 * rules.GOAL_CAP), `semente ${seed}: ${today.watch} vídeos`);
    assert.ok(today.like >= 6 || r.reason === 'limit', `semente ${seed}: ${today.like} curtidas (${r.reason})`);
  }
});

test('curtidas: dia normal sempre fecha as curtidas do plano, sem passar dele', async () => {
  for (const platform of ['tiktok', 'instagram']) {
    for (let seed = 1; seed <= 30; seed++) {
      const r = await simulate({ account: { platform, username: 't', interests: ['receitas'] }, days: 4, seed });
      for (const [date, d] of Object.entries(r.daily)) {
        if (!d.plan) continue;
        assert.equal(d.like || 0, d.plan.like, `${platform} semente ${seed} ${date}: ${d.like || 0}/${d.plan.like} curtidas`);
      }
    }
  }
});

test('alertas: a mesma falha 3 vezes na sessão e sessão que vê vídeos sem curtir viram aviso no painel', () => {
  const alerts = [];
  const logs = [];
  const state = { stop: false, stats: {}, startedAt: 0, endsAt: 1e12, lastProgress: 0, lastBeat: 0 };
  const ctl = createCtl({
    state,
    plan: { watch: 30, like: 6 },
    done: () => ({}),
    now: () => 0,
    hooks: { status() {}, action() {}, log: (m) => logs.push(m), alert: (level, msg, kind) => alerts.push({ level, msg, kind }) },
  });
  const err = new Error('this.page.browser is not a function\n    at stack');
  ctl.fail('Assistir o Para Você', err);
  ctl.fail('Assistir o Para Você', err);
  assert.equal(alerts.length, 0);
  ctl.fail('Assistir o Para Você', err);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].msg, /falhou 3 vezes.*this\.page\.browser is not a function/);
  assert.equal(alerts[0].kind, 'error');
  ctl.fail('Assistir o Para Você', err); // não repete o alerta a cada falha
  assert.equal(alerts.length, 1);
  assert.equal(logs.length, 4);
  assert.ok(!logs[0].includes('at stack'));

  assert.match(rules.noLikeWarning(6, { watch: 12 }), /12 vídeos e não curtiu nenhum, com 6 curtidas faltando/);
  assert.equal(rules.noLikeWarning(6, { watch: 12, like: 1 }), null); // curtiu algo
  assert.equal(rules.noLikeWarning(6, { watch: 4 }), null); // viu pouco
  assert.equal(rules.noLikeWarning(0, { watch: 30 }), null); // não faltava curtida
  assert.match(rules.noLikeWarning(3, { reel: 10 }), /10 vídeos/); // reels do Instagram contam
});

test('"Iniciar" (sessão inteira): fecha 100% do dia em todas as fases, sem passar do teto', async () => {
  const { simulateSession } = require('../motor/sim/simulate');
  const { createFakeClock } = require('../motor/sim/fakePage');
  const platforms = require('../motor/platforms');
  for (const pid of ['tiktok', 'instagram']) {
    const platform = platforms[pid];
    for (let seed = 1; seed <= 20; seed++) {
      for (const day of [1, 5, 10, 15, 20]) {
        const plan = platform.planForDay(day, human.makeRng(seed * 31 + day));
        const today = {};
        const r = await simulateSession({
          account: { platform: pid, username: 't', interests: ['receitas'], persona: human.makePersona(seed) },
          platform,
          plan,
          today,
          clock: createFakeClock(Date.parse('2026-10-08T15:00:00-03:00')),
          rng: human.makeRng(seed + day),
        });
        const where = `${pid} semente ${seed} dia ${day}`;
        assert.equal(r.reason, 'goals', `${where}: terminou por ${r.reason}`);
        for (const k of Object.keys(plan)) {
          if (k === 'minutes') continue;
          assert.ok((today[k] || 0) >= plan[k], `${where}: ${k} ${today[k] || 0}/${plan[k]}`);
          assert.ok((today[k] || 0) <= rules.capOf(plan[k]), `${where}: ${k} passou do teto`);
        }
      }
    }
  }
});

// ---------- Horas em que o aparelho costuma ficar ligado ----------

const LOG = [
  '===== 07/10/2026, 19:01:15 motor ligado (versão 2.0.2) =====',
  '===== 07/10/2026, 21:00:00 motor parou (código 0) =====',
  '===== 07/10/2026, 22:17:59 motor ligado (versão 2.0.7) =====',
  '===== 08/10/2026, 10:18:15 motor parou (código 0) =====', // 12 h: PC em espera a noite toda
  '===== 08/10/2026, 10:19:02 motor ligado (versão 2.0.8) =====',
  '===== 08/10/2026, 17:11:36 motor parou (código 0) =====',
  '===== 09/10/2026, 10:02:11 motor ligado (versão 2.0.8) =====',
  '===== 09/10/2026, 15:07:29 motor parou (código 0) =====',
  '===== 10/10/2026, 09:39:53 motor ligado (versão 2.0.8) =====', // ainda ligado: fica de fora
].join('\n');

test('horas ligado: o passado vem do registro do motor; noite em espera (mais de 12 h) não conta', () => {
  const u = rules.uptimeFromLog(LOG);
  assert.deepEqual(Object.keys(u).sort(), ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(u['2026-10-07'][19], 59);
  assert.equal(u['2026-10-07'][22], 0, 'contou a noite em espera');
  assert.equal(u['2026-10-08'][3], 0);
  assert.equal(u['2026-10-08'][12], 60);
  assert.equal(u['2026-10-09'][15], 8);
  // Guarda só 21 dias
  const big = {};
  for (let i = 0; i < 30; i++) rules.addUptime(big, Date.parse('2026-09-01T15:00:00Z') + i * 86400000, 5);
  assert.equal(Object.keys(big).length, 21);
});

test('horas ligado: hora boa é a ligada em pelo menos metade dos dias; menos de 2 dias = ainda não sabe', () => {
  const u = rules.uptimeFromLog(LOG);
  const h = rules.onHours(u, '2026-10-10');
  assert.deepEqual(
    h.map((b, i) => (b ? i : null)).filter((x) => x !== null),
    [10, 11, 12, 13, 14],
  );
  assert.equal(rules.onHours(u, '2026-10-08'), null, 'só 1 dia de histórico antes do dia 8');
  assert.equal(rules.onHours({}, '2026-10-10'), null);
});

test('Rotina: com as horas do aparelho, toda sessão começa nelas e cabe nelas (30 min); dia começado tarde = uma agora', () => {
  const hours = rules.onHours(rules.uptimeFromLog(LOG), '2026-10-10');
  for (let seed = 1; seed <= 60; seed++) {
    const persona = human.makePersona(seed);
    const slots = rules.planSlots({ date: '2026-10-11', window: WIN, persona, planMinutes: 20, rng: human.makeRng(seed), onHours: hours });
    assert.ok(slots.length >= 1);
    for (const s of slots) {
      const m = minuteOf(s.at);
      assert.ok(hours[Math.floor(m / 60)] && hours[Math.floor((m + 30) / 60)], `seed ${seed}: sessão às ${Math.floor(m / 60)}:${m % 60}`);
    }
    assert.equal(slots[slots.length - 1].target, 1);
  }
  // Ligou às 16h (fora do costume): uma sessão só, já
  const late = Date.parse('2026-10-11T19:00:00Z'); // 16:00 em São Paulo
  const one = rules.planSlots({
    date: '2026-10-11',
    window: WIN,
    persona: human.makePersona(1),
    rng: human.makeRng(1),
    onHours: hours,
    notBefore: late,
  });
  assert.equal(one.length, 1);
  assert.ok(one[0].at - late < 10 * 60000);
  assert.equal(one[0].target, 1);
});

test('Rotina: sessões que ainda vão cair fora das horas do aparelho são replanejadas; as feitas ficam', () => {
  const hours = new Array(24).fill(false).map((_, h) => h >= 10 && h < 15);
  const at = (hh, mm) => Date.parse(`2026-10-10T${String(hh + 3).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const slots = [
    { at: at(10, 30), target: 0.4 },
    { at: at(19, 40), target: 1 },
  ];
  const now = at(11, 0);
  assert.equal(rules.slotsOffHours(slots, 1, hours, now), true);
  assert.equal(rules.slotsOffHours(slots, 2, hours, now), false, 'nada mais a fazer hoje');
  assert.equal(rules.slotsOffHours(slots, 1, null, now), false, 'sem saber as horas não mexe');
  const fresh = [
    { at: at(12, 0), target: 0.5 },
    { at: at(14, 0), target: 1 },
  ];
  assert.deepEqual(rules.replanRest(slots, 1, fresh), [
    { at: at(10, 30), target: 0.4 },
    { at: at(12, 0), target: 0.7 },
    { at: at(14, 0), target: 1 },
  ]);
});
