// Estado do app em memória + gravação no Supabase.
// Contas, proxies e config ficam em tabelas com uma coluna JSON "data".
// Eventos, alertas e sessões ficam em tabelas próprias (events, alerts, sessions).
// Tudo é gravado em lote, 1,5 s depois da última mudança.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const rules = require('./rules');
const human = require('./human');

const DEFAULT_CONFIG = {
  active: false,
  start: '08:00',
  end: '22:00',
  max: 2,
  headless: false,
  muteAudio: true,
  pausedUntil: null, // férias: até quando (ms)
  pausedFrom: null, // férias: desde quando (ms)
  lastBackup: null, // { at, file, sizeMB, error, triedAt }
};
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
const KEEP = { events: 400, alerts: 100, history: 300 }; // quanto fica em memória por conta
const EVENTS_DAYS = 3; // eventos carregados ao abrir
const ALERTS_DAYS = 30; // alertas resolvidos carregados ao abrir (os abertos vêm todos)
const MAX_PENDING_EVENTS = 5000;

// Telas comuns de PC com Windows (1920x1080 é a mais comum). O navegador é o Edge do Windows e se
// apresenta como ele mesmo: nada de identidade inventada (user-agent), que não bate com o resto e denuncia robô.
const SCREENS = [
  { w: 1920, h: 1080 },
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 1536, h: 864 },
  { w: 1600, h: 900 },
];
const pickScreen = () => ({ ...SCREENS[Math.floor(Math.random() * SCREENS.length)] });
const isWindowsScreen = (v) => !!v && SCREENS.some((x) => x.w === v.w && x.h === v.h);

let sb = null;
let accounts = [];
let proxies = [];
let config = { ...DEFAULT_CONFIG };

// O que ainda não foi gravado
const dirty = { accounts: new Set(), proxies: false, config: false };
const deleted = { accounts: new Set(), proxies: new Set() };
const pending = { events: [], alerts: new Map(), sessions: [] };

// ---------- Conexão e leitura ----------

// O Supabase não lança exceção em erro: devolve { error }. Aqui o erro vira mensagem no terminal.
function check(label, r) {
  if (!r || !r.error) return true;
  const e = r.error;
  console.error(`❌ Supabase [${label}]: ${e.code || ''} ${e.message}${e.hint ? ` | dica: ${e.hint}` : ''}`);
  if (e.code === 'PGRST205' || e.code === '42P01') console.error('   → Falta uma tabela. Aplique as migrações de supabase/migrations.');
  if (e.code === 'PGRST204' || e.code === '42703') console.error('   → Falta uma coluna. Aplique as migrações de supabase/migrations.');
  if (e.code === '42501') console.error('   → Sem permissão. O .env precisa da chave secreta (sb_secret_...), não da anon.');
  return false;
}

function connect() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Faltam SUPABASE_URL e SUPABASE_KEY no .env (modelo em .env.example).');
  const payload = Buffer.from(SUPABASE_KEY.split('.')[1] || '', 'base64').toString();
  if (SUPABASE_KEY.startsWith('sb_publishable_') || /"role":"anon"/.test(payload)) {
    console.warn('⚠️  SUPABASE_KEY é a chave pública (anon). O banco está fechado para ela: use a chave secreta.');
  }
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// Lê tudo, de 1000 em 1000 (limite de linhas por pedido do Supabase)
async function fetchAll(build, label) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await build().range(from, from + 999);
    if (!check(`ler ${label}`, r)) throw new Error(`não foi possível ler ${label}`);
    out.push(...r.data);
    if (r.data.length < 1000) return out;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const dropNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// Linha do banco → objeto em memória. As listas antigas dentro do JSON (events, alerts, history)
// são ignoradas: agora moram nas tabelas próprias (a cópia original ficou na coluna "legacy").
function accountFromRow(row) {
  const { events, alerts, history, live, loginOpen, ...data } = row.data || {};
  return { ...data, id: row.id, platform: row.platform, username: row.username };
}
const eventFromRow = (r) => dropNulls({ t: Date.parse(r.t), kind: r.kind, action: r.action, level: r.level, msg: r.msg, detail: r.detail });
const alertFromRow = (r) => ({
  id: r.id,
  t: Date.parse(r.t),
  lastT: Date.parse(r.last_t),
  count: r.count,
  level: r.level,
  kind: r.kind,
  msg: r.msg,
  resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : null,
});
const sessionFromRow = (r) =>
  dropNulls({
    date: r.ended_at,
    startedAt: r.started_at,
    day: r.day,
    phase: r.phase,
    minutes: r.minutes == null ? 0 : Number(r.minutes),
    stats: r.stats || {},
    plan: r.plan,
    completion: r.completion == null ? 0 : Number(r.completion),
    result: r.result,
    error: r.error,
    screenshot: r.screenshot,
    timing: r.timing,
  });

function normalize(a) {
  a.platform = a.platform || 'instagram';
  a.interests = a.interests || [];
  a.daily = a.daily || {};
  a.startedAt = a.startedAt || new Date().toISOString();
  a.attention = a.attention || null;
  a.events = [];
  a.alerts = [];
  a.history = [];
  // Conta sem personalidade (criada antes dela existir): sorteia uma vez e grava
  if (!a.persona) {
    a.persona = human.makePersona();
    dirty.accounts.add(a.id);
  }
  // Tela da conta: sorteada uma vez entre as de PC com Windows (contas antigas podiam ter tela de Mac)
  if (!isWindowsScreen(a.viewport)) {
    a.viewport = pickScreen();
    dirty.accounts.add(a.id);
  }
  // Identidade inventada de navegador (antiga): sai; o Edge se apresenta como ele mesmo
  if (a.userAgent) {
    delete a.userAgent;
    dirty.accounts.add(a.id);
  }
}

async function init() {
  connect();
  console.log('🔄 Carregando dados do Supabase...');
  const evSince = iso(Date.now() - EVENTS_DAYS * 86400000);
  const alSince = iso(Date.now() - ALERTS_DAYS * 86400000);
  const [accRows, prxRows, cfg, evRows, alRows, seRows] = await Promise.all([
    fetchAll(() => sb.from('accounts').select('id, platform, username, data').order('id'), 'contas'),
    fetchAll(() => sb.from('proxies').select('id, url, status, ms, data').order('id'), 'proxies'),
    sb.from('config').select('data').eq('id', 'main').maybeSingle(),
    fetchAll(() => sb.from('events').select('*').gte('t', evSince).order('t').order('id'), 'eventos'),
    fetchAll(() => sb.from('alerts').select('*').or(`resolved_at.is.null,t.gte."${alSince}"`).order('t').order('id'), 'alertas'),
    fetchAll(() => sb.from('sessions').select('*').order('ended_at').order('id'), 'sessões'),
  ]);
  if (!check('ler config', cfg)) throw new Error('não foi possível ler a config');

  accounts = accRows.map(accountFromRow);
  accounts.forEach(normalize);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const r of evRows) byId.get(r.account_id)?.events.push(eventFromRow(r));
  for (const r of alRows) byId.get(r.account_id)?.alerts.push(alertFromRow(r));
  for (const r of seRows) byId.get(r.account_id)?.history.push(sessionFromRow(r));
  for (const a of accounts) {
    a.events = a.events.slice(-KEEP.events);
    a.alerts = a.alerts.slice(-KEEP.alerts);
    a.history = a.history.slice(-KEEP.history);
  }

  proxies = prxRows.map((r) => ({ ...(r.data || {}), id: r.id, url: r.url, status: r.status, ms: r.ms }));
  const saved = (cfg.data && cfg.data.data) || {};
  config = { ...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(saved).filter(([k]) => CONFIG_KEYS.includes(k))) };
  if (Object.keys(saved).some((k) => !CONFIG_KEYS.includes(k))) dirty.config = true; // limpa campos que não existem mais
  if (dirty.accounts.size || dirty.config) schedule();
  console.log(`✅ ${accounts.length} conta(s), ${proxies.length} proxy(s) carregados`);
}

// ---------- Gravação ----------

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}
function touch(id) {
  dirty.accounts.add(id);
  schedule();
}

let flushing = Promise.resolve();
function flush() {
  clearTimeout(timer);
  // Um save por vez: um save antigo nunca sobrescreve um mais novo
  flushing = flushing.then(doFlush, doFlush);
  return flushing;
}

function accountToRow(a) {
  const { live, loginOpen, id, platform, username, events, alerts, history, ...data } = a;
  return { id, platform, username, data };
}
const alertToRow = (x, accountId) => ({
  id: x.id,
  account_id: accountId,
  t: iso(x.t),
  last_t: iso(x.lastT),
  count: x.count,
  level: x.level,
  kind: x.kind,
  msg: x.msg,
  resolved_at: x.resolvedAt ? iso(x.resolvedAt) : null,
});

async function doFlush() {
  try {
    // 1) Apagados primeiro (o banco apaga em cascata eventos, alertas e sessões da conta)
    for (const [table, ids] of Object.entries(deleted)) {
      if (!ids.size) continue;
      const list = [...ids];
      if (check(`apagar ${table}`, await sb.from(table).delete().in('id', list))) list.forEach((i) => ids.delete(i));
    }
    // 2) Contas antes dos eventos (os eventos apontam para a conta)
    const accIds = [...dirty.accounts];
    dirty.accounts.clear();
    const rows = accounts.filter((a) => accIds.includes(a.id)).map(accountToRow);
    if (rows.length && !check('salvar contas', await sb.from('accounts').upsert(rows))) accIds.forEach((i) => dirty.accounts.add(i));

    if (dirty.proxies) {
      dirty.proxies = false;
      const prows = proxies.map(({ id, url, status, ms, ...rest }) => ({ id, url, status, ms, data: rest }));
      if (prows.length && !check('salvar proxies', await sb.from('proxies').upsert(prows))) dirty.proxies = true;
    }

    const alive = new Set(accounts.map((a) => a.id));
    const evs = pending.events.splice(0).filter((e) => alive.has(e.account_id));
    for (let i = 0; i < evs.length; i += 500) {
      if (!check('salvar eventos', await sb.from('events').insert(evs.slice(i, i + 500)))) {
        pending.events.unshift(...evs.slice(i));
        break;
      }
    }
    if (pending.events.length > MAX_PENDING_EVENTS) pending.events.splice(0, pending.events.length - MAX_PENDING_EVENTS);

    const als = [...pending.alerts.values()].filter((p) => alive.has(p.accountId));
    pending.alerts.clear();
    if (als.length && !check('salvar alertas', await sb.from('alerts').upsert(als.map((p) => alertToRow(p.alert, p.accountId))))) {
      als.forEach((p) => pending.alerts.set(p.alert.id, p));
    }

    const ses = pending.sessions.splice(0).filter((s) => alive.has(s.account_id));
    if (ses.length && !check('salvar sessões', await sb.from('sessions').insert(ses))) pending.sessions.unshift(...ses);

    if (dirty.config) {
      dirty.config = false;
      if (!check('salvar config', await sb.from('config').upsert({ id: 'main', data: config }))) dirty.config = true;
    }
  } catch (e) {
    console.error('Erro ao sincronizar com o Supabase:', e.message);
  }
}

const pendingCount = () =>
  dirty.accounts.size +
  (dirty.proxies ? 1 : 0) +
  (dirty.config ? 1 : 0) +
  pending.events.length +
  pending.alerts.size +
  pending.sessions.length;

// ---------- Contas ----------

const all = () => accounts;
const get = (id) => accounts.find((a) => a.id === id);
const dayOf = (a) => rules.dayOf(a);
const localDate = rules.localDate;

function todayOf(id) {
  const a = get(id);
  if (!a) return {};
  const k = rules.localDate();
  return (a.daily[k] = a.daily[k] || {});
}

// Plano do dia: sorteado uma vez por data e gravado
function planOf(a, gen) {
  const { plan, created } = rules.ensurePlan(a.daily, rules.localDate(), rules.dayOf(a), gen);
  if (created) touch(a.id);
  return plan;
}

// Rotina do dia (horários e tamanho de cada sessão), planejada uma vez por data.
// Só planeja depois que o plano do dia existe; nada antes de agora (motor ligado no meio do dia).
function slotsOf(a, gen) {
  const date = rules.localDate();
  const plan = planOf(a, gen);
  const { slots, created } = rules.ensureSlots(a.daily, date, () =>
    rules.planSlots({ date, window: rules.windowOf(a, config), persona: a.persona, planMinutes: plan.minutes, notBefore: Date.now() }),
  );
  if (created) touch(a.id);
  return slots;
}

// Último início de sessão de qualquer conta hoje (para contas não abrirem em horários casados)
function lastStartAny(running = []) {
  let last = 0;
  for (const a of accounts) {
    const h = a.history[a.history.length - 1];
    if (h && h.startedAt) last = Math.max(last, Date.parse(h.startedAt));
  }
  for (const t of running) last = Math.max(last, t);
  return last || null;
}

function pushEvent(a, ev) {
  const e = { t: Date.now(), ...ev };
  a.events.push(e);
  if (a.events.length > KEEP.events) a.events.splice(0, a.events.length - KEEP.events);
  pending.events.push({
    account_id: a.id,
    t: iso(e.t),
    kind: e.kind,
    action: e.action ?? null,
    level: e.level ?? null,
    msg: e.msg ?? null,
    detail: e.detail == null || e.detail === '' ? null : String(e.detail),
  });
  schedule();
}

function add(data) {
  const a = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    viewport: pickScreen(), // tela do PC desta conta (fixa)
    interests: [],
    daily: {},
    attention: null,
    persona: human.makePersona(), // jeito fixo desta conta (human.js)
    ...data,
    events: [],
    alerts: [],
    history: [],
  };
  accounts.push(a);
  touch(a.id);
  return a;
}

function remove(id) {
  accounts = accounts.filter((a) => a.id !== id);
  dirty.accounts.delete(id);
  deleted.accounts.add(id);
  pending.events = pending.events.filter((e) => e.account_id !== id);
  pending.sessions = pending.sessions.filter((s) => s.account_id !== id);
  for (const [k, p] of pending.alerts) if (p.accountId === id) pending.alerts.delete(k);
  schedule();
}

// Campos que você pode mudar depois do cadastro (proxy, interesses, janela de horário)
function updateAccount(id, patch) {
  const a = get(id);
  if (!a) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete a[k];
    else a[k] = v;
  }
  touch(id);
  return a;
}

function recordAction(id, action, detail = '') {
  const a = get(id);
  if (!a) return;
  const d = todayOf(id);
  d[action] = (d[action] || 0) + 1;
  pushEvent(a, { kind: 'action', action, detail });
  touch(id);
}

function addLog(id, msg, level = 'info') {
  const a = get(id);
  if (!a) return;
  pushEvent(a, { kind: 'log', msg, level });
}

// kind: login | captcha | block | error | other. Alerta igual em até 30 min soma no anterior.
function addAlert(id, level, msg, kind = rules.kindFromMsg(msg)) {
  const a = get(id);
  if (!a) return null;
  const now = Date.now();
  const { alert, merged } = rules.mergeAlert(a.alerts, {
    id: crypto.randomUUID(),
    t: now,
    lastT: now,
    count: 1,
    level,
    kind,
    msg,
    resolvedAt: null,
  });
  if (!merged) {
    a.alerts.push(alert);
    if (a.alerts.length > KEEP.alerts) a.alerts.shift();
    pushEvent(a, { kind: 'alert', level, msg });
  }
  pending.alerts.set(alert.id, { alert, accountId: id });
  schedule();
  return alert;
}

// A conta precisa de você (login, captcha ou bloqueio): o agendador não mexe nela até resolver
function setAttention(id, kind, msg) {
  const a = get(id);
  if (!a) return;
  a.attention = { kind, msg, at: Date.now() };
  touch(id);
}

// Resolve o aviso da conta e fecha os alertas abertos (todos ou só dos tipos indicados)
function clearAttention(id, note, kinds = null) {
  const a = get(id);
  if (!a) return false;
  const had = !!a.attention;
  if (!kinds || (a.attention && kinds.includes(a.attention.kind))) a.attention = null;
  const now = Date.now();
  for (const x of a.alerts) {
    if (x.resolvedAt || (kinds && !kinds.includes(x.kind))) continue;
    x.resolvedAt = now;
    pending.alerts.set(x.id, { alert: x, accountId: id });
  }
  if (note) addLog(id, note);
  touch(id);
  return had;
}

function addSession(id, session) {
  const a = get(id);
  if (!a) return;
  a.history.push(session);
  if (a.history.length > KEEP.history) a.history.shift();
  const d = todayOf(id);
  d.sessions = (d.sessions || 0) + 1;
  d.minutes = +((d.minutes || 0) + session.minutes).toFixed(1);
  a.nextAfter = rules.nextAfter(Date.parse(session.date));
  pending.sessions.push({
    account_id: id,
    started_at: session.startedAt || null,
    ended_at: session.date,
    day: session.day ?? null,
    phase: session.phase ?? null,
    minutes: session.minutes,
    stats: session.stats || {},
    plan: session.plan || null,
    completion: session.completion ?? null,
    result: session.result,
    error: session.error || null,
    screenshot: session.screenshot || null,
    timing: session.timing || null,
  });
  touch(id);
}

function recentEvents(limit = 60) {
  return accounts
    .flatMap((a) => a.events.slice(-limit).map((e) => ({ ...e, id: a.id, username: a.username, platform: a.platform })))
    .sort((x, y) => y.t - x.t)
    .slice(0, limit);
}

// ---------- Proxies e config ----------

const allProxies = () => proxies;
// Garante que o proxy de uma conta esteja na lista (para entrar no teste a cada 30 min)
function ensureProxy(url) {
  if (!url || proxies.some((p) => p.url === url)) return;
  addProxy(url);
}
function addProxy(url) {
  const p = { id: crypto.randomUUID(), url, status: 'unknown', ms: 0, lastCheck: null };
  proxies.push(p);
  dirty.proxies = true;
  schedule();
  return p;
}
function removeProxy(id) {
  proxies = proxies.filter((p) => p.id !== id);
  deleted.proxies.add(id);
  schedule();
}
function updateProxy(id, updates) {
  const p = proxies.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, updates);
  dirty.proxies = true;
  schedule();
}

const getConfig = () => config;

// ---------- Férias ----------

function startVacation(untilMs) {
  config = { ...config, pausedUntil: untilMs, pausedFrom: config.pausedFrom || Date.now() };
  dirty.config = true;
  schedule();
  return config;
}

// Fim das férias (na data marcada ou quando você volta antes): o aquecimento continua de onde parou.
// Cada conta anda o início para frente pelos dias inteiros de férias, e esses dias ficam marcados.
function endVacation(now = Date.now()) {
  if (!config.pausedUntil && !config.pausedFrom) return [];
  const days = config.pausedFrom ? rules.vacationDays(config.pausedFrom, now) : [];
  const moved = [];
  for (const a of accounts) {
    const { startedAt, skipped } = rules.shiftStart(a.startedAt, days);
    if (!skipped) continue;
    a.startedAt = startedAt;
    for (const d of days) if (!a.daily[d]) a.daily[d] = { vacation: true };
    addLog(a.id, `Voltou das férias: ${skipped} dia(s) parado(s). O aquecimento continua do dia ${rules.dayOf(a)}`);
    moved.push(a.id);
    touch(a.id);
  }
  config = { ...config, pausedUntil: null, pausedFrom: null };
  dirty.config = true;
  schedule();
  return moved;
}
function setConfig(next) {
  config = { ...config, ...next };
  dirty.config = true;
  schedule();
  return config;
}

module.exports = {
  init,
  flush,
  pendingCount,
  localDate,
  all,
  get,
  dayOf,
  todayOf,
  planOf,
  slotsOf,
  lastStartAny,
  add,
  remove,
  recordAction,
  addLog,
  addAlert,
  setAttention,
  clearAttention,
  addSession,
  recentEvents,
  allProxies,
  addProxy,
  removeProxy,
  updateProxy,
  getConfig,
  setConfig,
  updateAccount,
  ensureProxy,
  startVacation,
  endVacation,
};
