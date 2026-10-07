// Comportamento humano (motor/human.js) e simulador. Nenhum teste abre o TikTok ou o Instagram.
const test = require('node:test');
const assert = require('node:assert/strict');
const human = require('../motor/human');
const rules = require('../motor/rules');
const { simulate } = require('../motor/sim/simulate');

const sample = (n, fn) => Array.from({ length: n }, fn).sort((a, b) => a - b);
const pct = (s, p) => s[Math.floor((p / 100) * (s.length - 1))];
const mean = (s) => s.reduce((a, b) => a + b, 0) / s.length;

test('sorteio com semente repete a mesma sequência', () => {
  const a = human.makeRng(42);
  const b = human.makeRng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(human.makeRng(1)(), human.makeRng(2)());
});

test('pausas têm cauda longa: a maioria curta, às vezes bem longa', () => {
  const rng = human.makeRng(7);
  for (const kind of ['between', 'read', 'decide']) {
    const k = human.PAUSES[kind];
    const s = sample(5000, () => human.pause(kind, { rng }));
    const p50 = pct(s, 50);
    assert.ok(Math.abs(p50 - k.median) / k.median < 0.15, `${kind}: mediana ${p50} longe de ${k.median}`);
    assert.ok(mean(s) > p50, `${kind}: média deveria passar da mediana (cauda para cima)`);
    assert.ok(pct(s, 99) / p50 > 2.5, `${kind}: cauda curta demais`);
    assert.ok(s[0] >= k.min && s[s.length - 1] <= k.max, `${kind}: fora dos limites`);
  }
});

test('nenhuma pausa se repete em intervalo fixo e os limites não acumulam valores', () => {
  const rng = human.makeRng(3);
  const s = sample(3000, () => human.pause('next', { rng }));
  const k = human.PAUSES.next;
  const atEdges = s.filter((v) => v === Math.round(k.min) || v === Math.round(k.max)).length;
  assert.ok(atEdges / s.length < 0.01, 'valores demais empilhados no limite');
  assert.ok(new Set(s).size > s.length * 0.4, 'valores repetidos demais');
});

test('espera genérica: cauda longa em volta do intervalo antigo; min = max espera o valor exato', () => {
  const rng = human.makeRng(11);
  const s = sample(4000, () => human.span(1000, 3000, rng));
  const inside = s.filter((v) => v >= 1000 && v <= 3000).length / s.length;
  assert.ok(inside > 0.8 && inside < 0.99, `dentro do intervalo: ${inside}`);
  assert.ok(s[s.length - 1] > 3000, 'deveria passar do máximo de vez em quando');
  assert.equal(human.span(2500, 2500, rng), 2500);
});

test('personalidade: cada conta é diferente, sempre igual a si mesma, e varia pouco por dia', () => {
  const ps = Array.from({ length: 30 }, (_, i) => human.makePersona(1000 + i));
  assert.equal(new Set(ps.map((p) => JSON.stringify({ ...p, seed: 0 }))).size, 30);
  assert.deepEqual(human.makePersona(77), human.makePersona(77));
  for (const p of ps) {
    assert.ok(p.readSpeed >= 0.8 && p.readSpeed <= 1.3);
    assert.ok(p.patience >= 0.75 && p.patience <= 1.3);
    assert.ok(p.peak >= 8 && p.peak <= 23);
  }
  const m1 = human.dayMood(ps[0], '2026-10-08');
  assert.deepEqual(m1, human.dayMood(ps[0], '2026-10-08'));
  assert.notDeepEqual(m1, human.dayMood(ps[0], '2026-10-09'));
  for (const v of Object.values(m1)) assert.ok(v >= 0.92 && v <= 1.08);
  // Paciência muda o tempo de leitura de verdade
  const slow = { ...ps[0], readSpeed: 1.3 };
  const fast = { ...ps[0], readSpeed: 0.8 };
  const rng = human.makeRng(5);
  const a = mean(sample(2000, () => human.pause('read', { rng, persona: slow })));
  const b = mean(sample(2000, () => human.pause('read', { rng, persona: fast })));
  assert.ok(a > b * 1.4);
});

test('vídeo: nicho pula menos; fora do nicho pula mais; vídeo longo não se repete', () => {
  const rng = human.makeRng(9);
  const share = (niche, outcome) => {
    let n = 0;
    for (let i = 0; i < 3000; i++) if (human.watchPlan(30, { niche, rng }).outcome === outcome) n++;
    return n / 3000;
  };
  assert.ok(share(false, 'skip') > share(true, 'skip') * 3);
  assert.ok(share(true, 'full') + share(true, 'loop') > 0.55);
  for (let i = 0; i < 500; i++) {
    const w = human.watchPlan(120, { rng });
    assert.notEqual(w.outcome, 'loop');
    if (w.outcome === 'skip') assert.ok(w.ms <= 7000);
    assert.ok(w.ms <= 180000);
  }
  // Tempo assistido acompanha a duração do vídeo
  const full = human.watchPlan(40, { rng: () => 0.99 });
  assert.equal(full.duration, 40);
});

test('curtir: meta batida é chance zero, mesmo no nicho', () => {
  assert.equal(human.likeProbability(0, { niche: true }), 0);
  assert.equal(human.likeProbability(0.2, { niche: true }), 0.6);
  assert.equal(human.likeProbability(0.9), 0.75);
  assert.equal(human.likeProbability(0.4, { persona: { likeBias: 0.5 } }), 0.2);
});

test('rolagem com inércia: passos variados, total certo e às vezes passa do ponto e volta', () => {
  const rng = human.makeRng(21);
  let overshoots = 0;
  for (let i = 0; i < 300; i++) {
    const steps = human.scrollSteps(800, { rng });
    const down = steps.filter((s) => s.dy > 0).reduce((a, s) => a + s.dy, 0);
    assert.equal(down, 800);
    if (steps.some((s) => s.dy < 0)) overshoots++;
    const sizes = steps.filter((s) => s.dy > 0).map((s) => s.dy);
    if (sizes.length > 3) assert.ok(new Set(sizes).size > 2, 'passos todos iguais');
  }
  assert.ok(overshoots > 5 && overshoots < 100, `passou do ponto ${overshoots}x em 300`);
  // Rolar para cima: os passos principais vão para cima e somam o total
  const up = human.scrollSteps(-500, { rng: human.makeRng(2) });
  assert.equal(
    up.filter((s) => s.dy < 0).reduce((a, s) => a + s.dy, 0) + up.filter((s) => s.dy > 0).reduce((a, s) => a + s.dy, 0) <= -450,
    true,
  );
});

// Fim do dia: 'done' (metas batidas) ou 'limit' (o que faltava passaria do teto). Nunca 'pending'.
test('simulador: nenhuma meta passa do teto de 120% e nenhum dia fica com meta possível pendente', async () => {
  for (const platform of ['tiktok', 'instagram']) {
    for (let seed = 1; seed <= 6; seed++) {
      const r = await simulate({ account: { platform, username: 't', interests: ['IA', 'receitas'] }, days: 3, seed });
      assert.ok(r.sessions.length >= 3, `${platform} s${seed}: poucas sessões`);
      for (const [date, d] of Object.entries(r.daily)) {
        if (!d.plan) continue;
        for (const k of Object.keys(d.plan)) {
          if (k === 'minutes') continue;
          assert.ok((d[k] || 0) <= rules.capOf(d.plan[k]), `${platform} s${seed} ${date}: ${k} ${d[k]} > teto de ${d.plan[k]}`);
        }
        const status = rules.dayStatus(require('../motor/platforms')[platform].activities, d.plan, d, { interests: ['IA'] });
        assert.notEqual(status, 'pending', `${platform} s${seed} ${date}: meta possível ficou pendente`);
      }
    }
  }
});

test('simulador: ações não acontecem em intervalos fixos', async () => {
  const r = await simulate({ account: { platform: 'tiktok', username: 't', interests: ['IA'] }, days: 1, seed: 5 });
  const t = r.sessions.flatMap((s) => s.actions.map((a) => a.t));
  const gaps = t.slice(1).map((v, i) => v - t[i]);
  const m = mean(gaps);
  const sd = Math.sqrt(mean(gaps.map((g) => (g - m) ** 2)));
  assert.ok(sd / m > 0.5, `variação baixa demais entre ações: ${(sd / m).toFixed(2)}`);
  assert.ok(new Set(gaps).size > gaps.length * 0.8, 'intervalos repetidos');
});

// ---------- Robô com página e relógio falsos ----------
const { createBot } = require('../motor/bot');
const { createCtl } = require('../motor/ctl');
const { createFakePage, createFakeCursor, createFakeClock } = require('../motor/sim/fakePage');

function fakeBot(seed = 1) {
  const clock = createFakeClock(Date.parse('2026-10-08T12:00:00-03:00'));
  const state = {
    stop: false,
    stats: {},
    startedAt: clock.now(),
    endsAt: clock.now() + 3600000,
    lastProgress: clock.now(),
    lastBeat: clock.now(),
  };
  const ctl = createCtl({
    state,
    plan: { like: 5 },
    done: () => ({}),
    now: clock.now,
    hooks: { status() {}, action() {}, log() {}, alert() {} },
  });
  const rng = human.makeRng(seed);
  const page = createFakePage({ rng });
  const bot = createBot(page, ctl, { rng, clock, cursor: createFakeCursor(page), persona: human.makePersona(seed) });
  return { bot, clock, page, state };
}

test('curtida acontece no meio do vídeo, em momentos diferentes', async () => {
  const fractions = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { bot, clock } = fakeBot(seed);
    const start = clock.now();
    let at = null;
    await bot.watchWithLike(20000, 'vídeo', async () => {
      at = clock.now() - start;
      return true;
    });
    assert.ok(clock.now() - start >= 19000, 'deveria terminar de assistir depois de curtir');
    fractions.push(at / 20000);
  }
  assert.ok(Math.min(...fractions) >= 0.3 && Math.max(...fractions) <= 0.95);
  assert.ok(new Set(fractions.map((f) => f.toFixed(2))).size > 25, 'curtidas sempre no mesmo segundo');
});

test('esperas longas mexem o mouse; troca de aba volta para a aba da sessão', async () => {
  const { bot, page } = fakeBot(3);
  await bot.watch(40000, 'vídeo longo');
  assert.ok(page.events.filter((e) => e.type === 'move').length >= 2, 'mouse parado durante 40 s');
  await bot.awayTab(20000);
  const tabs = page.events.filter((e) => e.type === 'tab');
  assert.deepEqual(
    tabs.map((e) => e.open),
    [false, true],
  );
});

test('duração real do vídeo muda o tempo assistido', async () => {
  const { bot } = fakeBot(4);
  const info = await bot.videoInfo();
  assert.ok(info.duration >= 6 && info.duration <= 90);
  const short = human.watchPlan(8, { rng: () => 0.99 });
  const long = human.watchPlan(60, { rng: () => 0.99 });
  assert.ok(long.ms > short.ms * 4);
});

test('resumo dos tempos da sessão: percentis e histograma por faixa', () => {
  const t = human.timingSummary([300, 800, 1500, 1500, 3000, 70000, 200000]);
  assert.equal(t.n, 7);
  assert.equal(t.p50, 1500);
  assert.equal(t.max, 200000);
  assert.deepEqual(t.hist, [1, 1, 2, 1, 0, 0, 0, 0, 1, 1]); // <0,5 s · <1 s · <2 s · <4 s ... · 1–2 min · >2 min
  assert.equal(human.timingSummary([]).n, 0);
});
