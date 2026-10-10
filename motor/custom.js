// Metas personalizadas (por conta e risco do dono): modelos com os dias até a conta ficar pronta e os números de cada
// uma das 5 fases (a mesma ordem da meta recomendada). Ficam na configuração do usuário (vale para todos os aparelhos);
// cada conta escolhe a recomendada (sem modelo) ou um modelo da mesma plataforma.
// Proteções que valem igual: captcha/bloqueio param a sessão, pausa de follows. O número escrito no modelo é o MÁXIMO
// do dia: a variação só desce e o teto (plan.caps) é o próprio número, sem os 120% da recomendada.
// Troca de meta (ou modelo editado) com a conta já rodando: transição suave (rampPlan), subindo no máximo ~25% por dia.
const crypto = require('crypto');
const { READY_DAY } = require('./platforms/phases');

// Limites para não aceitar número absurdo (por dia). Dentro deles, o dono decide.
const LIMITS = {
  readyDay: [5, 90],
  minutes: [3, 180],
  watch: [0, 400],
  like: [0, 300],
  follow: [0, 100],
  profile: [0, 60],
  search: [0, 30],
  story: [0, 100],
  reel: [0, 200],
  explore: [0, 30],
};
const NAME_MAX = 40;
const IG_POSTS_MAX = 15; // publicações que uma visita ao Explorar abre, no máximo (instagram.js: POSTS_MAX)
const RAMP = 1.25; // transição: no máximo +25% por dia sobre o que a conta fez no último dia com sessão
const RAMP_LOOKBACK = 7; // dias para trás procurando o último dia com sessão
const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};
const intIn = (v, [lo, hi], label) => {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${label}: use um número inteiro`);
  if (n < lo || n > hi) fail(`${label}: entre ${lo} e ${hi}`);
  return n;
};

/**
 * Confere e limpa um modelo vindo do painel. plans = os 5 planos recomendados da plataforma (as chaves que valem).
 * Campo que falta numa fase fica com o recomendado. Devolve { id, name, platform, readyDay, vary, phases }.
 */
function normalizeTemplate(input, plans, labels = {}) {
  if (!input || typeof input !== 'object') fail('Modelo inválido');
  const name = String(input.name || '').trim();
  if (!name) fail('Dê um nome ao modelo');
  if (name.length > NAME_MAX) fail(`Nome com no máximo ${NAME_MAX} letras`);
  const readyDay = intIn(input.readyDay ?? READY_DAY, LIMITS.readyDay, 'Dias até a conta ficar pronta');
  const src = Array.isArray(input.phases) ? input.phases : [];
  const keys = Object.keys(plans[0]);
  const phases = plans.map((base, i) => {
    const out = {};
    for (const k of keys) {
      const v = src[i] && src[i][k] !== undefined && src[i][k] !== '' ? src[i][k] : base[k];
      out[k] = intIn(v, LIMITS[k] || [0, 1000], `Fase ${i + 1}, ${labels[k] || k}`);
    }
    return out;
  });
  phases.forEach((ph, i) => impossible(input.platform, ph, labels).forEach((m) => fail(`Fase ${i + 1}: ${m}`)));
  return {
    id: typeof input.id === 'string' && /^[\w-]{6,40}$/.test(input.id) ? input.id : crypto.randomUUID(),
    name,
    platform: input.platform,
    readyDay,
    vary: input.vary !== false,
    phases,
    updatedAt: new Date().toISOString(),
  };
}

// Combinações que o robô não consegue fazer (o dia nunca fecharia), conferidas também no painel (web/src/lib/meta.ts):
// TikTok: cada curtida é num vídeo assistido; cada follow é num vídeo ou num perfil visitado.
// Instagram: follow só sai das publicações abertas no Explorar (Explorar zerado = nenhum follow possível).
function impossible(platform, ph, labels = {}) {
  const n = (k) => ph[k] || 0;
  const lc = (k) => (labels[k] || k).toLowerCase();
  const out = [];
  if (platform === 'tiktok') {
    if (n('like') > n('watch')) out.push(`mais ${lc('like')} (${n('like')}) que ${lc('watch')} (${n('watch')})`);
    if (n('follow') > n('watch') + n('profile'))
      out.push(`mais ${lc('follow')} (${n('follow')}) que ${lc('watch')} + ${lc('profile')} (${n('watch') + n('profile')})`);
  }
  if (platform === 'instagram' && n('follow') > 0 && n('explore') === 0)
    out.push(`${lc('follow')} precisam de pelo menos 1 em ${labels.explore || 'Explorar'} (é de lá que eles saem)`);
  else if (platform === 'instagram' && n('follow') > n('explore') * IG_POSTS_MAX)
    out.push(
      `${lc('follow')} demais para ${n('explore')} em ${labels.explore || 'Explorar'} (cada um abre até ${IG_POSTS_MAX} publicações)`,
    );
  return out;
}

// O que mudou entre duas versões de um modelo, em texto ("prazo de 22 para 15 dias", "curtidas fase 3 de 20 para 30")
function diffTemplate(before, after, labels = {}) {
  if (!before) return [];
  const out = [];
  if (before.name !== after.name) out.push(`nome de "${before.name}" para "${after.name}"`);
  if (before.readyDay !== after.readyDay) out.push(`prazo de ${before.readyDay} para ${after.readyDay} dias`);
  if (!!before.vary !== !!after.vary) out.push(after.vary ? 'passou a variar por dia' : 'números exatos (sem variar)');
  after.phases.forEach((ph, i) => {
    for (const k of Object.keys(ph)) {
      const was = before.phases[i] ? before.phases[i][k] : undefined;
      if (was !== ph[k]) out.push(`${(labels[k] || k).toLowerCase()} fase ${i + 1} de ${was ?? 0} para ${ph[k]}`);
    }
  });
  return out;
}

/**
 * Plano do dia de um modelo na fase "idx". O número do modelo é o máximo do dia: com "vary" ele desce um pouco
 * (até ~10%, para não ficar robótico) e nunca sobe; números até 2 não variam (1 follow não vira 0 nem 2).
 * Meta zerada continua zerada. caps: o teto de cada meta = o número escrito (rules.limitOf), no lugar dos 120%.
 */
function vary(v, rng) {
  if (v <= 2) return v;
  const d = Math.max(1, Math.round(v * 0.1));
  return v - Math.floor(rng() * (d + 1));
}
function planFrom(t, idx, rng = Math.random) {
  const base = t.phases[Math.max(0, Math.min(t.phases.length - 1, idx))];
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = !t.vary ? v : k === 'minutes' ? Math.max(3, vary(v, rng)) : vary(v, rng);
  out.caps = capsOf(base);
  return out;
}
const capsOf = (p) => Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== 'minutes' && typeof v === 'number'));

// O último dia antes de "today" (até 7 dias para trás) em que a conta teve sessão: o que ela fez nele
function lastDone(daily, today) {
  const dates = Object.keys(daily || {})
    .filter((d) => d < today)
    .sort()
    .reverse()
    .slice(0, RAMP_LOOKBACK);
  const d = dates.find((x) => (daily[x].sessions || 0) > 0);
  return d ? daily[d] : null;
}

/**
 * Transição suave depois de trocar a meta: cada meta sobe no máximo +25% (pelo menos +1) sobre o que a conta fez no
 * último dia com sessão, até alcançar o plano novo. Descer é na hora (menos atividade não pesa contra a conta).
 * Devolve { plan, limited }: limited = ainda segurou alguma meta (a transição continua amanhã). Sem dia com sessão
 * para comparar (conta nova ou parada há 7+ dias): nada a suavizar. Durante a transição o teto é o plano do dia.
 */
function rampPlan(target, daily, today, platform) {
  const ref = lastDone(daily, today);
  if (!ref) return { plan: target, limited: false };
  const plan = { ...target };
  let limited = false;
  for (const [k, v] of Object.entries(target)) {
    if (k === 'minutes' || k === 'caps' || typeof v !== 'number') continue;
    const was = ref[k] || 0;
    const lim = Math.max(was + 1, Math.ceil(was * RAMP));
    if (v > lim) {
      plan[k] = lim;
      limited = true;
    }
  }
  if (platform === 'tiktok' && plan.like > plan.watch) plan.like = plan.watch;
  if (limited) plan.caps = capsOf(plan);
  return { plan, limited };
}

// Plano do dia de uma conta em transição (a.goalRamp = data da troca de meta): aplica rampPlan; a transição acaba no
// primeiro dia em que nada precisou ser segurado, ou depois de 60 dias. Usado pelo motor (store.planOf) e pelo simulador.
const RAMP_MAX_DAYS = 60;
function withRamp(a, target, today) {
  if (!a.goalRamp) return target;
  const r = rampPlan(target, a.daily, today, a.platform);
  if (!r.limited || (Date.parse(today) - Date.parse(a.goalRamp)) / 86400000 > RAMP_MAX_DAYS) {
    delete a.goalRamp;
    return target;
  }
  return r.plan;
}

module.exports = { LIMITS, RAMP, normalizeTemplate, impossible, diffTemplate, planFrom, rampPlan, withRamp, lastDone };
