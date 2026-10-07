// Fase 3: dados que o painel novo usa (histórico por dia, agenda de hoje, checklist).
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../motor/rules');
const { schemas } = require('../motor/validate');
const { CHECKLIST } = require('../motor/platforms/phases');

const at = (s) => new Date(s);

test('histórico por dia: meta batida, dias antes do cadastro e férias', () => {
  const a = {
    startedAt: '2026-10-05T14:00:00Z',
    daily: {
      '2026-10-05': { plan: { minutes: 12, watch: 30, like: 4 }, watch: 30, like: 2, sessions: 2, minutes: 14 },
      '2026-10-06': { vacation: true },
      '2026-10-07': { plan: { minutes: 12, watch: 30, like: 4 }, watch: 15, sessions: 1, minutes: 6 },
    },
  };
  const days = rules.dayHistory(a, 4, at('2026-10-07T20:00:00-03:00'));
  assert.deepEqual(
    days.map((d) => d.date),
    ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
  );
  assert.equal(days[0].completion, null); // antes do cadastro
  assert.equal(days[1].completion, 0.75); // vídeos 100% e curtidas 50%
  assert.equal(days[1].minutes, 14);
  assert.equal(days[2].vacation, true);
  assert.equal(days[2].completion, null);
  assert.equal(days[3].completion, 0.25);
});

test('agenda: só as sessões que terminaram hoje, com início e fim', () => {
  const now = at('2026-10-07T20:00:00-03:00');
  const history = [
    { date: '2026-10-06T23:30:00-03:00', startedAt: '2026-10-06T23:10:00-03:00', result: 'ok', minutes: 20 },
    { date: '2026-10-07T09:20:00-03:00', startedAt: '2026-10-07T09:00:00-03:00', result: 'ok', minutes: 20 },
    { date: '2026-10-07T12:05:00-03:00', result: 'stopped', minutes: 5 }, // sessão antiga sem início gravado
  ];
  const s = rules.sessionsToday(history, now);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { start: Date.parse('2026-10-07T09:00:00-03:00'), end: Date.parse('2026-10-07T09:20:00-03:00'), result: 'ok' });
  assert.equal(s[1].start, Date.parse('2026-10-07T12:00:00-03:00'));
});

test('checklist "conta pronta": só aceita os itens conhecidos', () => {
  const key = CHECKLIST[0].key;
  assert.deepEqual(schemas.accountPatch.parse({ checklist: { [key]: true } }), { checklist: { [key]: true } });
  assert.equal(schemas.accountPatch.safeParse({ checklist: { inventado: true } }).success, false);
  assert.equal(schemas.accountPatch.safeParse({ checklist: { [key]: 'sim' } }).success, false);
});
