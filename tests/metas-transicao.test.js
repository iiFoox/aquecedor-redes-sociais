// Meta personalizada, parte 2: transição suave ao trocar de meta (no máximo +25% por dia sobre o último dia com sessão),
// combinações impossíveis recusadas pelo motor e o texto do que mudou ao editar um modelo. O simulador roda dias
// seguidos trocando de meta no meio, com o código real das plataformas.
const test = require('node:test');
const assert = require('node:assert/strict');
const custom = require('../motor/custom');
const rules = require('../motor/rules');
const platforms = require('../motor/platforms');
const { phaseIndex } = require('../motor/platforms/phases');
const { simulate } = require('../motor/sim/simulate');

const tt = platforms.tiktok;
const tpl = (platform, over = {}) =>
  custom.normalizeTemplate({ name: 'Teste', platform, readyDay: 22, ...over }, platforms[platform].plans, platforms[platform].actions);
const nums = ({ caps, ...rest }) => rest;
const step = (was) => Math.max((was || 0) + 1, Math.ceil((was || 0) * custom.RAMP));

test('transição: sobe no máximo +25% (pelo menos +1) sobre o último dia com sessão; descer é na hora', () => {
  const daily = {
    '2026-10-01': { sessions: 2, watch: 80, like: 30, follow: 8, profile: 6, search: 3 },
    '2026-10-02': { sessions: 0 }, // PC desligado: não conta como referência
  };
  const target = { minutes: 35, watch: 150, like: 60, follow: 20, profile: 4, search: 0, caps: { watch: 150, like: 60 } };
  const r = custom.rampPlan(target, daily, '2026-10-03', 'tiktok');
  assert.equal(r.limited, true);
  assert.equal(r.plan.watch, 100);
  assert.equal(r.plan.like, 38);
  assert.equal(r.plan.follow, 10);
  assert.equal(r.plan.profile, 4, 'descer é na hora');
  assert.equal(r.plan.search, 0);
  assert.equal(r.plan.minutes, 35, 'minutos não entram na transição');
  assert.deepEqual(r.plan.caps, { watch: 100, like: 38, follow: 10, profile: 4, search: 0 }, 'teto = o plano do dia');
  // Meta que estava zerada começa em 1
  const z = custom.rampPlan({ follow: 5 }, { '2026-10-01': { sessions: 1 } }, '2026-10-02', 'instagram');
  assert.equal(z.plan.follow, 1);
  // Sem dia com sessão nos últimos 7 (conta nova ou parada): nada a segurar
  assert.equal(custom.rampPlan(target, {}, '2026-10-03', 'tiktok').limited, false);
  const old = { '2026-09-01': { sessions: 1, like: 1 } };
  for (let d = 2; d <= 9; d++) old[`2026-09-0${d}`] = { sessions: 0 };
  assert.equal(custom.rampPlan(target, old, '2026-09-10', 'tiktok').limited, false);
  // TikTok: curtida nunca passa dos vídeos do dia
  const t2 = custom.rampPlan({ watch: 100, like: 90 }, { a: { sessions: 1, watch: 10, like: 50 } }, 'b', 'tiktok');
  assert.ok(t2.plan.like <= t2.plan.watch, JSON.stringify(t2.plan));
});

test('transição: acaba no primeiro dia em que nada precisou ser segurado', () => {
  const a = { platform: 'tiktok', goalRamp: '2026-10-01', daily: { '2026-10-01': { sessions: 1, watch: 50, like: 20 } } };
  const held = custom.withRamp(a, { watch: 80, like: 22 }, '2026-10-02');
  assert.equal(held.watch, 63);
  assert.equal(a.goalRamp, '2026-10-01', 'ainda em transição');
  const free = custom.withRamp(a, { watch: 55, like: 22 }, '2026-10-02');
  assert.deepEqual(free, { watch: 55, like: 22 });
  assert.equal(a.goalRamp, undefined, 'transição não acabou');
  // Sem transição: o plano passa direto
  assert.deepEqual(custom.withRamp({ platform: 'tiktok', daily: {} }, { like: 99 }, 'x'), { like: 99 });
});

test('combinações impossíveis são recusadas pelo motor (o dia nunca fecharia)', () => {
  const bad = (platform, phases, re) => assert.throws(() => tpl(platform, { phases }), re);
  bad('tiktok', [{ watch: 10, like: 11 }], /Fase 1: mais curtidas \(11\) que vídeos assistidos \(10\)/);
  bad(
    'tiktok',
    [{}, {}, { watch: 5, like: 5, profile: 2, follow: 8 }],
    /Fase 3: mais follows \(8\) que vídeos assistidos \+ perfis visitados \(7\)/,
  );
  bad('instagram', [{}, { follow: 3, explore: 0 }], /Fase 2: follows precisam de pelo menos 1 em Explorar/);
  // No limite, passa
  assert.equal(tpl('tiktok', { phases: [{ watch: 10, like: 10, follow: 0 }] }).phases[0].like, 10);
  assert.equal(tpl('instagram', { phases: [{ follow: 2, explore: 1 }] }).phases[0].follow, 2);
  // A meta recomendada inteira é possível (o padrão do editor)
  assert.doesNotThrow(() => tpl('tiktok'));
  assert.doesNotThrow(() => tpl('instagram'));
});

test('histórico: o que mudou ao editar um modelo, em texto', () => {
  const a = tpl('tiktok', { name: 'Rápida', readyDay: 22 });
  const b = { ...a, name: 'Rápida 2', readyDay: 15, vary: false, phases: a.phases.map((p, i) => (i === 2 ? { ...p, like: 30 } : p)) };
  const d = custom.diffTemplate(a, b, tt.actions);
  assert.deepEqual(d, [
    'nome de "Rápida" para "Rápida 2"',
    'prazo de 22 para 15 dias',
    'números exatos (sem variar)',
    'curtidas fase 3 de 20 para 30',
  ]);
  assert.deepEqual(custom.diffTemplate(a, { ...a, updatedAt: 'outra' }, tt.actions), [], 'só a data mudou');
  assert.deepEqual(custom.diffTemplate(null, a), []);
  assert.match(a.updatedAt, /^\d{4}-\d\d-\d\dT/);
});

// Confere, dia a dia, que nada passa do teto e que cada plano da troca até alcançar a meta nova (target) respeita o
// passo da transição
function checkRamp(r, from, label, target = null) {
  const dates = Object.keys(r.daily).sort();
  let reached = !target;
  dates.forEach((date, i) => {
    const d = r.daily[date];
    if (!d.plan) return;
    for (const k of Object.keys(d.plan))
      if (k !== 'minutes' && k !== 'caps')
        assert.ok((d[k] || 0) <= rules.limitOf(d.plan, k), `${label} ${date}: ${k} ${d[k]} passou do teto ${rules.limitOf(d.plan, k)}`);
    if (i + 1 < from || reached) return;
    if (JSON.stringify(nums(d.plan)) === JSON.stringify(target)) {
      reached = true;
      return;
    }
    const ref = custom.lastDone(r.daily, date);
    for (const [k, v] of Object.entries(d.plan)) {
      if (k === 'minutes' || k === 'caps' || !ref) continue;
      assert.ok(v <= step(ref[k]), `${label} dia ${i + 1}: ${k} ${v} subiu mais que 25% sobre ${ref[k] || 0}`);
    }
  });
  return reached;
}

test('simulador: TikTok na recomendada até o dia 17 e troca para um modelo de 15 dias: sobe aos poucos até a meta nova', async () => {
  const template = tpl('tiktok', {
    readyDay: 15,
    vary: false,
    phases: [{}, {}, {}, {}, { minutes: 40, watch: 150, like: 60, follow: 20, profile: 10, search: 4 }],
  });
  for (const seed of [1, 2]) {
    const r = await simulate({
      account: { platform: 'tiktok', username: 't', interests: ['skate'], switchAt: { day: 18, template } },
      days: 26,
      seed,
    });
    const dates = Object.keys(r.daily).sort();
    assert.ok(checkRamp(r, 18, `s${seed}`, template.phases[4]), `s${seed}: não chegou na meta nova`);
    // No dia da troca já segurou (a recomendada fazia ~30 curtidas, o modelo quer 60)
    const sw = r.daily[dates[17]].plan;
    assert.ok(sw.like < 60 && sw.watch < 150, `dia 18 pulou direto: ${JSON.stringify(sw)}`);
    // E chegou na meta nova antes do fim
    const last = r.daily[dates[25]].plan;
    assert.deepEqual(nums(last), template.phases[4], `s${seed}: não chegou na meta nova: ${JSON.stringify(last)}`);
    assert.equal(r.account.goalRamp, undefined);
  }
});

test('simulador: Instagram troca para um modelo de 60 dias no dia 18: cai na fase do prazo novo na hora, sem passar do escrito', async () => {
  const template = tpl('instagram', { readyDay: 60, vary: false });
  const r = await simulate({
    account: { platform: 'instagram', username: 'i', interests: ['receitas'], switchAt: { day: 18, template } },
    days: 21,
    seed: 3,
  });
  checkRamp(r, 18, 'ig');
  const dates = Object.keys(r.daily).sort();
  for (let day = 18; day <= 21; day++) {
    const plan = r.daily[dates[day - 1]].plan;
    const written = template.phases[phaseIndex(day, 60)];
    assert.deepEqual(nums(plan), written, `dia ${day}: ${JSON.stringify(plan)}`);
    for (const k of Object.keys(written))
      if (k !== 'minutes') assert.ok((r.daily[dates[day - 1]][k] || 0) <= written[k], `dia ${day}: ${k} passou do escrito`);
  }
});

test('simulador: modelo com números pequenos (1 e 2) não varia e nunca passa deles', async () => {
  const template = tpl('instagram', {
    readyDay: 10,
    phases: [
      { minutes: 6, like: 1, follow: 0, story: 2, reel: 2, explore: 0 },
      { minutes: 6, like: 2, follow: 1, story: 2, reel: 2, explore: 1 },
      {},
      {},
      {},
    ],
  });
  for (const seed of [4, 5]) {
    const r = await simulate({ account: { platform: 'instagram', username: 'p', interests: ['IA'], template }, days: 4, seed });
    Object.keys(r.daily)
      .sort()
      .forEach((date, i) => {
        const d = r.daily[date];
        if (!d.plan) return;
        const written = template.phases[phaseIndex(i + 1, 10)];
        for (const k of Object.keys(written)) {
          if (k === 'minutes') continue;
          const v = d.plan[k];
          if (written[k] <= 2) assert.equal(v, written[k], `dia ${i + 1}: ${k} ${written[k]} variou para ${v}`);
          else assert.ok(v <= written[k] && v >= written[k] - Math.max(1, Math.round(written[k] * 0.1)), `dia ${i + 1}: ${k} ${v}`);
        }
        for (const k of Object.keys(written)) if (k !== 'minutes') assert.ok((d[k] || 0) <= written[k], `dia ${i + 1}: ${k} ${d[k]}`);
      });
  }
});

test('simulador: TikTok com números exatos e pequenos fecha o dia inteiro (busca incluída, sem passar dos vídeos)', async () => {
  const small = { minutes: 8, watch: 8, like: 2, follow: 1, profile: 1, search: 1 };
  const template = tpl('tiktok', { readyDay: 22, vary: false, phases: [small, small, small, small, small] });
  for (let seed = 1; seed <= 8; seed++) {
    const r = await simulate({ account: { platform: 'tiktok', username: 't', interests: ['skate'], template }, days: 2, seed });
    for (const [date, d] of Object.entries(r.daily)) {
      if (!d.plan) continue;
      for (const k of Object.keys(small)) {
        if (k === 'minutes') continue;
        assert.ok((d[k] || 0) <= small[k], `s${seed} ${date}: ${k} ${d[k]} passou de ${small[k]}`);
      }
      assert.equal(rules.completion(d.plan, d), 1, `s${seed} ${date}: dia não fechou: ${JSON.stringify(d)}`);
    }
  }
});

// Bateria: metas personalizadas de vários tamanhos (exatas e variando) nas duas redes fecham o dia inteiro sem passar do
// número escrito. Cobre as reservas do TikTok (busca e follow disputando os últimos vídeos) e o Explorar do Instagram
// (de onde saem os follows) com teto exato de visitas.
test('simulador: metas personalizadas pequenas, médias e grandes fecham o dia nas duas redes sem passar do escrito', async () => {
  const sets = {
    tiktok: [
      { minutes: 6, watch: 5, like: 5, follow: 2, profile: 0, search: 1 },
      { minutes: 10, watch: 12, like: 6, follow: 3, profile: 1, search: 2 },
      { minutes: 20, watch: 60, like: 30, follow: 10, profile: 3, search: 3 },
      { minutes: 9, watch: 10, like: 10, follow: 10, profile: 0, search: 0 },
    ],
    instagram: [
      { minutes: 8, like: 5, follow: 2, story: 3, reel: 3, explore: 1 },
      { minutes: 20, like: 25, follow: 10, story: 10, reel: 12, explore: 3 },
      { minutes: 6, like: 1, follow: 1, story: 0, reel: 0, explore: 1 },
    ],
  };
  for (const [platform, list] of Object.entries(sets))
    for (const c of list)
      for (const vary of [false, true]) {
        const template = tpl(platform, { vary, phases: [c, c, c, c, c] });
        for (let seed = 1; seed <= 6; seed++) {
          const r = await simulate({ account: { platform, username: 't', interests: ['skate'], template }, days: 2, seed });
          for (const [date, d] of Object.entries(r.daily)) {
            if (!d.plan) continue;
            const label = `${platform} ${JSON.stringify(c)}${vary ? ' variando' : ''} s${seed} ${date}`;
            for (const k of Object.keys(c)) if (k !== 'minutes') assert.ok((d[k] || 0) <= c[k], `${label}: ${k} ${d[k]} passou de ${c[k]}`);
            assert.equal(rules.completion(d.plan, d), 1, `${label}: dia não fechou ${JSON.stringify(d)}`);
          }
        }
      }
});
