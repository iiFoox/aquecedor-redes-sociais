// Resumo de cada conta para o painel. Conta deste aparelho: estado ao vivo do runner.
// Conta de outro aparelho: o que o aparelho dono publicou na coluna status (publisher.js).
const store = require('./store');
const runner = require('./runner');
const rules = require('./rules');
const platforms = require('./platforms');
const { READY_DAY, phaseFor } = require('./platforms/phases');
const backup = require('./backup');
const logins = require('./logins');
const power = require('./power');

const STATUS_FRESH_MS = 3 * 60000; // status mais velho que isso: o aparelho dono sumiu

const alertOut = (x) => ({ t: x.t, lastT: x.lastT, count: x.count, level: x.level, kind: x.kind, msg: x.msg, resolved: !!x.resolvedAt });

const MONTH_MS = 30 * 86400000;
const GRAVE = ['captcha', 'block'];
const OK_RESULTS = ['ok', 'limit'];

// Prints da conta: os deste aparelho + os do histórico (tirados em outro aparelho; vêm do Supabase Storage)
function screensOf(a, here) {
  const all = new Set(here ? runner.listScreens(a.id) : []);
  for (const h of a.history) if (h.screenshot) all.add(h.screenshot);
  return [...all].sort().reverse();
}

const proxyOf = (a) => (a.proxy ? store.allProxies().find((p) => p.url === a.proxy) : null);

// Por que o piloto automático não está abrindo sessão nesta conta agora (ou 'iniciar')
function scheduleReason(a, p, plan, today) {
  const px = proxyOf(a);
  return rules.decide(a, {
    now: new Date(),
    config: store.getConfig(),
    runningCount: 0,
    running: !!runner.getSession(a.id),
    browserOpen: runner.isBrowserOpen(a.id),
    backupHold: backup.hold(),
    powerHold: power.hold(),
    proxyDown: !!px && px.status === 'offline',
    plan,
    today,
    activities: p.activities,
    slots: () => store.slotsOf(a, p.planForDay),
    lastStartAny: store.lastStartAny(Object.values(runner.activeSessions()).map((x) => x.startedAt)),
  });
}

function summarize(a, full = false, devices = []) {
  const p = platforms[a.platform];
  const day = store.dayOf(a);
  // Deste aparelho: estado ao vivo. De outro: o último status publicado pelo aparelho dono (se ainda fresco).
  const here = store.isMine(a);
  const s = here ? runner.getSession(a.id) : null;
  const rs = !here && a.remoteStatus && Date.now() - a.remoteStatus.at < STATUS_FRESH_MS ? a.remoteStatus : null;
  const dev = devices.find((d) => d.id === a.deviceId) || null;
  const plan = store.planOf(a, p.planForDay);
  const today = a.daily[store.localDate()] || {};
  const out = {
    id: a.id,
    platform: a.platform,
    username: a.username,
    interests: a.interests,
    proxy: !!a.proxy,
    proxyHost: a.proxy ? rules.proxyHost(a.proxy) : null,
    proxyStatus: proxyOf(a)?.status || (a.proxy ? 'unknown' : null),
    window: a.window || null,
    schedule: here ? scheduleReason(a, p, plan, today) : rs ? rs.schedule : a.deviceId ? 'aparelho-desligado' : 'sem-aparelho',
    mine: here, // roda neste aparelho
    deviceId: a.deviceId || null,
    deviceName: dev ? dev.name : null,
    deviceOnline: dev ? dev.online : false,
    startedAt: a.startedAt,
    day,
    phase: phaseFor(day),
    plan,
    today,
    completion: rules.completion(plan, today),
    dayStatus: rules.dayStatus(p.activities, plan, today, a),
    attention: a.attention,
    warmProgress: Math.min(100, Math.round(((day - 1) / (READY_DAY - 1)) * 100)),
    health: rules.computeHealth(a),
    sessions: a.history.length,
    nextAfter: a.nextAfter || null,
    // Rotina de hoje: horários planejados e quanto da meta cada sessão cobre
    slots: (a.daily[store.localDate()] || {}).slots || [],
    checklist: a.checklist || {},
    // Últimos 60 dias (meta batida por dia), sessões de hoje (agenda) e números de 30 dias (análises)
    days: rules.dayHistory(a, 60),
    todaySessions: rules.sessionsToday(a.history),
    month: (() => {
      const since = Date.now() - MONTH_MS;
      const ran = a.history.filter((h) => Date.parse(h.date) >= since);
      return {
        sessions: ran.length,
        ok: ran.filter((h) => OK_RESULTS.includes(h.result)).length,
        grave: a.alerts.filter((x) => x.t >= since && GRAVE.includes(x.kind)).length,
      };
    })(),
    lastScreen: screensOf(a, here)[0] || null,
    loginSavedAt: logins.savedAt(a.id), // último login guardado no Supabase (cifrado)
    alerts: a.alerts.slice(-5).reverse().map(alertOut),
    loginOpen: here ? runner.isBrowserOpen(a.id) : !!(rs && rs.loginOpen),
    browserPurpose: here ? runner.browserPurpose(a.id) : (rs && rs.browserPurpose) || null,
    live: s
      ? { status: s.status, statusUntil: s.statusUntil, statusAt: s.statusAt, stats: s.stats, startedAt: s.startedAt, endsAt: s.endsAt }
      : rs && rs.live
        ? rs.live
        : null,
  };
  if (full) {
    out.events = a.events.slice(-150).reverse();
    out.history = a.history.slice(-30).reverse();
    out.alerts = a.alerts.slice(-20).reverse().map(alertOut);
    out.screens = screensOf(a, here).slice(0, 12);
    out.persona = a.persona || null;
    out.proxyUrl = a.proxy || ''; // só no detalhe, para o seletor de proxy (o painel é local)
  }
  return out;
}

module.exports = { summarize, scheduleReason, alertOut, STATUS_FRESH_MS };
