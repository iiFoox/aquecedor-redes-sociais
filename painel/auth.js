// Login do painel: sessões em cookie httpOnly, bloqueio por tentativas, conferência de origem (CSRF) e
// as rotas /auth/*. A proteção é aqui no servidor: sem sessão válida, nada do painel nem da API responde.
const crypto = require('crypto');
const express = require('express');
const cred = require('./credenciais');

const COOKIE = 'wu_sess';
const DAY = 24 * 60 * 60000;
const REMEMBER_MS = 30 * DAY; // "Manter conectado"
const SHORT_MS = 12 * 60 * 60000; // sem "Manter conectado": cookie some ao fechar o navegador; no servidor, 12 h sem uso
const TOUCH_EVERY = 10 * 60000; // grava o "último uso" no banco no máximo a cada 10 min
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60000;
const LOCK_MS = 15 * 60000;

const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');
const ipOf = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const isLoopback = (req) => ['127.0.0.1', '::1'].includes(ipOf(req));
const agentOf = (req) => String(req.headers['user-agent'] || '').slice(0, 300);

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Endereço deste painel: localhost, 127.0.0.1 ou um IP (rede de casa). Nome de outro site = truque de DNS: recusa.
function hostOk(host) {
  const name = String(host || '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '');
  return name === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name === '::1';
}

// Pedido que muda algo: tem de vir desta mesma página (Origin ou Referer com o mesmo endereço)
function sameOrigin(req) {
  const host = req.headers.host;
  const from = req.headers.origin || req.headers.referer;
  if (!from) return false;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

/**
 * store: authStore (supabaseStore ou memoryStore). now: relógio (os testes avançam o tempo).
 * secure: cookie só em https.
 */
function createAuth({ store, now = Date.now, secure = false }) {
  const cache = new Map(); // id (hash) -> sessão; evita ir ao banco a cada pedido

  function setCookie(res, code, persistent) {
    const parts = [`${COOKIE}=${code}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (secure) parts.push('Secure');
    if (persistent) parts.push(`Max-Age=${Math.floor(REMEMBER_MS / 1000)}`);
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  function clearCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
  }

  async function startSession(req, res, userId, persistent) {
    const code = crypto.randomBytes(32).toString('base64url');
    const t = now();
    const s = {
      id: hash(code),
      userId,
      persistent,
      lastSeen: t,
      expiresAt: t + (persistent ? REMEMBER_MS : SHORT_MS),
      ip: ipOf(req),
      userAgent: agentOf(req),
    };
    await store.insertSession(s);
    cache.set(s.id, s);
    setCookie(res, code, persistent);
    return s;
  }

  // Sessão do pedido (ou null). Renova o prazo com o uso (sem "Manter conectado": 12 h desde o último uso).
  async function sessionOf(req) {
    const code = readCookie(req, COOKIE);
    if (!code || code.length > 100) return null;
    const id = hash(code);
    let s = cache.get(id);
    if (!s) {
      s = await store.getSession(id).catch(() => null);
      if (!s) return null;
      cache.set(id, s);
    }
    const t = now();
    if (s.expiresAt <= t) {
      cache.delete(id);
      store.deleteSession(id).catch(() => {});
      return null;
    }
    if (t - s.lastSeen > TOUCH_EVERY) {
      s.lastSeen = t;
      s.expiresAt = t + (s.persistent ? REMEMBER_MS : SHORT_MS);
      store.touchSession(id, s.lastSeen, s.expiresAt).catch(() => {});
    }
    return s;
  }

  // Bloqueio: 5 erros de senha em 15 min deste IP = 15 min parado (conta a partir do 5º erro)
  async function lockedFor(ip) {
    const fails = await store.failuresSince(ip, now() - FAIL_WINDOW - LOCK_MS);
    const recent = fails.filter((t) => t >= now() - FAIL_WINDOW - LOCK_MS);
    for (let i = MAX_FAILS - 1; i < recent.length; i++) {
      const fifth = recent[i];
      if (fifth - recent[i - (MAX_FAILS - 1)] <= FAIL_WINDOW && fifth + LOCK_MS > now()) return fifth + LOCK_MS - now();
    }
    return 0;
  }

  const lockMsg = (ms) => {
    const min = Math.ceil(ms / 60000);
    return `Muitas tentativas. Tente de novo em ${min} min.`;
  };

  // ---------- Rotas /auth ----------
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));
  // Toda rota /auth que muda algo confere a origem
  router.use((req, res, next) => {
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Pedido de outra origem recusado' });
    next();
  });

  router.get('/estado', async (req, res) => {
    const settings = await store.getSettings().catch(() => ({ signup: true }));
    const s = await sessionOf(req);
    res.json({ logged: !!s, signup: !!settings.signup && isLoopback(req) });
  });

  router.post('/login', async (req, res) => {
    const ip = ipOf(req);
    const lock = await lockedFor(ip);
    if (lock > 0) {
      await store.logAttempt({ email: null, ip, userAgent: agentOf(req), ok: false, reason: 'bloqueado' });
      return res.status(429).json({ error: lockMsg(lock), retryAfter: Math.ceil(lock / 1000) });
    }
    const r = cred.login.safeParse(req.body || {});
    // Mensagem igual para e-mail e senha: não revela qual dos dois errou
    const wrong = async (email) => {
      await store.logAttempt({ email, ip, userAgent: agentOf(req), ok: false, reason: 'senha' });
      const after = await lockedFor(ip);
      if (after > 0) return res.status(429).json({ error: lockMsg(after), retryAfter: Math.ceil(after / 1000) });
      res.status(401).json({ error: 'E-mail ou senha incorretos' });
    };
    if (!r.success) return wrong(null);
    const userId = await store.verify(r.data.email, r.data.password).catch(() => null);
    if (!userId) return wrong(r.data.email);
    await startSession(req, res, userId, r.data.remember);
    await store.logAttempt({ email: r.data.email, userId, ip, userAgent: agentOf(req), ok: true, reason: 'ok' });
    res.json({ ok: true });
  });

  // Cadastro: só deste PC e com o cadastro liberado em Ajustes
  router.post('/cadastro', async (req, res) => {
    const ip = ipOf(req);
    const settings = await store.getSettings();
    if (!settings.signup || !isLoopback(req)) {
      await store.logAttempt({ email: null, ip, userAgent: agentOf(req), ok: false, reason: 'cadastro-recusado' });
      return res.status(403).json({ error: 'Cadastro fechado. Só dá para criar conta neste PC, com o cadastro liberado em Ajustes.' });
    }
    const r = cred.signup.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ error: cred.firstError(r) });
    const first = (await store.countUsers()) === 0;
    const u = await store.createUser(r.data.email, r.data.password);
    if (u.error === 'exists') return res.status(409).json({ error: 'Já existe uma conta com esse e-mail. Entre pelo login.' });
    if (u.error) return res.status(500).json({ error: `Não consegui criar a conta: ${u.error}` });
    if (first) await store.claimOrphans(u.id);
    await startSession(req, res, u.id, false);
    await store.logAttempt({ email: r.data.email, userId: u.id, ip, userAgent: agentOf(req), ok: true, reason: 'cadastro' });
    res.json({ ok: true, first });
  });

  // Daqui para baixo: só logado
  router.use(async (req, res, next) => {
    req.session = await sessionOf(req);
    if (!req.session) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.', auth: false });
    next();
  });

  router.get('/eu', async (req, res) => {
    const u = await store.user(req.session.userId);
    if (!u) return res.status(401).json({ error: 'Usuário não existe mais', auth: false });
    const settings = await store.getSettings();
    res.json({ id: u.id, email: u.email, signup: !!settings.signup, persistent: req.session.persistent });
  });

  router.post('/sair', async (req, res) => {
    cache.delete(req.session.id);
    await store.deleteSession(req.session.id);
    const u = await store.user(req.session.userId);
    await store.logAttempt({
      email: u && u.email,
      userId: req.session.userId,
      ip: ipOf(req),
      userAgent: agentOf(req),
      ok: true,
      reason: 'sair',
    });
    clearCookie(res);
    res.json({ ok: true });
  });

  router.post('/senha', async (req, res) => {
    const r = cred.change.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ error: cred.firstError(r) });
    const u = await store.user(req.session.userId);
    if (!u || !(await store.verify(u.email, r.data.current))) {
      await store.logAttempt({
        email: u && u.email,
        userId: req.session.userId,
        ip: ipOf(req),
        userAgent: agentOf(req),
        ok: false,
        reason: 'senha',
      });
      return res.status(400).json({ error: 'A senha atual não confere' });
    }
    await store.setPassword(u.id, r.data.password);
    // Senha nova: encerra as outras sessões (outros aparelhos); esta continua
    await store.deleteUserSessions(u.id, req.session.id);
    for (const [id, s] of cache) if (s.userId === u.id && id !== req.session.id) cache.delete(id);
    await store.logAttempt({ email: u.email, userId: u.id, ip: ipOf(req), userAgent: agentOf(req), ok: true, reason: 'troca-senha' });
    res.json({ ok: true });
  });

  router.get('/acessos', async (req, res) => {
    const u = await store.user(req.session.userId);
    res.json(await store.recentAttempts(req.session.userId, u ? u.email : '', 10));
  });

  router.put('/cadastro-liberado', async (req, res) => {
    const on = req.body && req.body.on;
    if (typeof on !== 'boolean') return res.status(400).json({ error: 'Informe on: true ou false' });
    await store.setSettings({ signup: on });
    res.json({ ok: true, signup: on });
  });

  // ---------- Proteção de tudo o resto ----------
  // publicPaths: o que abre sem login (tela de login e os arquivos dela)
  function guard({ publicPaths = new Set() } = {}) {
    return async (req, res, next) => {
      if (!hostOk(req.headers.host)) return res.status(403).send('Endereço não permitido');
      if (req.path.startsWith('/auth/') || publicPaths.has(req.path)) return next();
      const s = await sessionOf(req);
      if (!s) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.', auth: false });
        return res.redirect(302, '/login'); // o navegador mantém o #conta/... no endereço
      }
      // Ações na API: mesma origem (um site aberto em outra aba não consegue disparar nada)
      if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req))
        return res.status(403).json({ error: 'Pedido de outra origem recusado' });
      req.session = s;
      next();
    };
  }

  return { router, guard, sessionOf, COOKIE };
}

module.exports = { createAuth, hostOk, sameOrigin, readCookie, REMEMBER_MS, SHORT_MS, MAX_FAILS, LOCK_MS };
