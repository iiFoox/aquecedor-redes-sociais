// Regras do aquecimento: datas, metas, saúde, alertas e a decisão do agendador.
// Nada aqui fala com o banco ou com o navegador, então tudo pode ser testado.

const TZ = process.env.APP_TZ || 'America/Sao_Paulo';
const DAY_MS = 86400000;
const GOAL_CAP = 1.2; // nenhuma meta passa de 120% do plano do dia
const ALERT_GROUP_MS = 30 * 60000; // alerta igual dentro de 30 min vira o mesmo ("4×")
const GAP_MIN = 45; // intervalo entre sessões da mesma conta, em minutos
const GAP_MAX = 90;

const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 'AAAA-MM-DD' no fuso do app
const localDate = (d = new Date()) => dateFmt.format(d);

// Minutos desde a meia-noite no fuso do app
function localMinutes(d = new Date()) {
  const [h, m] = timeFmt.format(d).split(':').map(Number);
  return h * 60 + m;
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Diferença em dias de calendário entre duas datas 'AAAA-MM-DD'
const calendarDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

// Dia do aquecimento. Vira à meia-noite, junto com o plano do dia
// (antes virava 24 h depois do cadastro e a troca de fase atrasava).
const dayOf = (account, now = new Date()) => calendarDiff(localDate(new Date(account.startedAt)), localDate(now)) + 1;

// Plano do dia: sorteado uma vez por data e guardado em daily[data].plan
function ensurePlan(daily, dateKey, day, gen) {
  const d = (daily[dateKey] = daily[dateKey] || {});
  if (d.plan) return { plan: d.plan, created: false };
  d.plan = gen(day);
  return { plan: d.plan, created: true };
}

// Teto de uma meta: 120% do plano, arredondado para cima. Meta zerada = teto zero.
const capOf = (planned) => Math.ceil((planned || 0) * GOAL_CAP);
const isCapped = (plan, done, k) => (done[k] || 0) >= capOf(plan[k]);

// % de cumprimento das metas (ignora "minutes" e metas zeradas)
function completion(plan, done) {
  const keys = Object.keys(plan || {}).filter((k) => k !== 'minutes' && plan[k] > 0);
  if (!keys.length) return 1;
  return keys.reduce((s, k) => s + Math.min(1, (done[k] || 0) / plan[k]), 0) / keys.length;
}

// Uma atividade pode rodar se não passa nenhuma meta do teto e se ainda adianta alguma meta.
// activities: { nome: { produces: [metas que a atividade conta], advances: [metas que ela pode adiantar], when?(conta) } }
function activityAllowed(act, plan, done, account) {
  if (act.when && !act.when(account)) return false;
  return act.produces.every((k) => !isCapped(plan, done, k));
}
function activityUseful(act, plan, done) {
  return act.advances.some((k) => (plan[k] || 0) - (done[k] || 0) > 0);
}

// Ainda dá para avançar alguma meta hoje sem passar do teto?
function canProgress(activities, plan, done, account) {
  return Object.values(activities).some((a) => activityAllowed(a, plan, done, account) && activityUseful(a, plan, done));
}

// Situação do dia: 'done' (metas batidas), 'limit' (o que falta passaria do teto) ou 'pending'
function dayStatus(activities, plan, done, account) {
  if (completion(plan, done) >= 1) return 'done';
  return canProgress(activities, plan, done, account) ? 'pending' : 'limit';
}

// Janela de horário. Aceita janelas que passam da meia-noite (ex.: 20:00–02:00).
function inWindow(minutes, start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

// Janela da conta: a dela, se tiver, senão a janela geral do piloto automático
const windowOf = (account, config) => account.window || { start: config.start, end: config.end };

// Tipo do alerta a partir do texto (para alertas antigos, que não tinham tipo)
function kindFromMsg(msg = '') {
  if (/logad|login|expirou/i.test(msg)) return 'login';
  if (/captcha|verifica|challenge/i.test(msg)) return 'captcha';
  if (/bloque|limitou|restring|tente novamente/i.test(msg)) return 'block';
  return 'other';
}

// Alerta igual (mesmo tipo, nível e texto, ainda aberto) dentro de 30 min soma no anterior
function mergeAlert(alerts, next) {
  for (let i = alerts.length - 1; i >= 0; i--) {
    const x = alerts[i];
    if (x.resolvedAt || x.kind !== next.kind || x.level !== next.level || x.msg !== next.msg) continue;
    if (next.t - x.lastT > ALERT_GROUP_MS) break;
    x.count += 1;
    x.lastT = next.t;
    return { alert: x, merged: true };
  }
  return { alert: next, merged: false };
}

/**
 * Saúde (0-100):
 *  - 40 pts consistência (dias com sessão nos últimos 7 dias)
 *  - 30 pts cumprimento das metas (média das últimas 3 sessões que chegaram a rodar)
 *  - 30 pts segurança (perde pontos com captcha, bloqueio e erro da semana).
 * Falta de login e proxy fora do ar não contam: não são sinais da plataforma contra a conta.
 */
function computeHealth(a, now = new Date()) {
  const ran = (a.history || []).filter((h) => h.result !== 'not_logged');
  if (!ran.length) return { score: 0, consistency: 0, completion: 0, safety: 100, label: 'Sem dados', nodata: true };
  const today = localDate(now);
  const day = dayOf(a, now);
  const todayActive = !!(a.daily[today] || {}).sessions;
  let active = todayActive ? 1 : 0;
  let total = todayActive ? 1 : 0;
  for (let i = 1; i < Math.min(day, 7); i++) {
    const d = a.daily[addDays(today, -i)] || {};
    if (d.vacation) continue; // dia de férias não conta contra a consistência
    total++;
    if (d.sessions) active++;
  }
  const consistency = total ? active / total : 0;

  const recent = ran.slice(-3);
  const comp = recent.reduce((s, h) => s + (h.completion || 0), 0) / recent.length;

  const weekAgo = now.getTime() - 7 * DAY_MS;
  const penalty = (a.alerts || [])
    .filter((x) => x.t > weekAgo && x.kind !== 'login' && x.kind !== 'proxy')
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

// Quando a mesma conta pode abrir a próxima sessão (intervalo sorteado a cada vez)
const nextAfter = (endedAt, rand = Math.random) => endedAt + Math.round(GAP_MIN + rand() * (GAP_MAX - GAP_MIN)) * 60000;

// Intervalo antigo, para contas que ainda não têm "nextAfter" gravado
const legacyGap = (id) => (GAP_MIN + (String(id).charCodeAt(0) % 45)) * 60000;

// ---------- Férias ----------

// Datas inteiras que ficaram em férias: as de depois do dia em que saiu até antes do dia em que voltou.
// O dia da saída e o da volta contam como dias normais.
function vacationDays(fromMs, toMs) {
  const out = [];
  const end = localDate(new Date(toMs));
  for (let d = addDays(localDate(new Date(fromMs)), 1); d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

// O aquecimento continua de onde parou: o início da conta anda para frente um dia por dia de férias
// (só os dias de férias depois do cadastro contam)
function shiftStart(startedAt, days) {
  const skip = days.filter((d) => d > localDate(new Date(startedAt))).length;
  return { startedAt: new Date(Date.parse(startedAt) + skip * DAY_MS).toISOString(), skipped: skip };
}

// ---------- Backup ----------

const BACKUP_RETRY_MS = 30 * 60000;

// Backup do dia já pode rodar? A partir do horário marcado, uma vez por data. Se falhar, tenta de novo em 30 min.
function backupDue(now, last, at = '04:00') {
  if (localMinutes(now) < toMinutes(at)) return false;
  if (last && last.at && localDate(new Date(last.at)) === localDate(now)) return false;
  if (last && last.triedAt && now.getTime() - last.triedAt < BACKUP_RETRY_MS) return false;
  return true;
}

// ---------- Proxies ----------

const proxyHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

// Proxy automático: o online com menos contas (desempate: o mais rápido). Nunca usado em conta já logada.
function pickProxy(proxies, accounts) {
  const uses = (url) => accounts.filter((a) => a.proxy === url).length;
  const online = proxies.filter((p) => p.status === 'online');
  online.sort((x, y) => uses(x.url) - uses(y.url) || (x.ms || 0) - (y.ms || 0));
  return online[0] ? online[0].url : null;
}

/**
 * Decide se o agendador inicia uma sessão desta conta agora. Devolve o motivo:
 * 'iniciar' ou o que impede. ctx: { now, config, runningCount, running, browserOpen, backupHold, proxyDown,
 * plan (objeto ou função), today, activities }
 */
function decide(account, ctx) {
  const { now, config } = ctx;
  if (!config.active) return 'piloto-desligado';
  if (config.pausedUntil && now.getTime() < config.pausedUntil) return 'ferias';
  if (ctx.backupHold) return 'backup';
  const win = windowOf(account, config);
  if (!inWindow(localMinutes(now), win.start, win.end)) return 'fora-da-janela';
  if (ctx.running) return 'rodando';
  if (ctx.browserOpen) return 'navegador-aberto';
  if (account.attention) return 'precisa-atencao';
  if (ctx.proxyDown) return 'proxy-fora';
  if (ctx.runningCount >= config.max) return 'limite-simultaneo';
  const plan = typeof ctx.plan === 'function' ? ctx.plan() : ctx.plan;
  const status = dayStatus(ctx.activities, plan, ctx.today, account);
  if (status === 'done') return 'meta-batida';
  if (status === 'limit') return 'limite-do-plano';
  if (account.nextAfter) {
    if (now.getTime() < account.nextAfter) return 'intervalo';
  } else {
    const last = (account.history || [])[account.history.length - 1];
    if (last && now.getTime() - Date.parse(last.date) < legacyGap(account.id)) return 'intervalo';
  }
  return 'iniciar';
}

module.exports = {
  TZ,
  GOAL_CAP,
  localDate,
  localMinutes,
  toMinutes,
  addDays,
  calendarDiff,
  dayOf,
  ensurePlan,
  capOf,
  isCapped,
  completion,
  activityAllowed,
  activityUseful,
  canProgress,
  dayStatus,
  inWindow,
  windowOf,
  kindFromMsg,
  mergeAlert,
  computeHealth,
  nextAfter,
  legacyGap,
  vacationDays,
  shiftStart,
  backupDue,
  proxyHost,
  pickProxy,
  decide,
};
