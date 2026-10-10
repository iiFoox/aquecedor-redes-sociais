// Regras do aquecimento: datas, metas, saúde, alertas e a decisão do agendador.
// Nada aqui fala com o banco ou com o navegador, então tudo pode ser testado.

const human = require('./human');

const TZ = process.env.APP_TZ || 'America/Sao_Paulo';
const DAY_MS = 86400000;
const GOAL_CAP = 1.2; // nenhuma meta passa de 120% do plano do dia
const LEASE_MS = 5 * 60000; // trava da conta: renovada a cada minuto enquanto ela está aberta num aparelho

// Como abrir o navegador da conta. Nunca headless: sem janela o Edge se apresenta como "HeadlessChrome" (marca
// clássica de robô). "Esconder as janelas" abre a janela normal, só que fora da tela (a tela ao vivo continua pelo CDP).
function windowMode(conf, visible = false) {
  const hide = !visible && !!conf.headless;
  return { headless: false, args: hide ? ['--window-position=-32000,-32000'] : [] };
}

// Outro aparelho está com a conta aberta agora? (trava ainda válida e não é deste aparelho)
function leaseHeld(account, me, now = Date.now()) {
  const l = account && account.lease;
  return !!l && l.device !== me && l.until > now;
}
const ALERT_GROUP_MS = 30 * 60000; // alerta igual dentro de 30 min vira o mesmo ("4×")
const GAP_MIN = 45; // intervalo antigo (contas sem "nextAfter"), em minutos

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
// Meta personalizada: plan.caps tem o teto escrito no modelo (motor/custom.js); vale o menor dos dois.
const limitOf = (plan, k) => {
  const c = plan && plan.caps && plan.caps[k];
  return typeof c === 'number' ? Math.min(capOf(plan[k]), c) : capOf(plan && plan[k]);
};
const isCapped = (plan, done, k) => (done[k] || 0) >= limitOf(plan, k);

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

// Prioridade de uma atividade pelo que FALTA na meta do dia: soma a parte que falta de cada meta
// que ela adianta (6 de 6 curtidas faltando = 1; 1 de 4 perfis = 0,25). Se ela também contaria uma
// meta já batida (ex.: mais vídeos quando os vídeos já fecharam), vale 1/4: ainda pode ser o único
// caminho até o que falta, mas perde para quem vai direto ao ponto. 0 = não adianta nada.
const OVERSHOOT_WEIGHT = 0.25;
function activityPriority(act, plan, done) {
  let need = 0;
  for (const k of act.advances) if (plan[k] > 0) need += Math.max(0, plan[k] - (done[k] || 0)) / plan[k];
  if (!need) return 0;
  const over = act.produces.some((k) => plan[k] > 0 && (done[k] || 0) >= plan[k]);
  return need * (over ? OVERSHOOT_WEIGHT : 1);
}

// O que falta hoje, em texto: "6 curtidas, 1 perfis visitados"
function missingText(plan, done, labels = {}) {
  return Object.keys(plan)
    .filter((k) => k !== 'minutes' && plan[k] - (done[k] || 0) > 0)
    .map((k) => `${plan[k] - (done[k] || 0)} ${(labels[k] || k).toLowerCase()}`)
    .join(', ');
}

// Sessão que viu bastante vídeo e não curtiu nada, com curtidas faltando: sinal de que curtir quebrou.
// likeLeft: curtidas que faltavam no começo da sessão. stats: o que a sessão fez.
const NO_LIKE_MIN_VIDEOS = 10;
function noLikeWarning(likeLeft, stats) {
  const videos = (stats.watch || 0) + (stats.reel || 0);
  if (!(likeLeft > 0) || (stats.like || 0) > 0 || videos < NO_LIKE_MIN_VIDEOS) return null;
  return `A sessão viu ${videos} vídeos e não curtiu nenhum, com ${likeLeft} curtidas faltando. Confira se curtir está funcionando`;
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
 *  - 30 pts cumprimento das metas: média dos últimos 3 dias que já acabaram (o dia todo, não cada sessão: com a
 *    rotina, a 1ª sessão do dia cobre só parte dele e não é meta perdida). Conta nova, sem dia anterior: o dia de
 *    hoje comparado com a parte que as sessões feitas deviam cobrir.
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

  const days = [];
  for (let i = 1; i <= 7 && days.length < 3; i++) {
    const d = a.daily[addDays(today, -i)];
    if (d && d.plan && d.sessions && !d.vacation) days.push(completion(d.plan, d));
  }
  let comp;
  if (days.length) comp = days.reduce((s, x) => s + x, 0) / days.length;
  else {
    const t = a.daily[today] || {};
    const slots = t.slots || [];
    const slot = slots[Math.min(t.sessions || 0, slots.length) - 1];
    if (t.plan && t.sessions) comp = Math.min(1, completion(t.plan, t) / (slot ? slot.target : 1));
    else {
      const recent = ran.slice(-3);
      comp = recent.reduce((s, h) => s + (h.completion || 0), 0) / recent.length;
    }
  }

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

// Histórico dos últimos n dias, do mais antigo para hoje: quanto da meta foi batido em cada dia.
// completion null = dia antes do cadastro ou sem plano sorteado (a conta não aqueceu).
function dayHistory(a, n, now = new Date()) {
  const today = localDate(now);
  const start = localDate(new Date(a.startedAt));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const d = a.daily[date] || {};
    const { plan, sessions = 0, minutes = 0, vacation = false, ...done } = d;
    out.push({ date, completion: date < start || !plan ? null : completion(plan, done), sessions, minutes, vacation: !!vacation });
  }
  return out;
}

// Sessões que terminaram hoje, para a agenda do dia: { start, end, result } em ms
function sessionsToday(history, now = new Date()) {
  const today = localDate(now);
  return history
    .filter((h) => localDate(new Date(h.date)) === today)
    .map((h) => {
      const end = Date.parse(h.date);
      const start = h.startedAt ? Date.parse(h.startedAt) : end - (h.minutes || 0) * 60000;
      return { start, end, result: h.result };
    });
}

// Teto de segurança da sessão, em minutos: 2,5x o tempo estimado do plano, entre 30 e 90 min
const sessionCap = (plan) => Math.min(90, Math.max(30, Math.round((plan.minutes || 15) * 2.5)));

// Descanso mínimo depois de uma sessão, antes da próxima da mesma conta: cauda longa
// (mediana de 50 min, quase sempre entre 30 min e 2 h, raramente até 3 h). Antes era 45–90 min uniforme.
const nextAfter = (endedAt, rand = Math.random) => endedAt + Math.round(human.bounded(rand, 50, 0.45, 30, 180)) * 60000;

// ---------- Rotina do dia ----------

const MIN_SLOT_GAP = 45; // minutos entre o começo de duas sessões planejadas
const SLOT_MIN_REST = 20; // minutos de descanso, no mínimo, entre o fim de uma sessão e a sessão planejada seguinte
// Dia da semana da data 'AAAA-MM-DD' (0 = domingo)
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date) => [0, 6].includes(weekdayOf(date));

/**
 * Sessões planejadas para o dia: horários (perto do horário preferido da conta, dentro da janela)
 * e quanto da meta do dia cada uma cobre (sessões de tamanhos diferentes; a última fecha 100%).
 *  - Quantas: 1 a 4, conforme o tamanho do plano (plano curto = menos sessões). Fim de semana: menos e mais tarde.
 *  - notBefore: não planeja nada antes disso (conta criada ou motor ligado no meio do dia).
 *  - onHours: horas em que este aparelho costuma ficar ligado (rules.onHours; null = ainda não sabe). As sessões só
 *    caem nelas: sessão marcada para a noite num PC que só fica ligado de dia nunca acontece (o dia se perde).
 *    Nenhuma hora boa sobrando hoje (ligou fora do costume): uma sessão só, agora.
 * Devolve [{ at (ms), target (0..1) }] em ordem.
 */
function planSlots({ date, window, persona, planMinutes = 15, rng = Math.random, notBefore = 0, onHours = null }) {
  const ws = toMinutes(window.start);
  const we = toMinutes(window.end);
  const len = (we - ws + 1440) % 1440 || 1440; // janela em minutos (pode passar da meia-noite)
  const dayStart = Date.parse(`${date}T00:00:00Z`) - offsetMinutes(date) * 60000; // meia-noite no fuso do app
  const weekend = isWeekend(date);

  // Quantas sessões
  const maxN = Math.max(1, Math.min(4, Math.round(planMinutes / 7)));
  const r = rng();
  let n = weekend ? (r < 0.3 ? 1 : r < 0.75 ? 2 : 3) : r < 0.35 ? 2 : r < 0.8 ? 3 : 4;
  n = Math.min(n, maxN);

  // Pico da conta dentro da janela (fim de semana: uma hora mais tarde)
  const peakMin = ((persona ? persona.peak : 20) + (weekend ? 1 : 0)) * 60;
  let peakOff = (peakMin - ws + 1440) % 1440;
  if (peakOff > len) peakOff = peakOff - len < 1440 - peakOff ? len * 0.85 : len * 0.15;
  const sd = (persona ? persona.spread : 2.5) * 60;
  const earliest = notBefore ? Math.max(0, Math.ceil((notBefore - (dayStart + ws * 60000)) / 60000)) : 0;
  const latest = len - 20; // nada começa nos últimos 20 min da janela

  // Horários possíveis (de 5 em 5 min) com o aparelho costumando estar ligado no começo e 30 min depois
  let pool = null;
  if (onHours) {
    const on = (off) => onHours[Math.floor(((ws + Math.round(off)) % 1440) / 60)];
    pool = [];
    for (let v = Math.ceil(earliest / 5) * 5; v <= latest; v += 5) if (on(v) && on(v + 30)) pool.push(v);
    if (!pool.length) {
      n = 1;
      pool = [Math.min(latest, earliest)];
    }
    const nearest = (v) => pool.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), pool[0]);
    peakOff = nearest(peakOff);
    pool.nearest = nearest;
  }

  let offs = [];
  for (; n >= 1 && !offs.length; n--) {
    for (let tries = 0; tries < 40; tries++) {
      const cand = [];
      for (let i = 0; i < n; i++) {
        // Metade em volta do pico, metade espalhada pela janela (ninguém usa só num horário)
        if (pool) {
          const v = rng() < 0.6 ? pool.nearest(peakOff + sd * normalish(rng)) : pool[Math.floor(rng() * pool.length)];
          cand.push(v + rng() * 4); // dentro dos 5 min do horário
          continue;
        }
        let v = rng() < 0.6 ? peakOff + sd * normalish(rng) : earliest + rng() * Math.max(0, latest - earliest);
        for (let k = 0; k < 4 && (v < earliest || v > latest); k++) v = earliest + rng() * Math.max(0, latest - earliest);
        cand.push(Math.min(latest, Math.max(earliest, v)));
      }
      cand.sort((a, b) => a - b);
      if (cand.every((v, i) => i === 0 || v - cand[i - 1] >= MIN_SLOT_GAP + 1)) {
        offs = cand;
        break;
      }
    }
  }
  if (!offs.length) offs = [Math.min(latest, Math.max(earliest, 0))]; // janela curta demais: uma sessão só

  // Quanto da meta cada sessão cobre: partes de tamanhos sorteados (mín. 15%), acumuladas até 100%
  const parts = offs.map(() => Math.max(0.15, human.lognormal(rng, 1, 0.6)));
  const total = parts.reduce((a, b) => a + b, 0);
  let acc = 0;
  return offs.map((off, i) => {
    acc += parts[i] / total;
    const minute = (ws + Math.round(off)) % 1440;
    const crossesMidnight = ws + Math.round(off) >= 1440;
    return {
      at: dayStart + (crossesMidnight ? 1440 : 0) * 60000 + minute * 60000 + Math.floor(rng() * 60000),
      target: i === offs.length - 1 ? 1 : Math.round(acc * 100) / 100,
    };
  });
}

// Normal aproximada (soma de 3 uniformes), entre -3 e 3
const normalish = (rng) => (rng() + rng() + rng() - 1.5) * 2;

// Minutos que o fuso do app está à frente de UTC na data (ex.: -180 em São Paulo)
function offsetMinutes(date) {
  const noon = new Date(`${date}T12:00:00Z`);
  return localMinutes(noon) - 12 * 60 + (localDate(noon) === date ? 0 : localDate(noon) > date ? 1440 : -1440);
}

// Rotina do dia: planejada uma vez por data e guardada em daily[data].slots
function ensureSlots(daily, date, gen) {
  const d = (daily[date] = daily[date] || {});
  if (d.slots) return { slots: d.slots, created: false };
  d.slots = gen();
  return { slots: d.slots, created: true };
}

// ---------- Horas em que o aparelho costuma ficar ligado ----------
// uptime: { 'AAAA-MM-DD': [minutos ligado em cada hora 0..23] } (motor/uptime.js grava; só minutos com internet)

const UPTIME_KEEP_DAYS = 21;

// Soma minutos ligado na hora local de "ms" e guarda só os últimos 21 dias
function addUptime(uptime, ms, minutes = 1) {
  const d = new Date(ms);
  const date = localDate(d);
  const h = Math.floor(localMinutes(d) / 60);
  const row = (uptime[date] = uptime[date] || new Array(24).fill(0));
  row[h] = Math.min(60, row[h] + minutes);
  const dates = Object.keys(uptime).sort();
  for (const old of dates.slice(0, Math.max(0, dates.length - UPTIME_KEEP_DAYS))) delete uptime[old];
  return uptime;
}

// Passado reconstruído pelo registro do motor ("===== DD/MM/AAAA, HH:MM:SS motor ligado/parou"), na primeira vez.
// Intervalo de mais de 12 h fica de fora: é o PC em espera (sem internet), não ligado de verdade.
function uptimeFromLog(text) {
  const uptime = {};
  const re = /^===== (\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2}) motor (ligado|parou)/gm;
  let on = null;
  for (let m; (m = re.exec(text));) {
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    const ms = Date.parse(`${date}T${m[4]}:${m[5]}:${m[6]}Z`) - offsetMinutes(date) * 60000;
    if (m[7] === 'ligado') on = ms;
    else if (on !== null) {
      if (ms > on && ms - on <= 12 * 3600000) for (let t = on; t < ms; t += 60000) addUptime(uptime, t, 1);
      on = null;
    }
  }
  return uptime;
}

/**
 * Horas (0..23) em que o aparelho costuma estar ligado, pelos dias anteriores a "today" em que ele ligou (até 14):
 * hora boa = ligado 30+ min nela em pelo menos metade desses dias. null = menos de 2 dias de histórico.
 */
function onHours(uptime, today, { minDays = 2, lookback = 14 } = {}) {
  const days = Object.keys(uptime || {})
    .filter((d) => d < today && uptime[d].reduce((a, b) => a + b, 0) >= 30)
    .sort()
    .slice(-lookback);
  if (days.length < minDays) return null;
  const hours = Array.from({ length: 24 }, (_, h) => days.filter((d) => uptime[d][h] >= 30).length >= days.length / 2);
  return hours.some(Boolean) ? hours : null;
}

// Alguma sessão que ainda vai acontecer hoje cai numa hora em que o aparelho costuma estar desligado?
function slotsOffHours(slots, done, hours, now = Date.now()) {
  if (!hours) return false;
  return slots.slice(done).some((s) => s.at > now && !hours[Math.floor(localMinutes(new Date(s.at)) / 60)]);
}

// Junta as sessões já feitas com uma rotina nova para o resto do dia. As partes novas cobrem o que falta
// (de onde a última sessão feita parou até 100%).
function replanRest(slots, done, fresh) {
  const prev = done ? slots[Math.min(done, slots.length) - 1].target : 0;
  return slots
    .slice(0, done)
    .concat(fresh.map((s) => ({ at: s.at, target: s.target === 1 ? 1 : Math.round((prev + (1 - prev) * s.target) * 100) / 100 })));
}

// Espaço mínimo entre o começo de sessões de contas diferentes: 4 a 14 min, sorteado por conta e por dia
const spacingMs = (account, date) => (4 + (human.hashSeed(`${account.id}:${date}`) % 11)) * 60000;

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
 * 'iniciar' ou o que impede. ctx: { now, config, runningCount, running, browserOpen, backupHold, powerHold, proxyDown,
 * plan (objeto ou função), today, activities, slots (rotina do dia, opcional), lastStartAny (último início
 * de sessão de qualquer conta, ms) }
 */
function decide(account, ctx) {
  const { now, config } = ctx;
  if (!config.active) return 'piloto-desligado';
  if (config.pausedUntil && now.getTime() < config.pausedUntil) return 'ferias';
  if (ctx.backupHold) return 'backup';
  if (ctx.powerHold) return 'energia'; // notebook na bateria abaixo de 20%
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
  // Rotina do dia: a próxima sessão planejada ainda não chegou
  const slots = typeof ctx.slots === 'function' ? ctx.slots() : ctx.slots;
  const slot = slots && slots[ctx.today.sessions || 0];
  if (slot && now.getTime() < slot.at) return 'agendada';
  if (account.nextAfter) {
    // Sessão da Rotina que já chegou vale mais que o intervalo sorteado (até 3 h: podia passar do fim da janela e o dia
    // não fechava). Só espera o descanso mínimo depois da última sessão.
    const last = (account.history || [])[account.history.length - 1];
    const rested = last && now.getTime() - Date.parse(last.date) >= SLOT_MIN_REST * 60000;
    if (now.getTime() < account.nextAfter && !(slot && rested)) return 'intervalo';
  } else {
    const last = (account.history || [])[account.history.length - 1];
    if (last && now.getTime() - Date.parse(last.date) < legacyGap(account.id)) return 'intervalo';
  }
  // Outra conta acabou de abrir: espera um pouco para não abrirem em horários casados
  if (ctx.lastStartAny && now.getTime() - ctx.lastStartAny < spacingMs(account, localDate(now))) return 'espacamento';
  return 'iniciar';
}

module.exports = {
  TZ,
  GOAL_CAP,
  limitOf,
  LEASE_MS,
  leaseHeld,
  windowMode,
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
  activityPriority,
  missingText,
  noLikeWarning,
  OVERSHOOT_WEIGHT,
  canProgress,
  dayStatus,
  inWindow,
  windowOf,
  kindFromMsg,
  mergeAlert,
  computeHealth,
  dayHistory,
  sessionsToday,
  sessionCap,
  nextAfter,
  planSlots,
  addUptime,
  uptimeFromLog,
  onHours,
  slotsOffHours,
  replanRest,
  ensureSlots,
  spacingMs,
  isWeekend,
  offsetMinutes,
  legacyGap,
  vacationDays,
  shiftStart,
  backupDue,
  proxyHost,
  pickProxy,
  decide,
};
