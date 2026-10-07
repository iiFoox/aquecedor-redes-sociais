// Onde o login do painel guarda as coisas.
// cloudStore: o de verdade. Usuários no Supabase Auth (chave PÚBLICA: entrar, criar conta, trocar e recuperar senha);
//   sessões do painel, registro de acessos e ajustes do painel em arquivos deste aparelho (data/painel/).
// memoryStore: igual, em memória, para os testes (não cria usuário de verdade).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('../motor/supabase-config');

const MAX_ATTEMPTS = 300; // acessos guardados

// Arquivo JSON deste aparelho (gravação atômica: escreve ao lado e troca)
function jsonFile(file, empty) {
  let cache = null;
  return {
    read() {
      if (cache) return cache;
      try {
        cache = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        cache = typeof empty === 'function' ? empty() : structuredClone(empty);
      }
      return cache;
    },
    write(v) {
      cache = v;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(v), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    },
  };
}

// Parte local (sessões, acessos, ajustes): igual nos dois stores
function localParts({ now, files }) {
  const sessions = files ? jsonFile(files.sessions, {}) : { v: {}, read: () => sessions.v, write: (x) => (sessions.v = x) };
  const attempts = files ? jsonFile(files.attempts, []) : { v: [], read: () => attempts.v, write: (x) => (attempts.v = x) };
  const settings = files
    ? jsonFile(files.settings, { signup: true })
    : { v: { signup: true }, read: () => settings.v, write: (x) => (settings.v = x) };
  return {
    // Para os testes: ver e limpar as sessões, ver os acessos
    _sessions: { keys: () => Object.keys(sessions.read()), clear: () => sessions.write({}) },
    _attempts: { list: () => attempts.read() },
    async insertSession(s) {
      const all = sessions.read();
      all[s.id] = s;
      sessions.write(all);
    },
    async getSession(id) {
      const s = sessions.read()[id];
      return s ? { ...s } : null;
    },
    async touchSession(id, lastSeen, expiresAt) {
      const all = sessions.read();
      if (all[id]) Object.assign(all[id], { lastSeen, expiresAt });
      sessions.write(all);
    },
    async deleteSession(id) {
      const all = sessions.read();
      delete all[id];
      sessions.write(all);
    },
    async deleteUserSessions(userId, exceptId = null) {
      const all = sessions.read();
      const t = now();
      for (const [id, s] of Object.entries(all)) if ((s.userId === userId && id !== exceptId) || s.expiresAt <= t) delete all[id];
      sessions.write(all);
    },
    async logAttempt(a) {
      const list = attempts.read();
      list.push({ ...a, t: a.t ?? now() });
      attempts.write(list.slice(-MAX_ATTEMPTS));
    },
    async failuresSince(ip, since) {
      return attempts
        .read()
        .filter((a) => a.ip === ip && a.reason === 'senha' && a.t >= since)
        .map((a) => a.t);
    },
    async recentAttempts(userId, email, n = 10) {
      return attempts
        .read()
        .filter((a) => a.userId === userId || (email && a.email === email))
        .slice(-n)
        .reverse()
        .map(({ t, ip, userAgent, ok, reason }) => ({ t, ip, userAgent, ok, reason }));
    },
    async getSettings() {
      return { signup: true, ...settings.read() };
    },
    async setSettings(patch) {
      settings.write({ ...settings.read(), ...patch });
    },
  };
}

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' } };
const sessionOut = (s) => (s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null);

function cloudStore({ dir, now = Date.now, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY }) {
  const pub = () => createClient(url, key, AUTH_OPTS);
  return {
    ...localParts({
      now,
      files: {
        sessions: path.join(dir, 'sessoes.json'),
        attempts: path.join(dir, 'acessos.json'),
        settings: path.join(dir, 'ajustes.json'),
      },
    }),
    // E-mail e senha certos: { id, email, session } (a sessão vai para o motor deste aparelho). Errados: null.
    async verify(email, password) {
      const { data, error } = await pub().auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email, session: sessionOut(data.session) };
    },
    // Cria no Supabase Auth. Com confirmação de e-mail ligada no Supabase, a sessão só vem depois de confirmar.
    async signup(email, password) {
      const { data, error } = await pub().auth.signUp({ email, password });
      if (error) return { error: /already|registered|exists/i.test(error.message) ? 'exists' : error.message };
      // Supabase devolve usuário "falso" (sem identidades) quando o e-mail já existe e a confirmação está ligada
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { error: 'exists' };
      return { id: data.user.id, email: data.user.email, session: sessionOut(data.session), needsConfirm: !data.session };
    },
    async changePassword(email, current, next) {
      const c = pub();
      const { data, error } = await c.auth.signInWithPassword({ email, password: current });
      if (error || !data.session) return false;
      const r = await c.auth.updateUser({ password: next });
      if (r.error) throw new Error(r.error.message);
      return true;
    },
    // "Esqueci a senha": o Supabase manda um link por e-mail que volta para redirectTo
    async sendReset(email, redirectTo) {
      const { error } = await pub().auth.resetPasswordForEmail(email, { redirectTo });
      if (error && !/rate|seconds/i.test(error.message)) throw new Error(error.message);
      if (error) throw Object.assign(new Error('Muitos pedidos seguidos. Espere um pouco e tente de novo.'), { status: 429 });
    },
    // Senha nova vinda do link do e-mail (tokens de recuperação)
    async resetWithTokens({ access_token, refresh_token }, password) {
      const c = pub();
      const s = await c.auth.setSession({ access_token, refresh_token });
      if (s.error || !s.data.user) return null;
      const r = await c.auth.updateUser({ password });
      if (r.error) throw new Error(r.error.message);
      return { id: s.data.user.id, email: s.data.user.email };
    },
    // O primeiro usuário do projeto fica com as contas antigas (sem dono). Para os outros não faz nada.
    async claimLegacy(session) {
      const c = pub();
      await c.auth.setSession(session);
      const { data, error } = await c.rpc('claim_legacy_accounts');
      if (error) throw new Error(error.message);
      return data || 0;
    },
  };
}

function memoryStore({ now = Date.now } = {}) {
  const users = new Map(); // email -> { id, email, password, confirmed }
  const orphans = { claimedBy: null };
  const tokens = new Map(); // token de recuperação -> email
  const fakeSession = (u) => ({ access_token: `acesso-${u.id}`, refresh_token: `renova-${u.id}` });
  const base = localParts({ now });
  return {
    ...base,
    _users: users,
    _orphans: orphans,
    _tokens: tokens,
    _confirm: false, // true = simula Supabase com confirmação de e-mail ligada
    async verify(email, password) {
      const u = users.get(email);
      if (!u || u.password !== password || !u.confirmed) return null;
      return { id: u.id, email, session: fakeSession(u) };
    },
    async signup(email, password) {
      if (users.has(email)) return { error: 'exists' };
      const u = { id: crypto.randomUUID(), email, password, confirmed: !this._confirm };
      users.set(email, u);
      return { id: u.id, email, session: u.confirmed ? fakeSession(u) : null, needsConfirm: !u.confirmed };
    },
    async changePassword(email, current, next) {
      const u = users.get(email);
      if (!u || u.password !== current) return false;
      u.password = next;
      return true;
    },
    async sendReset(email) {
      if (users.has(email)) tokens.set(`rec-${email}`, email);
    },
    async resetWithTokens({ access_token }, password) {
      const email = tokens.get(access_token);
      if (!email) return null;
      tokens.delete(access_token);
      const u = users.get(email);
      u.password = password;
      return { id: u.id, email };
    },
    async claimLegacy(session) {
      const first = [...users.values()][0];
      if (first && session.access_token === `acesso-${first.id}` && !orphans.claimedBy) orphans.claimedBy = first.id;
      return 0;
    },
  };
}

module.exports = { cloudStore, memoryStore };
