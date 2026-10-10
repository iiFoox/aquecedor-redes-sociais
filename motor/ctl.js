// Controle de uma sessão: o que falta, tetos, cansaço do motor e o registro do que aconteceu.
// Usado pela sessão real (runner.js) e pelo simulador (motor/sim), com o mesmo comportamento.
const rules = require('./rules');

const STALL_MS = 10 * 60000; // 10 min sem progresso nas metas = travou
const FAIL_ALERT = 3; // a mesma falha 3 vezes na sessão vira alerta no painel

/**
 * state: estado da sessão ({ stop, stats, startedAt, endsAt, lastProgress, lastBeat, status... })
 * plan: plano do dia. done(): o que já foi feito hoje.
 * now(): relógio (o simulador passa um relógio falso).
 * hooks: { status(text, until), action(type, detail), log(msg, level), alert(level, msg, kind) }
 */
function createCtl({ state, plan, done, now = Date.now, hooks, target = 1 }) {
  const goalKeys = Object.keys(plan).filter((k) => k !== 'minutes' && plan[k] > 0);
  const left = (k) => (plan[k] || 0) - (done()[k] || 0);
  state.samples = state.samples || {};
  const fails = {};
  return {
    stats: state.stats,
    plan,
    goalKeys,
    now,
    shouldStop: () => state.stop,
    timeLeft: () => state.endsAt - now(),
    elapsed: () => now() - state.startedAt,
    left,
    // Meta já no teto de 120% do plano do dia
    capped: (k) => rules.isCapped(plan, done(), k),
    // Quanto ainda cabe até o teto de 120% (ex.: vídeos que ainda dá para ver hoje)
    room: (k) => rules.limitOf(plan, k) - (done()[k] || 0),
    allowed: (act, acc) => rules.activityAllowed(act, plan, done(), acc),
    useful: (act) => rules.activityUseful(act, plan, done()),
    // Peso da atividade pelo que falta no dia (rules.activityPriority)
    priority: (act) => rules.activityPriority(act, plan, done()),
    missing: (labels) => rules.missingText(plan, done(), labels),
    // Sessão terminou? Todas as metas batidas (ignorando as inalcançáveis nesta sessão), ou a parte do dia
    // que esta sessão devia cobrir (target < 1: sessão curta da rotina; o resto fica para a próxima).
    // A parte vale para CADA meta (37% dos vídeos, 37% das curtidas...), não para a média: pela média,
    // a única visita de perfil do dia sozinha já valia 33% e a sessão acabava em 1 minuto.
    goalsDone: (skip = []) =>
      goalKeys.every((k) => skip.includes(k) || left(k) <= 0) ||
      (target < 1 && goalKeys.every((k) => skip.includes(k) || (done()[k] || 0) >= Math.round(plan[k] * target))),
    target,
    stalled: () => now() - state.lastProgress > STALL_MS,
    status(text, ms) {
      state.lastBeat = now();
      state.status = text;
      state.statusAt = now();
      state.statusUntil = ms ? now() + ms : null;
      hooks.status(text, state.statusUntil);
    },
    action(type, detail = '') {
      state.lastBeat = now();
      if (goalKeys.includes(type) && left(type) > 0) state.lastProgress = now();
      state.stats[type] = (state.stats[type] || 0) + 1;
      hooks.action(type, detail);
    },
    log(msg, level = 'info') {
      state.lastBeat = now();
      hooks.log(msg, level);
    },
    alert(level, msg, kind) {
      hooks.alert(level, msg, kind);
    },
    // Falha numa atividade: vai para o log e, se a mesma falha se repete, vira alerta no painel
    // (assim um erro do robô ou uma mudança no site não passa dias escondido no log)
    fail(label, err) {
      const msg = String((err && err.message) || err).split('\n')[0];
      this.log(`Falha em "${label}": ${msg}`, 'warn');
      const key = `${label}|${msg}`;
      fails[key] = (fails[key] || 0) + 1;
      if (fails[key] === FAIL_ALERT)
        hooks.alert(
          'warn',
          `"${label}" falhou ${FAIL_ALERT} vezes nesta sessão: ${msg}. Pode ser erro do robô ou mudança no site`,
          'error',
        );
    },
    // Amostra de tempo (pausas, tempo por vídeo, digitação): vira o resumo "Naturalidade" da sessão
    sample(kind, ms) {
      (state.samples[kind] = state.samples[kind] || []).push(Math.round(ms));
    },
  };
}

module.exports = { createCtl, STALL_MS, FAIL_ALERT };
