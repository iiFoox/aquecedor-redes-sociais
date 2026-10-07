const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./core/store');
const runner = require('./core/runner');
const platforms = require('./platforms');
const { PHASES, READY_DAY, phaseFor } = require('./platforms/phases');
const { computeHealth, completion } = require('./core/metrics');

const app = express();

// Senha do painel (opcional): PANEL_PASSWORD no .env. Usuário qualquer, senha = PANEL_PASSWORD
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
if (PANEL_PASSWORD) {
  const expected = Buffer.from(PANEL_PASSWORD);
  app.use((req, res, next) => {
    const [, b64 = ''] = (req.headers.authorization || '').split(' ');
    const pass = Buffer.from(Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':'));
    if (pass.length === expected.length && crypto.timingSafeEqual(pass, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WarmUp Studio"').status(401).send('Senha necessária');
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function summarize(a, full = false) {
  const p = platforms[a.platform];
  const day = store.dayOf(a);
  const s = runner.getSession(a.id);
  const out = {
    id: a.id,
    platform: a.platform,
    username: a.username,
    interests: a.interests,
    proxy: !!a.proxy,
    startedAt: a.startedAt,
    day,
    phase: phaseFor(day),
    plan: store.planOf(a, p.planForDay),
    today: a.daily[store.localDate()] || {},
    warmProgress: Math.min(100, Math.round(((day - 1) / (READY_DAY - 1)) * 100)),
    health: computeHealth(a),
    sessions: a.history.length,
    alerts: a.alerts.slice(-5).reverse(),
    loginOpen: runner.isLoginOpen(a.id),
    live: s
      ? { status: s.status, statusUntil: s.statusUntil, statusAt: s.statusAt, stats: s.stats, startedAt: s.startedAt, endsAt: s.endsAt }
      : null,
  };
  if (full) {
    out.events = a.events.slice(-150).reverse();
    out.history = a.history.slice(-30).reverse();
    out.daily = store.lastDays(a, 14);
    out.alerts = a.alerts.slice(-20).reverse();
  }
  return out;
}

const sse = (res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
};

app.get('/api/meta', (_, res) => {
  res.json({
    phases: PHASES,
    readyDay: READY_DAY,
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([k, p]) => [k, { name: p.name, actions: p.actions, plans: p.plans }])
    ),
  });
});

app.get('/api/accounts', (_, res) => res.json(store.all().map((a) => summarize(a))));

app.get('/api/accounts/:id', (req, res) => {
  const a = store.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json(summarize(a, true));
});

app.get('/api/feed', (_, res) => res.json(store.recentEvents(60)));

// ---------- API: PROXIES ----------
app.get('/api/proxies', (_, res) => res.json(store.allProxies()));

app.post('/api/proxies', (req, res) => {
  if (!req.body.url) return res.status(400).json({ error: 'URL é obrigatória' });
  res.json(store.addProxy(req.body.url.trim()));
});

app.delete('/api/proxies/:id', (req, res) => {
  store.removeProxy(req.params.id);
  res.json({ ok: true });
});

app.post('/api/proxies/:id/ping', async (req, res) => {
  const p = store.allProxies().find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Proxy não encontrado' });
  const result = await runner.pingProxy(p.url);
  store.updateProxy(p.id, { 
    status: result.ok ? 'online' : 'offline', 
    ms: result.ms, 
    lastCheck: Date.now() 
  });
  res.json(store.allProxies().find(x => x.id === req.params.id));
});

// ---------- API: CONFIG ----------
app.get('/api/config', (req, res) => res.json(store.getConfig()));
app.post('/api/config', (req, res) => res.json(store.setConfig(req.body)));

// ---------- API: ANALYTICS ----------
app.get('/api/analytics', (req, res) => {
  const accs = store.all();
  let totalMinutes = 0;
  let totalSessions = 0;
  let successSessions = 0;
  let blockedAccounts = 0;
  let activeNow = Object.keys(runner.activeSessions()).length;
  
  const days = {};
  for(let i=6; i>=0; i--) {
     const d = new Date(); d.setDate(d.getDate() - i);
     days[store.localDate(d)] = { minutes: 0, likes: 0, follows: 0 };
  }

  let platStats = { instagram: { accs: 0, minutes: 0 }, tiktok: { accs: 0, minutes: 0 } };

  for (const a of accs) {
    if (a.platform === 'instagram') platStats.instagram.accs++;
    if (a.platform === 'tiktok') platStats.tiktok.accs++;
    if (a.alerts && a.alerts.some(al => al.level === 'danger')) blockedAccounts++;

    totalSessions += (a.history || []).length;
    successSessions += (a.history || []).filter(s => (s.pct || 0) >= 90).length;

    for (const [date, metrics] of Object.entries(a.daily)) {
      totalMinutes += (metrics.minutes || 0);
      if (a.platform === 'instagram') platStats.instagram.minutes += (metrics.minutes || 0);
      if (a.platform === 'tiktok') platStats.tiktok.minutes += (metrics.minutes || 0);

      if (days[date]) {
         days[date].minutes += (metrics.minutes || 0);
         days[date].likes += (metrics.like || 0);
         days[date].follows += (metrics.follow || 0);
      }
    }
  }
  
  res.json({
    kpis: {
      totalAccounts: accs.length,
      blockedAccounts,
      activeNow,
      totalMinutes: totalMinutes.toFixed(1),
      totalSessions,
      successRate: totalSessions ? Math.round((successSessions / totalSessions) * 100) : 100
    },
    history: Object.keys(days).map(d => ({ date: d, ...days[d] })),
    platforms: platStats
  });
});

// ---------- API: ACCOUNTS ----------

app.post('/api/accounts', (req, res) => {
  const { platform = 'instagram', username, proxy, interests } = req.body;
  if (!platforms[platform]) return res.status(400).json({ error: 'Plataforma inválida' });
  if (!username || !username.trim()) return res.status(400).json({ error: 'Informe o usuário' });
  const acc = store.add({
    platform,
    username: username.replace('@', '').trim(),
    proxy: (proxy || '').trim(),
    interests: (interests || '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  store.addLog(acc.id, `Conta adicionada (${platforms[platform].name}). Dia 1 do aquecimento`);
  res.json(summarize(acc));
});

app.delete('/api/accounts/:id', async (req, res) => {
  runner.stopSession(req.params.id);
  await runner.closeLogin(req.params.id);
  store.remove(req.params.id);
  res.json({ ok: true });
});

app.post('/api/accounts/:id/login', async (req, res) => {
  const a = store.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Conta não encontrada' });
  try {
    await runner.openLogin(a);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/login/close', async (req, res) => {
  await runner.closeLogin(req.params.id);
  res.json({ ok: true });
});

app.post('/api/accounts/:id/start', async (req, res) => {
  const a = store.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Conta não encontrada' });
  try {
    await runner.startSession(a);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/stop', (req, res) => {
  runner.stopSession(req.params.id);
  res.json({ ok: true });
});

// Eventos em tempo real (status, ações, logs, alertas)
app.get('/api/stream', (req, res) => {
  sse(res);
  const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  runner.hub.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    runner.hub.off('event', on);
    clearInterval(ping);
  });
});

// Transmissão da tela do navegador de uma conta
app.get('/api/live/:id', (req, res) => {
  sse(res);
  const id = req.params.id;
  const last = runner.lastFrame(id);
  if (last) res.write(`data: ${last}\n\n`);
  const on = (fid, data) => fid === id && res.write(`data: ${data}\n\n`);
  runner.hub.on('frame', on);
  req.on('close', () => runner.hub.off('frame', on));
});

process.on('SIGINT', async () => {
  console.log('\n💾 Salvando no Supabase antes de sair...');
  // Espera as sessões fecharem e gravarem o histórico (até 20s) antes do último save
  await Promise.race([runner.closeAll(), new Promise((r) => setTimeout(r, 20000))]);
  await Promise.race([store.flush(), new Promise((r) => setTimeout(r, 8000))]);
  process.exit(0);
});

const PORT = process.env.PORT || 3001; // Trocado para 3001 para desviar de processos ocupando a porta 3000
store.init().then(() => {
  // Só nesta máquina por padrão. Para abrir na rede, HOST=0.0.0.0 no .env (e defina PANEL_PASSWORD)
  const HOST = process.env.HOST || '127.0.0.1';
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !PANEL_PASSWORD) {
    console.warn('⚠️  Painel aberto na rede SEM senha. Defina PANEL_PASSWORD no .env.');
  }
  app.listen(PORT, HOST, () => console.log(`🔥 WarmUp Studio em http://localhost:${PORT} (Supabase Sync ON)`));
}).catch(err => {
  console.error('Falha ao conectar no Supabase:', err);
  process.exit(1);
});

// ---------- SCHEDULER LOOP ----------
// Um ciclo pode levar mais de 60s (esperas entre contas): nunca roda dois ao mesmo tempo
let scheduling = false;
setInterval(async () => {
  if (scheduling) return;
  scheduling = true;
  try {
    await schedulerTick();
  } finally {
    scheduling = false;
  }
}, 60000);

async function schedulerTick() {
  const conf = store.getConfig();
  if (!conf.active) return;

  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  if (time < conf.start || time > conf.end) return;

  const activeCount = Object.keys(runner.activeSessions()).length;
  if (activeCount >= conf.max) return;

  const accounts = store.all();
  for (const acc of accounts) {
    if (Object.keys(runner.activeSessions()).length >= conf.max) break;
    if (runner.getSession(acc.id) || runner.isLoginOpen(acc.id)) continue;
    
    const p = platforms[acc.platform];
    if (!p) continue;
    const plan = store.planOf(acc, p.planForDay);
    if (completion(plan, store.todayOf(acc.id)) >= 1) continue; // Metas já batidas hoje

    // Intervalo mínimo de 45-90 min entre sessões da mesma conta (humano não abre o app sem parar)
    const lastS = acc.history && acc.history[acc.history.length - 1];
    if (lastS) {
      const endedAt = new Date(lastS.date).getTime();
      const gap = (45 + (acc.id.charCodeAt(0) % 45)) * 60000;
      if (Date.now() - endedAt < gap) continue;
    }

    if (acc.alerts && acc.alerts.some(a => a.level === 'danger' && a.t > Date.now() - 86400000)) continue; // Evita contas recém bloqueadas

    try {
      // Atraso randômico de 0 a 15s para quebrar a cadência cronometrada
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 15000))); 
      console.log(`[Scheduler] Iniciando ${acc.username} automaticamente`);
      await runner.startSession(acc);
      // Espera entre 15s a 35s orgânica antes de iniciar a próxima
      await new Promise(r => setTimeout(r, 15000 + Math.floor(Math.random() * 20000))); 
    } catch (e) {
      console.error(`[Scheduler] Erro em ${acc.username}:`, e.message);
    }
  }
}
