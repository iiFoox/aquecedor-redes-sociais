// Simulador: roda o motor de decisões de verdade (regras, agendador e o código das plataformas)
// com relógio falso e página falsa. Gera a linha do tempo das sessões e ações, sem abrir navegador.
const rules = require('../rules');
const human = require('../human');
const platforms = require('../platforms');
const { createBot } = require('../bot');
const { createCtl } = require('../ctl');
const { createFakePage, createFakeCursor, createFakeClock } = require('./fakePage');

const DAY = 86400000;

// Meia-noite (no fuso do app) do dia de `ms`
function startOfDay(ms) {
  return ms - rules.localMinutes(new Date(ms)) * 60000 - (new Date(ms).getSeconds() * 1000 + new Date(ms).getMilliseconds());
}

// Uma sessão simulada: mesmo ctl e mesmo bot da sessão real, mas com página e relógio falsos
async function simulateSession({ account, platform, plan, today, clock, rng, target = 1 }) {
  const start = clock.now();
  const state = {
    stop: false,
    stats: {},
    startedAt: start,
    endsAt: start + rules.sessionCap(plan) * 60000,
    lastProgress: start,
    lastBeat: start,
  };
  const actions = [];
  const ctl = createCtl({
    state,
    plan,
    target,
    done: () => today,
    now: clock.now,
    hooks: {
      status() {},
      action(type, detail) {
        today[type] = (today[type] || 0) + 1;
        actions.push({ t: clock.now(), type, detail });
      },
      log() {},
      alert() {},
    },
  });
  const page = createFakePage({ rng, interests: account.interests || [] });
  const bot = createBot(page, ctl, {
    persona: account.persona,
    mood: human.dayMood(account.persona, rules.localDate(new Date(start))),
    rng,
    clock,
    cursor: createFakeCursor(page),
  });
  let reason;
  try {
    reason = await platform.run({ page, bot, ctl, plan, account });
  } catch (e) {
    reason = `erro: ${e.message}`;
  }
  return {
    start,
    end: clock.now(),
    reason,
    actions,
    samples: state.samples,
    wheel: page.events.filter((e) => e.type === 'wheel').map((e) => e.dy),
  };
}

/**
 * Simula `days` dias de uma conta a partir de `from` (ms). config: janela e piloto (active é forçado).
 * O plano de cada dia é sorteado como no motor; as metas seguem o teto de 120%.
 */
async function simulate({ account, days = 3, from = startOfDay(Date.now() + DAY), config = {}, seed = 1 }) {
  const rng = human.makeRng(seed);
  const platform = platforms[account.platform];
  const acc = {
    ...account,
    persona: account.persona || human.makePersona(seed),
    startedAt: account.startedAt || new Date(from).toISOString(),
    interests: account.interests || [],
    daily: {},
    history: [],
    attention: null,
    nextAfter: null,
  };
  const cfg = { start: '08:00', end: '22:00', ...config, active: true, max: 1, pausedUntil: null };
  const clock = createFakeClock(from);
  const end = from + days * DAY;
  const sessions = [];

  while (clock.now() < end) {
    const now = new Date(clock.now());
    const date = rules.localDate(now);
    const today = (acc.daily[date] = acc.daily[date] || {});
    const reason = rules.decide(acc, {
      now,
      config: cfg,
      runningCount: 0,
      running: false,
      browserOpen: false,
      plan: () => rules.ensurePlan(acc.daily, date, rules.dayOf(acc, now), (d) => platform.planForDay(d, rng)).plan,
      today,
      activities: platform.activities,
      // Rotina do dia, igual ao motor: planejada na primeira olhada dentro da janela
      slots: () =>
        rules.ensureSlots(acc.daily, date, () =>
          rules.planSlots({
            date,
            window: rules.windowOf(acc, cfg),
            persona: acc.persona,
            planMinutes: today.plan.minutes,
            rng,
            notBefore: now.getTime(),
          }),
        ).slots,
    });
    if (reason !== 'iniciar') {
      clock.advance(60000); // o agendador olha de minuto em minuto
      continue;
    }
    clock.advance(Math.floor(rng() * 15000)); // atraso de 0 a 15 s antes de abrir
    const plan = today.plan;
    const slot = (today.slots || [])[today.sessions || 0];
    const s = await simulateSession({ account: acc, platform, plan, today, clock, rng, target: slot ? slot.target : 1 });
    const minutes = +((s.end - s.start) / 60000).toFixed(1);
    today.sessions = (today.sessions || 0) + 1;
    today.minutes = +((today.minutes || 0) + minutes).toFixed(1);
    acc.history.push({ date: new Date(s.end).toISOString(), startedAt: new Date(s.start).toISOString(), result: 'ok', minutes });
    acc.nextAfter = rules.nextAfter(s.end, rng);
    sessions.push({
      ...s,
      date,
      day: rules.dayOf(acc, new Date(s.start)),
      plan,
      done: { ...today },
      minutes,
      target: slot ? slot.target : 1,
      completion: rules.completion(plan, today),
    });
    clock.advance(60000);
  }
  return { account: acc, sessions, daily: acc.daily };
}

const summarize = human.timingSummary;

module.exports = { simulate, simulateSession, summarize, startOfDay };
