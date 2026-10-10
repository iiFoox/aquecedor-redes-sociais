// Metas personalizadas (por conta e risco do dono): modelos com os dias até a conta ficar pronta e os números de cada
// uma das 5 fases (a mesma ordem da meta recomendada). Ficam na configuração do usuário (vale para todos os aparelhos);
// cada conta escolhe a recomendada (sem modelo) ou um modelo da mesma plataforma.
// Proteções que valem igual: teto de 120% do plano do dia, captcha/bloqueio param a sessão, pausa de follows.
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
  return {
    id: typeof input.id === 'string' && /^[\w-]{6,40}$/.test(input.id) ? input.id : crypto.randomUUID(),
    name,
    platform: input.platform,
    readyDay,
    vary: input.vary !== false,
    phases,
  };
}

/**
 * Plano do dia de um modelo na fase "idx". vary: varia um pouco por dia (~10%, para não ficar robótico);
 * meta zerada continua zerada. Sem vary: os números exatos do modelo.
 */
function planFrom(t, idx, rng = Math.random) {
  const base = t.phases[Math.max(0, Math.min(t.phases.length - 1, idx))];
  if (!t.vary) return { ...base };
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'minutes') out.minutes = Math.max(3, v + Math.floor(rng() * 5) - 2);
    else if (!v) out[k] = 0;
    else {
      const d = Math.max(1, Math.round(v * 0.1));
      out[k] = Math.max(1, v + Math.floor(rng() * (2 * d + 1)) - d);
    }
  }
  return out;
}

module.exports = { LIMITS, normalizeTemplate, planFrom };
