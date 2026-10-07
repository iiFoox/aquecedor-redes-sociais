const store = require('./store');

// % de cumprimento das metas diárias (ignora "minutes" e metas zeradas)
function completion(plan, done) {
  const keys = Object.keys(plan).filter((k) => k !== 'minutes' && plan[k] > 0);
  if (!keys.length) return 1;
  return keys.reduce((s, k) => s + Math.min(1, (done[k] || 0) / plan[k]), 0) / keys.length;
}

/**
 * Saúde (0-100):
 *  - 40 pts consistência (dias com sessão nos últimos 7 dias)
 *  - 30 pts cumprimento das metas (média das últimas 3 sessões)
 *  - 30 pts segurança (perde pontos com bloqueios/captchas recentes)
 */
function computeHealth(a) {
  if (!a.history.length) {
    return { score: 0, consistency: 0, completion: 0, safety: 100, label: 'Sem dados', nodata: true };
  }
  const day = store.dayOf(a);
  const todayActive = !!(a.daily[store.localDate()] || {}).sessions;
  let active = todayActive ? 1 : 0;
  let total = todayActive ? 1 : 0;
  for (let i = 1; i < Math.min(day, 7); i++) {
    total++;
    if ((a.daily[store.localDate(new Date(Date.now() - i * 86400000))] || {}).sessions) active++;
  }
  const consistency = total ? active / total : 0;

  const recent = a.history.slice(-3);
  const comp = recent.reduce((s, h) => s + (h.completion || 0), 0) / recent.length;

  const weekAgo = Date.now() - 7 * 86400000;
  const penalty = a.alerts
    .filter((x) => x.t > weekAgo)
    .reduce((s, x) => s + (x.level === 'danger' ? 15 : x.level === 'warn' ? 4 : 0), 0);
  const safety = Math.max(0, 30 - penalty);

  const score = Math.round(consistency * 40 + comp * 30 + safety);
  return {
    score,
    consistency: Math.round(consistency * 100),
    completion: Math.round(comp * 100),
    safety: Math.round((safety / 30) * 100),
    label: score >= 70 ? 'Saudável' : score >= 40 ? 'Atenção' : 'Crítica',
  };
}

module.exports = { completion, computeHealth };
