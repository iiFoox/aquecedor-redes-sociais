// Conexão do aparelho com o Supabase como o usuário dono (chave PÚBLICA + login do usuário; nada de chave secreta).
// - O login do aparelho (refresh token) fica em data/device-session.bin, protegido pelo Windows (DPAPI).
// - O aparelho tem um id fixo (data/device.json) e se registra na tabela devices com um nome.
// - A cada minuto avisa que está ligado (last_seen). Recebe comandos de outros aparelhos pelo tempo real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { createClient, isAuthRetryableFetchError } = require('@supabase/supabase-js');
const dpapi = require('./dpapi');
const { version } = require('../package.json');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('./supabase-config');

const { DATA } = require('./paths');
const SESSION_FILE = path.join(DATA, 'device-session.bin');
const DEVICE_FILE = path.join(DATA, 'device.json');
const HEARTBEAT_MS = 60000;
const ONLINE_MS = 3 * 60000; // sem sinal há 3 min = desligado

const hub = new EventEmitter();
let client = null;
let user = null; // { id, email }
let device = null; // { id, name }
let beat = null;
let lastOk = 0; // último sinal do aparelho que chegou no Supabase (motor/uptime.js: minuto com internet)
let commandsChannel = null;
// O login do aparelho caiu enquanto ele rodava (senha trocada, sessão encerrada): precisa entrar de novo no painel
let needsLogin = false;

const newClient = (autoRefreshToken = true) =>
  createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
}

function saveSession(session) {
  if (!session || !session.refresh_token) return;
  writeFile(SESSION_FILE, dpapi.protect(JSON.stringify({ refresh_token: session.refresh_token, user_id: session.user.id })));
}
function readSavedSession() {
  try {
    return JSON.parse(dpapi.unprotect(fs.readFileSync(SESSION_FILE, 'utf8')));
  } catch {
    return null;
  }
}

function watchAuth(c) {
  c.auth.onAuthStateChange((event, session) => {
    if (c !== client) return; // conexão antiga, já trocada
    // Token renovado: guarda o novo (o antigo deixa de valer). Tempo real usa o token novo.
    if (session && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
      saveSession(session);
      c.realtime.setAuth(session.access_token);
      if (needsLogin) {
        needsLogin = false;
        hub.emit('login', { needsLogin });
      }
    }
    // O Supabase recusou renovar o login (senha trocada ou sessão encerrada em outro lugar): o aparelho não
    // consegue mais falar com o banco. Avisa (painel e ícone do relógio) para você entrar de novo.
    if (event === 'SIGNED_OUT' && user && !needsLogin) {
      needsLogin = true;
      console.warn('⚠️  O login deste aparelho caiu (a senha foi trocada?). Entre de novo no painel para religar.');
      hub.emit('login', { needsLogin });
    }
  });
}

/**
 * Liga com o login salvo deste aparelho. Devolve:
 * 'ok' · 'nenhum' (ninguém entrou aqui ainda) · 'invalido' (o login salvo não vale mais: entre de novo) ·
 * 'sem-rede' (não deu para falar com o Supabase: tente de novo daqui a pouco, o login continua guardado)
 */
async function resume() {
  const saved = readSavedSession();
  if (!saved) return 'nenhum';
  const c = newClient();
  client = c;
  watchAuth(c);
  const { data, error } = await c.auth.refreshSession({ refresh_token: saved.refresh_token });
  if (error || !data.session) {
    client = null;
    c.auth.stopAutoRefresh();
    if (error && isAuthRetryableFetchError(error)) return 'sem-rede';
    needsLogin = true;
    console.warn(`⚠️  O login salvo deste aparelho não vale mais (${error ? error.message : 'sem sessão'}). Entre de novo no painel.`);
    return 'invalido';
  }
  saveSession(data.session);
  // O tempo real precisa do login do usuário (sem ele, as regras do banco não deixam passar nada)
  c.realtime.setAuth(data.session.access_token);
  user = { id: data.user.id, email: data.user.email };
  needsLogin = false;
  return 'ok';
}

// Login vindo do painel deste aparelho (depois que você entra). O aparelho fica ligado a esse usuário.
async function link({ access_token, refresh_token }) {
  // Confere o login com uma conexão que não renova sozinha (duas conexões renovando o mesmo login derrubam ele)
  const probe = newClient(false);
  const { data, error } = await probe.auth.setSession({ access_token, refresh_token });
  if (error || !data.user || !data.session) throw new Error(`Login inválido: ${error ? error.message : 'sem usuário'}`);
  if (user && user.id !== data.user.id)
    throw Object.assign(new Error('Este aparelho já está ligado a outro usuário'), { code: 'OTHER_USER' });
  const fresh = { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
  // Mesma pessoa entrando de novo: troca o login da conexão em uso (contas e canais continuam presos a ela).
  // Importante depois de trocar ou recuperar a senha: o Supabase derruba o login antigo do aparelho.
  if (user && client) {
    const r = await client.auth.setSession(fresh);
    if (r.error || !r.data.session) throw new Error(`Login inválido: ${r.error ? r.error.message : 'sem sessão'}`);
    saveSession(r.data.session);
    client.realtime.setAuth(r.data.session.access_token);
    const was = needsLogin;
    needsLogin = false;
    if (was) {
      console.log('🔑 Login do aparelho renovado');
      hub.emit('login', { needsLogin });
    }
    return { already: true };
  }
  const c = newClient();
  client = c;
  watchAuth(c);
  const r = await c.auth.setSession(fresh);
  if (r.error || !r.data.session) {
    client = null;
    throw new Error(`Login inválido: ${r.error ? r.error.message : 'sem sessão'}`);
  }
  c.realtime.setAuth(r.data.session.access_token);
  user = { id: data.user.id, email: data.user.email };
  needsLogin = false;
  saveSession(r.data.session);
  return { already: false };
}

// Registra (ou reencontra) este aparelho na tabela devices
async function ensureDevice() {
  const saved = readJson(DEVICE_FILE) || {};
  if (saved.id && saved.userId === user.id) {
    const { data } = await client.from('devices').select('id, name').eq('id', saved.id).maybeSingle();
    if (data) {
      device = { id: data.id, name: data.name, named: !!saved.named };
      return device;
    }
  }
  const name = (saved.userId === user.id && saved.name) || os.hostname() || 'Meu computador';
  const { data, error } = await client
    .from('devices')
    .insert({ name: name.slice(0, 60), app_version: version })
    .select('id, name')
    .single();
  if (error) throw new Error(`Não consegui registrar o aparelho: ${error.message}`);
  device = { id: data.id, name: data.name, named: false };
  writeFile(DEVICE_FILE, JSON.stringify({ id: device.id, name: device.name, userId: user.id }, null, 2));
  return device;
}

async function renameDevice(name) {
  const n = String(name || '')
    .trim()
    .slice(0, 60);
  if (!n) throw new Error('Dê um nome ao aparelho');
  const { error } = await client.from('devices').update({ name: n }).eq('id', device.id);
  if (error) throw new Error(error.message);
  device.name = n;
  device.named = true; // você escolheu o nome (a primeira abertura do app para de perguntar)
  writeFile(DEVICE_FILE, JSON.stringify({ id: device.id, name: n, userId: user.id, named: true }, null, 2));
  return device;
}

function startHeartbeat() {
  clearInterval(beat);
  const tick = () =>
    client
      .from('devices')
      .update({ last_seen: new Date().toISOString(), app_version: version })
      .eq('id', device.id)
      .then(({ error }) => {
        if (error) console.error(`⚠️  Sinal do aparelho: ${error.message}`);
        else lastOk = Date.now();
      });
  tick();
  beat = setInterval(tick, HEARTBEAT_MS);
}

// ---------- Comandos (de qualquer aparelho para o aparelho dono da conta) ----------

async function sendCommand(deviceId, kind, accountId = null, payload = {}) {
  const { data, error } = await client
    .from('commands')
    .insert({ device_id: deviceId, account_id: accountId, kind, payload })
    .select('id')
    .single();
  if (error) throw new Error(`Não consegui enviar o comando: ${error.message}`);
  return data.id;
}

async function finishCommand(id, err = null) {
  await client
    .from('commands')
    .update({ done_at: new Date().toISOString(), error: err ? String(err).slice(0, 500) : null })
    .eq('id', id);
}

// Recebe os comandos para este aparelho: os que ficaram na fila (aparelho estava desligado) e os novos, na hora
async function listenCommands(handler) {
  const take = async (cmd) => {
    if (cmd.device_id !== device.id || cmd.done_at || cmd.taken_at) return;
    // Marca como pego (só um executor por comando)
    const { data } = await client
      .from('commands')
      .update({ taken_at: new Date().toISOString() })
      .eq('id', cmd.id)
      .is('taken_at', null)
      .select('id');
    if (!data || !data.length) return;
    try {
      await handler(cmd);
      await finishCommand(cmd.id);
    } catch (e) {
      await finishCommand(cmd.id, e.message);
    }
  };
  if (commandsChannel) await client.removeChannel(commandsChannel);
  commandsChannel = client
    .channel(`commands-${device.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands', filter: `device_id=eq.${device.id}` }, (p) =>
      take(p.new),
    )
    .subscribe((status, err) => {
      // Canal fora do ar: avisa (o tempo real volta sozinho; enquanto isso, a releitura a cada 2 min cobre)
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`⚠️  Tempo real (%s): %s %s`, 'comandos', status, err ? err.message : '');
    });
  const { data } = await client
    .from('commands')
    .select('*')
    .eq('device_id', device.id)
    .is('done_at', null)
    .is('taken_at', null)
    .order('created_at');
  // Comandos velhos (mais de 10 min) não fazem mais sentido: fecham com aviso
  for (const c of data || []) {
    if (Date.now() - Date.parse(c.created_at) > 10 * 60000) await finishCommand(c.id, 'Expirou: o aparelho estava desligado');
    else await take(c);
  }
}

// Aparelhos do usuário (para mostrar onde cada conta roda)
async function listDevices() {
  const { data, error } = await client.from('devices').select('id, name, last_seen, app_version, created_at').order('created_at');
  if (error) throw new Error(error.message);
  return data.map((d) => ({
    id: d.id,
    name: d.name,
    lastSeen: Date.parse(d.last_seen),
    online: Date.now() - Date.parse(d.last_seen) < ONLINE_MS,
    appVersion: d.app_version,
    current: device && d.id === device.id,
  }));
}

module.exports = {
  hub,
  resume,
  link,
  ensureDevice,
  renameDevice,
  startHeartbeat,
  sendCommand,
  listenCommands,
  listDevices,
  client: () => client,
  user: () => user,
  device: () => device,
  ready: () => !!(client && user && device),
  needsLogin: () => needsLogin,
  lastBeatOk: () => lastOk,
  ONLINE_MS,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
};
