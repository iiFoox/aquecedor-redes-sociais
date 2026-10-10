// Meta personalizada (modelos): conferência dos modelos, fases ajustadas ao prazo, plano do dia e o simulador rodando
// dias inteiros com metas personalizadas (teto de 120%, dia que fecha a meta, Instagram sem passar do plano).
const test = require('node:test');
const assert = require('node:assert/strict');
const custom = require('../motor/custom');
const rules = require('../motor/rules');
const human = require('../motor/human');
const platforms = require('../motor/platforms');
const { phasesFor, phaseFor, phaseIndex, PHASES } = require('../motor/platforms/phases');
const { simulate } = require('../motor/sim/simulate');

const tt = platforms.tiktok;
const ig = platforms.instagram;
const tpl = (platform, over = {}) =>
  custom.normalizeTemplate({ name: 'Teste', platform, readyDay: 22, ...over }, platforms[platform].plans, platforms[platform].actions);

test('fases: a recomendada não muda; outro prazo estica ou encurta as 5 fases na mesma ordem, cada uma com 1 dia ou mais', () => {
  assert.equal(phasesFor(22), PHASES);
  assert.equal(phasesFor(undefined), PHASES);
  for (let d = 5; d <= 90; d++) {
    const ph = phasesFor(d);
    assert.equal(ph.length, 5);
    assert.equal(ph[0].from, 1);
    assert.equal(ph[4].from, d, `prazo ${d}: pronta no dia ${ph[4].from}`);
    for (let i = 0; i < 4; i++) {
      assert.ok(ph[i].to >= ph[i].from, `prazo ${d}: fase ${i + 1} vazia`);
      assert.equal(ph[i + 1].from, ph[i].to + 1, `prazo ${d}: buraco entre as fases ${i + 1} e ${i + 2}`);
    }
    // Todo dia cai numa fase, e a ordem nunca volta
    let last = 0;
    for (let day = 1; day <= d + 3; day++) {
      const idx = phaseIndex(day, d);
      assert.ok(idx >= last && idx <= 4);
      last = idx;
    }
  }
  assert.equal(phaseFor(15, 15).n, 5);
  assert.equal(phaseFor(14, 15).n, 4);
});

test('modelo: campo que falta fica com o recomendado; chave estranha sai; limites e nome conferidos', () => {
  const t = custom.normalizeTemplate(
    { name: '  Rápida  ', platform: 'tiktok', readyDay: 15, phases: [{ like: 6, hack: 99 }, {}, {}, {}, { follow: 20 }] },
    tt.plans,
    tt.actions,
  );
  assert.equal(t.name, 'Rápida');
  assert.equal(t.readyDay, 15);
  assert.equal(t.vary, true);
  assert.equal(t.phases.length, 5);
  assert.deepEqual(Object.keys(t.phases[0]).sort(), Object.keys(tt.plans[0]).sort(), 'chave que não existe no TikTok entrou');
  assert.equal(t.phases[0].like, 6);
  assert.equal(t.phases[0].watch, tt.plans[0].watch, 'campo que faltou não ficou com o recomendado');
  assert.equal(t.phases[4].follow, 20);
  assert.match(t.id, /^[\w-]{6,40}$/);
  // Mesmo id ao editar
  assert.equal(custom.normalizeTemplate({ ...t, name: 'Outra' }, tt.plans).id, t.id);
  const bad = (over, re) =>
    assert.throws(() => custom.normalizeTemplate({ name: 'x', platform: 'tiktok', ...over }, tt.plans, tt.actions), re);
  bad({ name: '' }, /nome/i);
  bad({ name: 'x'.repeat(41) }, /40/);
  bad({ readyDay: 3 }, /entre 5 e 90/);
  bad({ readyDay: 91 }, /entre 5 e 90/);
  bad({ readyDay: 10.5 }, /inteiro/);
  bad({ phases: [{ like: 301 }] }, /Fase 1, Curtidas: entre 0 e 300/);
  bad({ phases: [{}, { follow: -1 }] }, /Fase 2, Follows/);
  bad({ phases: [{ minutes: 2 }] }, /entre 3 e 180/);
  bad({ phases: [{ like: 'muito' }] }, /inteiro/);
  // Instagram tem as chaves dele
  const i = tpl('instagram', { phases: [{ reel: 9 }] });
  assert.deepEqual(Object.keys(i.phases[0]).sort(), Object.keys(ig.plans[0]).sort());
  assert.equal(i.phases[0].reel, 9);
});

test('plano do dia do modelo: o número escrito é o MÁXIMO (variação só desce, até 2 não varia) e é o teto do dia', () => {
  const base = { minutes: 20, watch: 100, like: 30, follow: 0, profile: 1, search: 2 };
  const t = { readyDay: 22, vary: false, phases: [base, base, base, base, base] };
  const exact = custom.planFrom(t, 2);
  const { caps, ...nums } = exact;
  assert.deepEqual(nums, base);
  assert.deepEqual(caps, { watch: 100, like: 30, follow: 0, profile: 1, search: 2 }, 'teto = o número escrito (sem minutos)');
  const v = { ...t, vary: true };
  const rng = human.makeRng(9);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const p = custom.planFrom(v, 0, rng);
    assert.ok(p.watch >= 90 && p.watch <= 100, `vídeos ${p.watch}`);
    assert.ok(p.like >= 27 && p.like <= 30, `curtidas ${p.like}`);
    assert.equal(p.follow, 0, 'follow zerado virou follow');
    assert.equal(p.profile, 1, '1 perfil variou');
    assert.equal(p.search, 2, '2 buscas variaram');
    assert.ok(p.minutes >= 18 && p.minutes <= 20, `minutos ${p.minutes}`);
    assert.equal(p.caps.like, 30);
    seen.add(p.like);
  }
  assert.ok(seen.size >= 3, 'não variou');
  // Números pequenos: 3 a 5 só descem 1
  const small = { readyDay: 22, vary: true, phases: Array(5).fill({ minutes: 10, watch: 5, like: 3, follow: 4, profile: 0, search: 0 }) };
  for (let i = 0; i < 200; i++) {
    const p = custom.planFrom(small, 0, rng);
    assert.ok([4, 5].includes(p.watch) && [2, 3].includes(p.like) && [3, 4].includes(p.follow), JSON.stringify(p));
  }
});

test('teto do dia: recomendada 120%; meta personalizada no máximo o número escrito', () => {
  assert.equal(rules.limitOf({ like: 10 }, 'like'), 12);
  assert.equal(rules.limitOf({ like: 9, caps: { like: 10 } }, 'like'), 10, 'variou para 9: teto é o 10 escrito, não 11');
  assert.equal(rules.limitOf({ like: 10, caps: { like: 10 } }, 'like'), 10);
  assert.equal(rules.limitOf({ follow: 0, caps: { follow: 0 } }, 'follow'), 0);
  const plan = { like: 10, follow: 5, caps: { like: 10, follow: 5 } };
  assert.equal(rules.limitOf(plan, 'follow'), 5);
  assert.equal(rules.isCapped(plan, { like: 10 }, 'like'), true);
  assert.equal(rules.isCapped(plan, { like: 9 }, 'like'), false);
  // O objeto de tetos não vira meta
  assert.equal(rules.completion({ like: 2, caps: { like: 2 } }, { like: 2 }), 1);
  assert.equal(rules.missingText({ like: 2, caps: { like: 2 } }, { like: 1 }), '1 like');
});

test('plano do dia: com modelo usa a fase do prazo do modelo; sem modelo, a recomendada de sempre', () => {
  const phases = [1, 2, 3, 4, 5].map((n) => ({ ...tt.plans[0], like: n * 100 }));
  const t = { readyDay: 8, vary: false, phases };
  // Prazo de 8 dias: fases 1 | 2 | 3-5 | 6-7 | 8+
  assert.equal(tt.planForDay(1, Math.random, t).like, 100);
  assert.equal(tt.planForDay(2, Math.random, t).like, 200);
  assert.equal(tt.planForDay(4, Math.random, t).like, 300);
  assert.equal(tt.planForDay(7, Math.random, t).like, 400);
  assert.equal(tt.planForDay(30, Math.random, t).like, 500);
  // Sem modelo: dia 4 é fase 2 da recomendada
  const rec = tt.planForDay(4, human.makeRng(1));
  assert.ok(Math.abs(rec.like - tt.plans[1].like) <= 2);
});

// O simulador roda o código real das plataformas com a meta do modelo, dia após dia
const checkDays = (r, platform, exact) => {
  const acts = platforms[platform].activities;
  for (const [date, d] of Object.entries(r.daily)) {
    if (!d.plan) continue;
    for (const k of Object.keys(d.plan)) {
      if (k === 'minutes') continue;
      if (k === 'caps') continue;
      const lim = exact ? d.plan[k] : rules.limitOf(d.plan, k);
      assert.ok((d[k] || 0) <= lim, `${platform} ${date}: ${k} ${d[k]} passou de ${lim} (plano ${d.plan[k]})`);
    }
    assert.notEqual(
      rules.dayStatus(acts, d.plan, d, { interests: ['IA'] }),
      'pending',
      `${platform} ${date}: meta possível ficou pendente`,
    );
  }
};

test('simulador: modelos personalizados (pequeno, grande, prazo curto) fecham o dia sem passar do teto', async () => {
  const configs = [
    ['tiktok', { readyDay: 8, phases: [{ watch: 15, like: 2 }, { watch: 30, like: 6, follow: 1 }, {}, {}, {}] }],
    ['tiktok', { readyDay: 30, vary: false, phases: [{}, {}, { watch: 150, like: 60, follow: 10, profile: 8, search: 4 }, {}, {}] }],
    ['instagram', { readyDay: 6, phases: [{ like: 0, story: 2, reel: 2 }, { like: 5, reel: 8 }, {}, {}, {}] }],
    ['instagram', { readyDay: 40, vary: false, phases: [{ like: 20, story: 12, reel: 25, explore: 2 }, {}, {}, {}, {}] }],
  ];
  for (const [platform, over] of configs) {
    const template = tpl(platform, over);
    for (let seed = 1; seed <= 3; seed++) {
      const r = await simulate({ account: { platform, username: 't', interests: ['IA', 'receitas'], template }, days: 3, seed });
      assert.ok(r.sessions.length >= 2, `${platform} s${seed}: poucas sessões`);
      checkDays(r, platform, platform === 'instagram');
      // O plano de cada dia veio do modelo (fase do dia pelo prazo do modelo)
      const first = Object.values(r.daily).find((d) => d.plan);
      const base = template.phases[phaseIndex(1, template.readyDay)];
      for (const k of Object.keys(base)) {
        if (k === 'minutes') continue;
        const d = template.vary && base[k] > 2 ? Math.max(1, Math.round(base[k] * 0.1)) : 0;
        assert.ok(
          first.plan[k] <= base[k] && first.plan[k] >= base[k] - d,
          `${platform}: ${k} do dia 1 = ${first.plan[k]}, modelo ${base[k]}`,
        );
      }
      // Nenhum dia passa do número escrito no modelo para a fase do dia
      for (const [date, d] of Object.entries(r.daily)) {
        if (!d.plan) continue;
        const day = Object.keys(r.daily).sort().indexOf(date) + 1;
        const written = template.phases[phaseIndex(day, template.readyDay)];
        for (const k of Object.keys(written))
          if (k !== 'minutes') assert.ok((d[k] || 0) <= written[k], `${platform} ${date}: ${k} ${d[k]} passou do escrito ${written[k]}`);
      }
    }
  }
});

test('simulador: meta zerada no modelo nunca é feita (ex.: nenhum follow e nenhuma curtida na fase 1)', async () => {
  const template = tpl('tiktok', { readyDay: 22, phases: [{ like: 0, follow: 0, profile: 0, search: 0 }, {}, {}, {}, {}] });
  for (let seed = 1; seed <= 3; seed++) {
    const r = await simulate({ account: { platform: 'tiktok', username: 't', interests: ['IA'], template }, days: 2, seed });
    for (const d of Object.values(r.daily)) {
      assert.equal(d.like || 0, 0, 'curtiu com meta zerada');
      assert.equal(d.follow || 0, 0, 'seguiu com meta zerada');
    }
  }
});
