// Estado do app em memória + gravação no Supabase, como o usuário dono (regras por dono no banco).
// Contas e proxies ficam em tabelas com uma coluna JSON "data"; eventos, alertas e sessões em tabelas próprias.
// Este aparelho carrega TODAS as contas do usuário, mas só roda e só grava as dele (device_id = este aparelho).
// As dos outros aparelhos chegam pelo tempo real (somente leitura aqui).
// Tudo é gravado em lote, 1,5 s depois da última mudança.
const crypto = require('crypto');
const EventEmitter = require('events');
const rules = require('./rules');
const human = require('./human');

// Configuração: piloto e férias valem para o usuário (todos os aparelhos); o resto é de cada aparelho.
const USER_KEYS = ['active', 'pausedUntil', 'pausedFrom', 'goalTemplates'];
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
  goalTemplates: [], // modelos de meta personalizada (motor/custom.js), de todos os aparelhos do usuário
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
let userId = null;
let deviceId = null; // null = sem aparelho (testes, simulador): todas as contas contam como deste aparelho
let channel = null;
const changes = new EventEmitter(); // mudanças vindas de outros aparelhos (o runner repassa ao painel)
let accounts = [];
let proxies = [];
let config = { ...DEFAULT_CONFIG };

// O que ainda não foi gravado
const dirty = { accounts: new Set(), proxies: false, config: false };
const deleted = { accounts: new Set(), proxies: new Set() };
const pending = { events: [], alerts: new Map(), sessions: [] };
const unsaved = new Set(); // contas cadastradas aqui que ainda não foram para o banco

// ---------- Conexão e leitura ----------

// O Supabase não lança exceção em erro: devolve { error }. Aqui o erro vira mensagem no terminal.
function check(label, r) {
  if (!r || !r.error) return true;
  const e = r.error;
  console.error(`❌ Supabase [${label}]: ${e.code || ''} ${e.message}${e.hint ? ` | dica: ${e.hint}` : ''}`);
  if (e.code === 'PGRST205' || e.code === '42P01') console.error('   → Falta uma tabela. Aplique as migrações de supabase/migrations.');
  if (e.code === 'PGRST204' || e.code === '42703') console.error('   → Falta uma coluna. Aplique as migrações de supabase/migrations.');
  if (e.code === '42501') console.error('   → Sem permissão: o registro não é deste usuário (regras por dono).');
  return false;
}

// Conta que roda neste aparelho (sem aparelho definido, todas)
const isMine = (a) => !deviceId || (a && a.deviceId === deviceId);
const mine = () => accounts.filter(isMine);

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
  const { events, alerts, history, live, loginOpen, ownerId, deviceId: _d, remoteStatus, lease: _l, ...data } = row.data || {};
  return {
    ...data,
    id: row.id,
    platform: row.platform,
    username: row.username,
    ownerId: row.owner_id || null,
    deviceId: row.device_id || null,
    remoteStatus: row.status || null, // o que o aparelho dono está fazendo agora (contas de outros aparelhos)
    // Trava: o aparelho que está com a conta aberta (sessão ou navegador) e até quando
    lease: row.lease_device ? { device: row.lease_device, until: row.lease_until ? Date.parse(row.lease_until) : 0 } : null,
  };
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
  // Só o aparelho dono ajeita e grava a conta (as dos outros aparelhos ficam como vieram)
  const fix = () => isMine(a) && dirty.accounts.add(a.id);
  // Conta sem personalidade (criada antes dela existir): sorteia uma vez e grava
  if (!a.persona) {
    a.persona = human.makePersona();
    fix();
  }
  // Tela da conta: sorteada uma vez entre as de PC com Windows (contas antigas podiam ter tela de Mac)
  if (!isWindowsScreen(a.viewport)) {
    a.viewport = pickScreen();
    fix();
  }
  // Identidade inventada de navegador (antiga): sai; o Edge se apresenta como ele mesmo
  if (a.userAgent) {
    delete a.userAgent;
    fix();
  }
}

// client: Supabase com o login do usuário (cloud.js). user/device: quem é o dono e qual é este aparelho.
async function init({ client, user, device }) {
  sb = client;
  userId = user.id;
  deviceId = device.id;
  console.log('🔄 Carregando dados do Supabase...');
  const evSince = iso(Date.now() - EVENTS_DAYS * 86400000);
  const alSince = iso(Date.now() - ALERTS_DAYS * 86400000);
  const [accRows, prxRows, cfg, evRows, alRows, seRows] = await Promise.all([
    fetchAll(
      () => sb.from('accounts').select('id, platform, username, data, owner_id, device_id, status, lease_device, lease_until').order('id'),
      'contas',
    ),
    fetchAll(() => sb.from('proxies').select('id, url, status, ms, data, owner_id').order('id'), 'proxies'),
    Promise.all([
      sb.from('user_config').select('data').maybeSingle(),
      sb.from('devices').select('config').eq('id', deviceId).maybeSingle(),
    ]).then(([u, d]) => ({
      error: u.error || d.error,
      data: { user: (u.data && u.data.data) || {}, device: (d.data && d.data.config) || {} },
    })),
    fetchAll(() => sb.from('events').select('*').gte('t', evSince).order('t').order('id'), 'eventos'),
    fetchAll(() => sb.from('alerts').select('*').or(`resolved_at.is.null,t.gte."${alSince}"`).order('t').order('id'), 'alertas'),
    fetchAll(() => sb.from('sessions').select('*').order('ended_at').order('id'), 'sessões'),
  ]);
  if (!check('ler configuração', cfg)) throw new Error('não foi possível ler a configuração');

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

  proxies = prxRows.map((r) => ({ ...(r.data || {}), id: r.id, url: r.url, status: r.status, ms: r.ms, ownerId: r.owner_id || null }));
  const saved = { ...cfg.data.device, ...cfg.data.user };
  config = { ...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(saved).filter(([k]) => CONFIG_KEYS.includes(k))) };
  if (dirty.accounts.size) schedule();
  subscribe();
  console.log(`✅ ${accounts.length} conta(s) (${mine().length} neste aparelho), ${proxies.length} proxy(s) carregados`);
}

// ---------- Tempo real: o que os outros aparelhos mudam ----------

function subscribe() {
  if (channel) sb.removeChannel(channel);
  const remote = (id) => {
    const a = get(id);
    return a && !isMine(a) ? a : null;
  };
  channel = sb
    .channel(`dados-${deviceId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, (p) => {
      if (p.eventType === 'DELETE') {
        const a = get(p.old.id);
        if (a && !isMine(a)) {
          accounts = accounts.filter((x) => x.id !== a.id);
          changes.emit('event', { type: 'remote', id: a.id });
        }
        return;
      }
      const row = p.new;
      const cur = get(row.id);
      const next = accountFromRow(row);
      if (cur && isMine(cur)) {
        // Conta deste aparelho: o que vem do banco é eco do que gravamos. Só importa se ela foi para outro aparelho.
        if (next.deviceId !== deviceId) {
          cur.deviceId = next.deviceId;
          changes.emit('lost', cur);
        }
        return;
      }
      if (cur) {
        Object.assign(cur, next, { events: cur.events, alerts: cur.alerts, history: cur.history });
        // Veio para este aparelho ("trazer a conta para cá" aceito pelo aparelho antigo)
        if (isMine(cur)) changes.emit('gained', cur);
      } else {
        const a = { ...next };
        normalize(a);
        accounts.push(a);
      }
      changes.emit('event', { type: 'remote', id: row.id });
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => {
      const a = remote(p.new.account_id);
      if (!a) return;
      const e = eventFromRow(p.new);
      a.events.push(e);
      if (a.events.length > KEEP.events) a.events.shift();
      if (e.kind === 'action') {
        const d = (a.daily[rules.localDate(new Date(e.t))] = a.daily[rules.localDate(new Date(e.t))] || {});
        d[e.action] = (d[e.action] || 0) + 1;
      }
      changes.emit('event', { type: e.kind, id: a.id, action: e.action, detail: e.detail, msg: e.msg, level: e.level, t: e.t });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, (p) => {
      if (p.eventType === 'DELETE') return;
      const a = remote(p.new.account_id);
      if (!a) return;
      const x = alertFromRow(p.new);
      const i = a.alerts.findIndex((y) => y.id === x.id);
      if (i >= 0) a.alerts[i] = x;
      else a.alerts.push(x);
      changes.emit('event', { type: 'remote', id: a.id });
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, (p) => {
      const a = remote(p.new.account_id);
      if (!a) return;
      a.history.push(sessionFromRow(p.new));
      if (a.history.length > KEEP.history) a.history.shift();
      changes.emit('event', { type: 'session', id: a.id, running: false });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proxies' }, () => changes.emit('event', { type: 'proxies' }))
    .subscribe((status, err) => {
      // Canal fora do ar: avisa (o tempo real volta sozinho; enquanto isso, a releitura a cada 2 min cobre)
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`⚠️  Tempo real (%s): %s %s`, 'dados', status, err ? err.message : '');
    });
}

// Relê as contas do banco (rede de segurança do tempo real, e quando as antigas ganham dono).
// As deste aparelho ficam como estão em memória (aqui é a fonte); as dos outros são atualizadas.
async function reloadAccounts() {
  if (!sb) return accounts.length;
  const rows = await fetchAll(
    () => sb.from('accounts').select('id, platform, username, data, owner_id, device_id, status, lease_device, lease_until').order('id'),
    'contas',
  );
  const seen = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    const cur = get(row.id);
    const next = accountFromRow(row);
    if (cur && isMine(cur)) continue;
    if (cur) Object.assign(cur, next, { events: cur.events, alerts: cur.alerts, history: cur.history });
    else {
      normalize(next);
      accounts.push(next);
    }
  }
  // Contas de outros aparelhos que não existem mais no banco
  accounts = accounts.filter((a) => isMine(a) || seen.has(a.id));
  return accounts.length;
}

// ---------- Gravação ----------

let timer = null;
function schedule() {
  if (!sb) return; // sem conexão (testes): nada para gravar
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}
function touch(id) {
  if (!isMine(get(id))) return; // conta de outro aparelho: quem grava é o dono dela
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

// owner_id só vai junto quando a conta tem dono: o dono de uma conta sem dono é gravado por fora
// (cadastro do 1º usuário ou "npm run usuario"), e o motor não pode sobrescrever com vazio.
function accountToRow(a) {
  const { live, loginOpen, id, platform, username, events, alerts, history, ownerId, deviceId: dev, remoteStatus, lease, ...data } = a;
  return { id, platform, username, data, owner_id: ownerId || userId, device_id: dev || deviceId };
}
const proxyToRow = ({ id, url, status, ms, ownerId, ...rest }) => ({ id, url, status, ms, data: rest, owner_id: ownerId || userId });
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
    // Só as contas deste aparelho (as dos outros são gravadas pelo aparelho dono delas)
    const mineDirty = accounts.filter((a) => accIds.includes(a.id) && isMine(a));
    const news = mineDirty.filter((a) => unsaved.has(a.id)).map(accountToRow);
    if (news.length) {
      if (check('salvar contas novas', await sb.from('accounts').upsert(news))) news.forEach((r) => unsaved.delete(r.id));
      else news.forEach((r) => dirty.accounts.add(r.id));
    }
    // Conta que já existe: só atualiza se ainda for deste aparelho no banco. Se outro aparelho levou a conta
    // (e o aviso ainda não chegou aqui), não escreve por cima nem puxa a conta de volta.
    for (const a of mineDirty.filter((x) => !news.some((r) => r.id === x.id))) {
      const { platform, username, data } = accountToRow(a);
      const r = await sb.from('accounts').update({ platform, username, data }).eq('id', a.id).eq('device_id', deviceId).select('id');
      if (!check('salvar conta', r)) dirty.accounts.add(a.id);
    }

    if (dirty.proxies) {
      dirty.proxies = false;
      const prows = proxies.map(proxyToRow);
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
      const part = (keys) => Object.fromEntries(Object.entries(config).filter(([k]) => keys(k)));
      const u = await sb
        .from('user_config')
        .upsert({ owner_id: userId, data: part((k) => USER_KEYS.includes(k)), updated_at: iso(Date.now()) });
      const d = await sb
        .from('devices')
        .update({ config: part((k) => !USER_KEYS.includes(k)) })
        .eq('id', deviceId);
      if (!check('salvar configuração', u) || !check('salvar configuração do aparelho', d)) dirty.config = true;
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

const templateById = (id) => (config.goalTemplates || []).find((t) => t.id === id) || null;

// Modelos de meta ficam numa lista só em user_config (todos os aparelhos). Para um aparelho que ainda não releu não
// apagar o modelo que outro acabou de gravar, cada mudança relê a lista do banco, aplica só a mudança dela e grava
// na hora (uma por vez). A releitura de 2 em 2 min espera enquanto há mudança daqui por gravar.
let tplChain = Promise.resolve();
let tplBusy = 0;
const labelsOf = (platform) => {
  const p = require('./platforms')[platform]; // aqui dentro: platforms carrega o bot, que não precisa do store
  return (p && p.actions) || {};
};
const fail400 = (msg) => Object.assign(new Error(msg), { status: 400 });
function editTemplates(change) {
  const job = async () => {
    tplBusy++;
    try {
      await reloadUserConfig({ force: true });
      const r = change(config.goalTemplates || []);
      setConfig({ goalTemplates: r.list });
      if (sb) await flush();
      return r.value;
    } finally {
      tplBusy--;
    }
  };
  const p = tplChain.then(job, job);
  tplChain = p.catch(() => {});
  return p;
}

// Contas deste aparelho que usam o modelo: plano de hoje de novo, com transição suave (custom.rampPlan), e o que
// mudou vai para o registro da conta
function templateChanged(before, t) {
  const diff = require('./custom').diffTemplate(before, t, labelsOf(t.platform));
  for (const a of mine().filter((x) => x.goalTemplate === t.id)) {
    resetToday(a, { ramp: true });
    if (before && diff.length)
      addLog(a.id, `Meta "${t.name}" editada: ${diff.slice(0, 6).join('; ')}${diff.length > 6 ? `; e mais ${diff.length - 6}` : ''}`);
  }
}

// Salva (cria ou troca) um modelo. Nome repetido na mesma plataforma é recusado.
function saveTemplate(t) {
  return editTemplates((list) => {
    const norm = (x) => x.trim().toLocaleLowerCase('pt-BR');
    if (list.some((x) => x.id !== t.id && x.platform === t.platform && norm(x.name) === norm(t.name)))
      throw fail400(`Já existe um modelo do ${t.platform === 'tiktok' ? 'TikTok' : 'Instagram'} chamado "${t.name}"`);
    const before = list.find((x) => x.id === t.id) || null;
    return { list: [...list.filter((x) => x.id !== t.id), t], value: before };
  }).then((before) => {
    templateChanged(before, t);
    return t;
  });
}
// Apaga um modelo: as contas que usavam voltam para a meta recomendada (sem modelo achado = recomendada)
function removeTemplate(id) {
  return editTemplates((list) => {
    if (!list.some((x) => x.id === id)) throw Object.assign(new Error('Modelo não encontrado'), { status: 404 });
    return { list: list.filter((x) => x.id !== id) };
  }).then(() => {
    for (const a of mine().filter((x) => x.goalTemplate === id)) {
      resetToday(a, { ramp: true });
      addLog(a.id, 'O modelo de meta foi apagado: meta recomendada de volta');
    }
  });
}
// Modelos mudados em outro aparelho (a cada 2 min e antes de cada mudança daqui): relê e refaz o plano de hoje das
// contas daqui cujo modelo mudou. Com mudança daqui ainda por gravar, espera (senão ela se perderia).
async function reloadUserConfig({ force = false } = {}) {
  if (!sb) return;
  if (!force && (tplBusy || dirty.config)) return;
  const { data, error } = await sb.from('user_config').select('data').maybeSingle();
  if (error) {
    if (force) throw Object.assign(new Error('Sem conexão com o servidor: tente de novo'), { status: 503 });
    return;
  }
  const next = (data && data.data && data.data.goalTemplates) || [];
  const was = new Map((config.goalTemplates || []).map((t) => [t.id, t]));
  const changed = next.filter((t) => JSON.stringify(t) !== JSON.stringify(was.get(t.id)));
  const gone = [...was.keys()].filter((id) => !next.some((t) => t.id === id));
  if (!changed.length && !gone.length) return;
  config = { ...config, goalTemplates: next };
  for (const t of changed) templateChanged(was.get(t.id) || null, t);
  for (const a of mine().filter((x) => x.goalTemplate && gone.includes(x.goalTemplate))) resetToday(a, { ramp: true });
}

// Modelo de meta personalizada da conta (da mesma plataforma) ou null: usa a meta recomendada
function templateOf(a) {
  if (!a || !a.goalTemplate) return null;
  return (config.goalTemplates || []).find((t) => t.id === a.goalTemplate && t.platform === a.platform) || null;
}
const readyDayOf = (a) => (templateOf(a) || {}).readyDay || 22;

// A meta da conta mudou (outro modelo, modelo editado): o plano e a rotina de HOJE são sorteados de novo com a meta
// nova. O que já foi feito hoje continua contando. ramp: liga a transição suave (custom.rampPlan) até a meta nova.
// A sessão que já está rodando continua com o plano do começo dela; a mudança vale a partir da próxima.
function resetToday(a, { ramp = false } = {}) {
  if (!a) return;
  if (ramp) {
    a.goalRamp = rules.localDate();
    touch(a.id);
  }
  const d = a.daily[rules.localDate()];
  if (!d) return;
  delete d.plan;
  delete d.slots;
  delete d.slotsFit;
  touch(a.id);
}

// Plano do dia: sorteado uma vez por data e gravado
// Follows pausados (o site não estava gravando): o follow sai do plano até a pausa acabar.
// Depois de trocar a meta (goalRamp), o plano passa pela transição suave (custom.withRamp).
function planOf(a, gen) {
  const t = templateOf(a);
  const today = rules.localDate();
  const make = (day) => require('./custom').withRamp(a, gen(day, Math.random, t), today);
  const { plan, created } = rules.ensurePlan(a.daily, today, rules.dayOf(a), make);
  const paused = rules.pauseFollows(plan, a.daily[rules.localDate()], a.followPauseUntil);
  if (created || paused) touch(a.id);
  return plan;
}

// Horas em que este aparelho costuma ficar ligado (motor/uptime.js, ligado no boot). Sem isso: null (não sabe).
let hoursOf = () => null;
const setHours = (fn) => {
  hoursOf = fn;
};

// Rotina do dia (horários e tamanho de cada sessão), planejada uma vez por data.
// Só planeja depois que o plano do dia existe; nada antes de agora (motor ligado no meio do dia).
// As sessões caem nas horas em que o aparelho costuma estar ligado. Rotina feita antes de saber essas horas (ou
// com sessões que ainda vão cair fora delas): planeja de novo o resto do dia, uma vez por dia.
function slotsOf(a, gen) {
  const date = rules.localDate();
  const plan = planOf(a, gen);
  const hours = hoursOf();
  const fresh = () =>
    rules.planSlots({
      date,
      window: rules.windowOf(a, config),
      persona: a.persona,
      planMinutes: plan.minutes,
      notBefore: Date.now(),
      onHours: hours,
    });
  const { slots, created } = rules.ensureSlots(a.daily, date, fresh);
  const d = a.daily[date];
  if (!created && !d.slotsFit && rules.slotsOffHours(slots, d.sessions || 0, hours)) {
    d.slots = rules.replanRest(slots, d.sessions || 0, fresh());
    d.slotsFit = true;
    touch(a.id);
    return d.slots;
  }
  if (created) touch(a.id);
  return slots;
}

// Último início de sessão de qualquer conta deste aparelho hoje (para contas não abrirem em horários casados)
function lastStartAny(running = []) {
  let last = 0;
  for (const a of mine()) {
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
    ownerId: userId,
    deviceId, // a conta roda no aparelho em que foi cadastrada
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
  unsaved.add(a.id);
  touch(a.id);
  return a;
}

function remove(id) {
  accounts = accounts.filter((a) => a.id !== id);
  unsaved.delete(id);
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

function recentEvents(limit = 60, userId = undefined) {
  return (userId === undefined ? accounts : accountsOf(userId))
    .flatMap((a) => a.events.slice(-limit).map((e) => ({ ...e, id: a.id, username: a.username, platform: a.platform })))
    .sort((x, y) => y.t - x.t)
    .slice(0, limit);
}

// ---------- Proxies e config ----------

const allProxies = () => proxies;
// Garante que o proxy de uma conta esteja na lista (para entrar no teste a cada 30 min)
function ensureProxy(url, ownerId = null) {
  if (!url || proxies.some((p) => p.url === url)) return;
  addProxy(url, ownerId);
}
function addProxy(url, ownerId = null) {
  const p = { id: crypto.randomUUID(), url, status: 'unknown', ms: 0, lastCheck: null, ownerId };
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

// ---------- Dono e aparelho ----------

// Contas e proxies do usuário (sem aparelho definido, testes: filtra pelo dono gravado em memória)
const accountsOf = (uid) => accounts.filter((a) => a.ownerId && a.ownerId === uid);
const proxiesOf = (uid) => proxies.filter((p) => p.ownerId && p.ownerId === uid);
const ownsAccount = (uid, id) => {
  const a = get(id);
  return !!(a && a.ownerId && a.ownerId === uid);
};

// Some da memória sem apagar do banco (conta apagada direto no banco, ou que deixou de ser visível)
function forget(id) {
  accounts = accounts.filter((a) => a.id !== id);
  dirty.accounts.delete(id);
}

// "Rodar neste aparelho": a conta passa a ser deste aparelho (grava o device_id; o login vem na etapa dos logins)
async function claimAccount(id) {
  const a = get(id);
  if (!a) return null;
  a.deviceId = deviceId;
  if (sb) {
    const r = await sb.from('accounts').update({ device_id: deviceId }).eq('id', id);
    if (!check('trazer a conta', r)) throw new Error('Não consegui trazer a conta para este aparelho');
  }
  touch(id);
  return a;
}

// ---------- Trava (uma conta nunca roda em dois aparelhos) ----------
// Pegar a trava é uma operação só no banco: só passa se a conta é deste aparelho e nenhum outro aparelho está
// com uma trava ainda válida. Sem internet, não passa (não abre nada sem ter certeza).
async function takeLease(id) {
  if (!sb || !deviceId) return true; // testes e simulador
  const now = new Date();
  const r = await sb
    .from('accounts')
    .update({ lease_device: deviceId, lease_until: iso(now.getTime() + rules.LEASE_MS) })
    .eq('id', id)
    .eq('device_id', deviceId)
    .or(`lease_device.is.null,lease_until.is.null,lease_until.lt."${now.toISOString()}",lease_device.eq.${deviceId}`)
    .select('id');
  if (r.error) throw new Error(`Sem conexão com o Supabase para travar a conta: ${r.error.message}`);
  if (!r.data.length) return false;
  const a = get(id);
  if (a) a.lease = { device: deviceId, until: now.getTime() + rules.LEASE_MS };
  return true;
}

// Renova a trava das contas abertas aqui (a cada minuto). Devolve as que perderam a trava (ficou sem internet mais
// que o prazo e outro aparelho pegou a conta): essas têm de parar aqui. Sem internet, não devolve nenhuma.
async function renewLeases(ids) {
  if (!sb || !deviceId || !ids.length) return [];
  const until = Date.now() + rules.LEASE_MS;
  const r = await sb
    .from('accounts')
    .update({ lease_until: iso(until) })
    .in('id', ids)
    .eq('lease_device', deviceId)
    .eq('device_id', deviceId)
    .select('id');
  if (!check('renovar a trava', r)) return [];
  const kept = new Set(r.data.map((x) => x.id));
  for (const id of kept) if (get(id)) get(id).lease = { device: deviceId, until };
  return ids.filter((id) => !kept.has(id));
}

// Solta a trava (sessão e navegador fechados)
async function dropLease(id) {
  const a = get(id);
  if (a) a.lease = null;
  if (!sb || !deviceId) return;
  await sb.from('accounts').update({ lease_device: null, lease_until: null }).eq('id', id).eq('lease_device', deviceId);
}

// Conta deste aparelho vai para outro (o outro aparelho pediu): só troca o device_id; quem roda passa a ser o outro
async function releaseAccount(id, toDevice) {
  const a = get(id);
  if (!a) return;
  await flush();
  a.deviceId = toDevice;
  if (sb) await sb.from('accounts').update({ device_id: toDevice, lease_device: null, lease_until: null }).eq('id', id);
}

// O que o robô está fazendo agora na conta (os outros aparelhos leem da coluna status)
async function publishStatus(id, status) {
  if (!sb || !isMine(get(id))) return;
  const r = await sb.from('accounts').update({ status }).eq('id', id);
  check('publicar o status', r);
}

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
  for (const a of mine()) {
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

// Só para os testes: um banco falso no lugar do Supabase, sem carregar nada (tests/metas-aparelhos.test.js)
function _useClient(client, { user = 'u1', device = null } = {}) {
  sb = client;
  userId = user;
  deviceId = device;
}

module.exports = {
  _useClient,
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
  templateOf,
  templateById,
  saveTemplate,
  removeTemplate,
  reloadUserConfig,
  readyDayOf,
  resetToday,
  setHours,
  hours: () => hoursOf(),
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
  reloadAccounts,
  claimAccount,
  takeLease,
  renewLeases,
  dropLease,
  releaseAccount,
  forget,
  publishStatus,
  isMine,
  mine,
  changes,
  deviceId: () => deviceId,
  userId: () => userId,
  accountsOf,
  proxiesOf,
  ownsAccount,
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
