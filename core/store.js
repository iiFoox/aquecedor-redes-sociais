const { createClient } = require('@supabase/supabase-js');

// Credenciais ficam no .env (fora do Git). Modelo em .env.example.
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch {}
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Faltam SUPABASE_URL e SUPABASE_KEY. Copie .env.example para .env e preencha.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE');

let accounts = [];
let proxies = [];
let config = { active: false, start: '08:00', end: '22:00', max: 2, headless: false, muteAudio: true };

// O Supabase NÃO lança exceção em erro: ele devolve { error }. Antes isso era ignorado
// e todo save falhava calado (por isso as contas sumiam ao reiniciar).
function check(label, r) {
  if (r && r.error) {
    const e = r.error;
    console.error(`❌ Supabase [${label}]: ${e.code || ''} ${e.message}${e.hint ? ` | dica: ${e.hint}` : ''}`);
    if (e.code === 'PGRST204' || e.code === '42703') {
      console.error('   → Falta a coluna "data" (jsonb). Rode o SQL de setup/supabase.sql no SQL Editor do Supabase.');
    }
    if (e.code === '42501') {
      console.error('   → RLS bloqueando. Rode o SQL de setup/supabase.sql (cria as policies).');
    }
    return false;
  }
  return true;
}

// Linha do banco -> objeto em memória (colunas antigas + tudo que está em "data")
const fromRow = (row) => {
  const { data, ...cols } = row;
  const out = { ...cols, ...(data || {}) };
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
};

async function init() {
  console.log('🔄 Sincronizando com Supabase...');
  const [acc, prx, cfg] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase.from('proxies').select('*'),
    supabase.from('config').select('*').eq('id', 'main').maybeSingle()
  ]);
  check('ler accounts', acc);
  check('ler proxies', prx);
  check('ler config', cfg);
  
  if (acc.data) accounts = acc.data.map(fromRow);
  if (prx.data) proxies = prx.data.map(fromRow);
  if (cfg.data && cfg.data.data) config = { ...config, ...cfg.data.data };

  // Teste de escrita: garante que o schema aceita o formato que o app grava
  const probe = await supabase.from('accounts').select('data').limit(1);
  if (!check('schema accounts.data', probe)) {
    console.error('⚠️  ATENÇÃO: as contas NÃO serão salvas até o schema ser corrigido.');
  }

  // Array de devices para backfill
  const devices = [
    { w: 1920, h: 1080, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36' },
    { w: 1366, h: 768, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36' },
    { w: 1536, h: 864, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.46' },
    { w: 1440, h: 900, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36' },
    { w: 1280, h: 800, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36' }
  ];

  for (const a of accounts) {
    a.platform = a.platform || 'instagram';
    a.interests = a.interests || [];
    a.history = a.history || [];
    a.daily = a.daily || {};
    a.events = a.events || [];
    a.alerts = a.alerts || [];
    a.startedAt = a.startedAt || new Date().toISOString();
    
    // Backfill (Correção) para Contas Antigas do BD: Dá um hardware fixo pra elas não rodarem 1280x800 genérico
    if (!a.viewport || !a.userAgent) {
      const dev = devices[Math.floor(Math.random() * devices.length)];
      a.viewport = { w: dev.w, h: dev.h };
      a.userAgent = dev.ua;
    }
  }
  console.log(`✅ Sincronização Supabase concluída! (${accounts.length} conta(s), ${proxies.length} proxy(s))`);
}

let timer = null;
const deleted = { accounts: new Set(), proxies: new Set() };
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 1500); // Write-Through Cache
}

let flushing = Promise.resolve();
function flush() {
  clearTimeout(timer);
  // Serializa os flushes pra um save antigo nunca sobrescrever um mais novo
  flushing = flushing.then(doFlush, doFlush);
  return flushing;
}

async function doFlush() {
  try {
    if (accounts.length) {
      // Colunas fixas + todo o resto em "data" (jsonb): nunca mais quebra por coluna faltando
      const rows = accounts.map((a) => {
        const { live, loginOpen, id, platform, username, ...rest } = a;
        return { id, platform, username, data: rest };
      });
      check('salvar accounts', await supabase.from('accounts').upsert(rows));
    }
    if (proxies.length) {
      const rows = proxies.map(({ id, url, status, ms, ...rest }) => ({ id, url, status, ms, data: rest }));
      check('salvar proxies', await supabase.from('proxies').upsert(rows));
    }
    for (const [table, ids] of Object.entries(deleted)) {
      if (!ids.size) continue;
      const list = [...ids];
      if (check(`apagar ${table}`, await supabase.from(table).delete().in('id', list))) list.forEach((i) => ids.delete(i));
    }
    check('salvar config', await supabase.from('config').upsert({ id: 'main', data: config }));
  } catch (e) {
    console.error('Erro ao sincronizar dados com Supabase:', e.message);
  }
}

const all = () => accounts;
const get = (id) => accounts.find((a) => a.id === id);
const dayOf = (a) => Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 86400000) + 1;

function todayOf(id) {
  const a = get(id);
  if (!a) return {};
  const k = localDate();
  return (a.daily[k] = a.daily[k] || {});
}

// Plano do dia é sorteado UMA vez e fica gravado. Antes era re-sorteado a cada
// sessão/refresh do painel, então a meta "mudava" no meio do dia.
function planOf(a, gen) {
  const d = todayOf(a.id);
  if (!d.plan) {
    d.plan = gen(dayOf(a));
    persist();
  }
  return d.plan;
}

function pushEvent(a, ev) {
  a.events.push({ t: Date.now(), ...ev });
  if (a.events.length > 400) a.events.splice(0, a.events.length - 400);
}

function add(data) {
  // Resoluções reais pareadas obrigatoriamente com o Sistema Operacional correto (Ex: 1440x900 é exclusivo Apple)
  const devices = [
    { w: 1920, h: 1080, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36' },
    { w: 1366, h: 768, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36' },
    { w: 1536, h: 864, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.46' },
    { w: 1440, h: 900, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36' },
    { w: 1280, h: 800, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36' }
  ];
  const dev = devices[Math.floor(Math.random() * devices.length)];
  const a = {
    id: Date.now().toString(36),
    startedAt: new Date().toISOString(),
    viewport: { w: dev.w, h: dev.h },
    userAgent: dev.ua,
    interests: [],
    history: [],
    daily: {},
    events: [],
    alerts: [],
    ...data,
  };
  accounts.push(a);
  persist();
  return a;
}

function remove(id) {
  accounts = accounts.filter((a) => a.id !== id);
  deleted.accounts.add(id);
  persist();
}

function recordAction(id, action, detail = '') {
  const a = get(id);
  if (!a) return;
  const d = todayOf(id);
  d[action] = (d[action] || 0) + 1;
  pushEvent(a, { kind: 'action', action, detail });
  persist();
}

function addLog(id, msg, level = 'info') {
  const a = get(id);
  if (!a) return;
  pushEvent(a, { kind: 'log', msg, level });
  persist();
}

function addAlert(id, level, msg) {
  const a = get(id);
  if (!a) return;
  a.alerts.push({ t: Date.now(), level, msg });
  if (a.alerts.length > 100) a.alerts.shift();
  pushEvent(a, { kind: 'alert', level, msg });
  persist();
}

function addSession(id, session) {
  const a = get(id);
  if (!a) return;
  a.history.push(session);
  if (a.history.length > 300) a.history.shift();
  const d = todayOf(id);
  d.sessions = (d.sessions || 0) + 1;
  d.minutes = +((d.minutes || 0) + session.minutes).toFixed(1);
  persist();
}

function lastDays(a, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = localDate(new Date(Date.now() - i * 86400000));
    out.push({ date, ...(a.daily[date] || {}) });
  }
  return out;
}

function recentEvents(limit = 60) {
  return accounts
    .flatMap((a) => a.events.slice(-limit).map((e) => ({ ...e, id: a.id, username: a.username, platform: a.platform })))
    .sort((x, y) => y.t - x.t)
    .slice(0, limit);
}

const allProxies = () => proxies;
function addProxy(url) {
  const p = { id: Date.now().toString(36), url, status: 'unknown', ms: 0, lastCheck: null };
  proxies.push(p);
  persist();
  return p;
}
function removeProxy(id) {
  proxies = proxies.filter(p => p.id !== id);
  deleted.proxies.add(id);
  persist();
}
function updateProxy(id, updates) {
  const p = proxies.find(x => x.id === id);
  if (p) { Object.assign(p, updates); persist(); }
}

const getConfig = () => config;
function setConfig(newConf) {
  config = { ...config, ...newConf };
  persist();
  return config;
}

module.exports = {
  init, localDate, all, get, dayOf, todayOf, planOf, add, remove,
  recordAction, addLog, addAlert, addSession, lastDays, recentEvents, flush,
  allProxies, addProxy, removeProxy, updateProxy, getConfig, setConfig
};
