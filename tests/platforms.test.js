const test = require('node:test');
const assert = require('node:assert/strict');
const platforms = require('../motor/platforms');
const { phaseIndex, phaseFor, READY_DAY } = require('../motor/platforms/phases');

test('fases cobrem todos os dias e a conta fica pronta no dia 22', () => {
  assert.equal(phaseFor(1).n, 1);
  assert.equal(phaseFor(3).n, 1);
  assert.equal(phaseFor(4).n, 2);
  assert.equal(phaseFor(21).n, 4);
  assert.equal(phaseFor(READY_DAY).n, 5);
  assert.equal(phaseFor(400).n, 5);
});

for (const p of Object.values(platforms)) {
  test(`${p.name}: o plano sorteado fica perto do plano base da fase`, () => {
    for (let round = 0; round < 50; round++) {
      for (let day = 1; day <= 30; day++) {
        const plan = p.planForDay(day);
        const base = p.plans[phaseIndex(day)];
        for (const k of Object.keys(base)) assert.ok(Math.abs(plan[k] - base[k]) <= 5, `${k} no dia ${day}: ${plan[k]} x ${base[k]}`);
      }
    }
  });

  test(`${p.name}: fase sem follow nunca sorteia follow`, () => {
    for (let round = 0; round < 200; round++) {
      for (let day = 1; day <= 30; day++) {
        if (p.plans[phaseIndex(day)].follow === 0) assert.equal(p.planForDay(day).follow, 0, `dia ${day}`);
      }
    }
  });

  test(`${p.name}: as atividades só citam metas que existem no plano`, () => {
    const keys = Object.keys(p.plans[0]);
    for (const [name, a] of Object.entries(p.activities)) {
      for (const k of [...a.produces, ...a.advances]) assert.ok(keys.includes(k), `${name}: ${k}`);
    }
  });

  test(`${p.name}: tem endereços de login e da página inicial`, () => {
    assert.match(p.loginUrl, /^https:\/\//);
    assert.match(p.homeUrl, /^https:\/\//);
  });
}
