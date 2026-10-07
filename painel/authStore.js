// Onde o login guarda as coisas. supabaseStore: o de verdade (Supabase Auth + tabelas panel_sessions e
// login_attempts + config "painel"). memoryStore: igual, em memória, para os testes (não cria usuário de verdade).
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function supabaseStore({ url, key }) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const sb = createClient(url, key, opts);
  const fail = (what, error) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    // Confere e-mail e senha no Supabase Auth. Devolve o id do usuário ou null. Os tokens do Supabase são descartados:
    // quem segura o login é a sessão do painel (cookie httpOnly).
    async verify(email, password) {
      const c = createClient(url, key, opts);
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return data.user.id;
    },
    async createUser(email, password) {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return { error: /already|registered|exists/i.test(error.message) ? 'exists' : error.message };
      return { id: data.user.id };
    },
    async setPassword(userId, password) {
      const { error } = await sb.auth.admin.updateUserById(userId, { password });
      fail('trocar a senha', error);
    },
    async user(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email };
    },
    async countUsers() {
      const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
      fail('contar usuários', error);
      return data.total ?? data.users.length;
    },
    // Primeiro usuário: fica com as contas e proxies que já existiam (sem dono)
    async claimOrphans(userId) {
      const a = await sb.from('accounts').update({ owner_id: userId }).is('owner_id', null);
      fail('passar as contas', a.error);
      const p = await sb.from('proxies').update({ owner_id: userId }).is('owner_id', null);
      fail('passar os proxies', p.error);
    },
    async insertSession(s) {
      const { error } = await sb.from('panel_sessions').insert({
        id: s.id,
        user_id: s.userId,
        expires_at: new Date(s.expiresAt).toISOString(),
        last_seen: new Date(s.lastSeen).toISOString(),
        persistent: s.persistent,
        ip: s.ip,
        user_agent: s.userAgent,
      });
      fail('gravar a sessão', error);
    },
    async getSession(id) {
      const { data, error } = await sb.from('panel_sessions').select('*').eq('id', id).maybeSingle();
      fail('ler a sessão', error);
      if (!data) return null;
      return {
        id: data.id,
        userId: data.user_id,
        expiresAt: Date.parse(data.expires_at),
        lastSeen: Date.parse(data.last_seen),
        persistent: data.persistent,
      };
    },
    async touchSession(id, lastSeen, expiresAt) {
      const { error } = await sb
        .from('panel_sessions')
        .update({ last_seen: new Date(lastSeen).toISOString(), expires_at: new Date(expiresAt).toISOString() })
        .eq('id', id);
      fail('renovar a sessão', error);
    },
    async deleteSession(id) {
      fail('encerrar a sessão', (await sb.from('panel_sessions').delete().eq('id', id)).error);
    },
    async deleteUserSessions(userId, exceptId = null) {
      let q = sb.from('panel_sessions').delete().eq('user_id', userId);
      if (exceptId) q = q.neq('id', exceptId);
      fail('encerrar as sessões', (await q).error);
      // Faxina: sessões vencidas de todo mundo
      await sb.from('panel_sessions').delete().lt('expires_at', new Date().toISOString());
    },
    async logAttempt(a) {
      const { error } = await sb.from('login_attempts').insert({
        ...(a.t ? { t: new Date(a.t).toISOString() } : {}),
        email: a.email || null,
        user_id: a.userId || null,
        ip: a.ip || null,
        user_agent: a.userAgent || null,
        ok: a.ok,
        reason: a.reason,
      });
      if (error) console.error(`⚠️  Não consegui registrar o acesso: ${error.message}`);
    },
    // Erros de senha deste IP desde `since` (ms), do mais antigo para o mais novo
    async failuresSince(ip, since) {
      const { data, error } = await sb
        .from('login_attempts')
        .select('t')
        .eq('ip', ip)
        .eq('reason', 'senha')
        .gte('t', new Date(since).toISOString())
        .order('t', { ascending: true });
      fail('ler as tentativas', error);
      return data.map((r) => Date.parse(r.t));
    },
    // Acessos deste usuário: os dele e as tentativas erradas com o e-mail dele (alguém tentando entrar).
    // Duas consultas em vez de um filtro "or" montado com texto (nada do usuário vira parte da consulta).
    async recentAttempts(userId, email, n = 10) {
      const cols = 'id, t, ip, user_agent, ok, reason';
      const [a, b] = await Promise.all([
        sb.from('login_attempts').select(cols).eq('user_id', userId).order('t', { ascending: false }).limit(n),
        sb.from('login_attempts').select(cols).eq('email', email).order('t', { ascending: false }).limit(n),
      ]);
      fail('ler os acessos', a.error || b.error);
      const rows = new Map([...a.data, ...b.data].map((r) => [r.id, r]));
      return [...rows.values()]
        .sort((x, y) => Date.parse(y.t) - Date.parse(x.t))
        .slice(0, n)
        .map((r) => ({ t: Date.parse(r.t), ip: r.ip, userAgent: r.user_agent, ok: r.ok, reason: r.reason }));
    },
    async getSettings() {
      const { data, error } = await sb.from('config').select('data').eq('id', 'painel').maybeSingle();
      fail('ler os ajustes do painel', error);
      return { signup: true, ...((data && data.data) || {}) };
    },
    async setSettings(patch) {
      const cur = await this.getSettings();
      fail('salvar os ajustes do painel', (await sb.from('config').upsert({ id: 'painel', data: { ...cur, ...patch } })).error);
    },
  };
}

function memoryStore({ now = Date.now } = {}) {
  const users = new Map(); // email -> { id, email, password }
  const sessions = new Map();
  const attempts = [];
  let settings = { signup: true };
  const orphans = { claimedBy: null };
  return {
    _users: users,
    _sessions: sessions,
    _attempts: attempts,
    _orphans: orphans,
    async verify(email, password) {
      const u = users.get(email);
      return u && u.password === password ? u.id : null;
    },
    async createUser(email, password) {
      if (users.has(email)) return { error: 'exists' };
      const id = crypto.randomUUID();
      users.set(email, { id, email, password });
      return { id };
    },
    async setPassword(userId, password) {
      for (const u of users.values()) if (u.id === userId) u.password = password;
    },
    async user(userId) {
      for (const u of users.values()) if (u.id === userId) return { id: u.id, email: u.email };
      return null;
    },
    async countUsers() {
      return users.size;
    },
    async claimOrphans(userId) {
      orphans.claimedBy = userId;
    },
    async insertSession(s) {
      sessions.set(s.id, { ...s });
    },
    async getSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },
    async touchSession(id, lastSeen, expiresAt) {
      const s = sessions.get(id);
      if (s) Object.assign(s, { lastSeen, expiresAt });
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
    async deleteUserSessions(userId, exceptId = null) {
      for (const [id, s] of sessions) if (s.userId === userId && id !== exceptId) sessions.delete(id);
    },
    async logAttempt(a) {
      attempts.push({ ...a, t: a.t ?? now() });
    },
    async failuresSince(ip, since) {
      return attempts.filter((a) => a.ip === ip && a.reason === 'senha' && a.t >= since).map((a) => a.t);
    },
    async recentAttempts(userId, email, n = 10) {
      return attempts
        .filter((a) => a.userId === userId || a.email === email)
        .slice(-n)
        .reverse();
    },
    async getSettings() {
      return { ...settings };
    },
    async setSettings(patch) {
      settings = { ...settings, ...patch };
    },
  };
}

module.exports = { supabaseStore, memoryStore };
