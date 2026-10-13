// Painel de gestão da frota de aparelhos: exclusivo para o Vini (vfbnn29@gmail.com).
// Mostra todos os computadores, versões do app, contas vinculadas, status e erros recentes.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cloud = require('../cloud');
const paths = require('../paths');
const { SUPABASE_URL } = require('../supabase-config');
const { version } = require('../../package.json');

const ADMIN_ID = '40945f3c-8e9f-4a9a-a814-59d0aacb8bcb';
const ADMIN_EMAIL = 'vfbnn29@gmail.com';
const ONLINE_MS = 3 * 60000;

function isAdmin(userId) {
  if (userId && userId === ADMIN_ID) return true;
  const u = cloud.user();
  if (u && u.email === ADMIN_EMAIL && u.id === userId) return true;
  return false;
}

function cleanProxyHost(proxyRaw) {
  if (!proxyRaw || typeof proxyRaw !== 'string') return null;
  const trimmed = proxyRaw.trim();
  try {
    const u = new URL(trimmed);
    return u.host || trimmed;
  } catch {
    const cleaned = trimmed.replace(/^[a-zA-Z]+:\/\//, '').replace(/^[^@]*@/, '');
    return cleaned.split('/')[0] || trimmed;
  }
}

function getServiceKey() {
  if (process.env.SUPABASE_KEY) return process.env.SUPABASE_KEY;
  const candidates = [
    path.join(__dirname, '..', '..', '.env'),
    path.join(paths.DATA, '.env'),
    'C:\\Users\\vfbnn\\OneDrive\\Documentos\\aquecedor-redes-sociais\\.env',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        process.loadEnvFile(c);
        if (process.env.SUPABASE_KEY) return process.env.SUPABASE_KEY;
      }
    } catch {}
  }
  return null;
}

function formatFleet({ usersData, devices = [], accounts = [], sessions = [], latestVersion = version, now = Date.now() }) {
  const userMap = new Map();
  (usersData?.users || []).forEach((u) => userMap.set(u.id, u.email));

  // Mapeia o proxy mais recente visto em stats de sessões para cada account_id
  const latestSessionProxyByAccount = new Map();
  sessions.forEach((s) => {
    if (s.stats && typeof s.stats === 'object' && s.stats.proxy && !latestSessionProxyByAccount.has(s.account_id)) {
      latestSessionProxyByAccount.set(s.account_id, s.stats.proxy);
    }
  });

  const accountMap = new Map();
  accounts.forEach((a) => {
    const proxyFromDb = a.proxy || a.data?.proxy || null;
    const effectiveProxy = proxyFromDb || latestSessionProxyByAccount.get(a.id) || null;
    accountMap.set(a.id, {
      ...a,
      proxy: effectiveProxy,
      proxyClean: cleanProxyHost(effectiveProxy),
    });
  });

  let onlineCount = 0;
  let outdatedCount = 0;
  let errors24h = 0;

  const fleet = devices.map((d) => {
    const isOnline = d.last_seen ? now - Date.parse(d.last_seen) < ONLINE_MS : false;
    if (isOnline) onlineCount++;

    const isLatest = (d.app_version || '') === latestVersion;
    if (!isLatest) outdatedCount++;

    const dAccounts = accounts.filter((a) => a.device_id === d.id || (!a.device_id && a.owner_id === d.owner_id));
    const dAccountIds = new Set(dAccounts.map((a) => a.id));

    // Sessões deste computador pertencem estritamente às suas respectivas contas
    const dSessions = sessions.filter((s) => dAccountIds.has(s.account_id));
    const errorSessions = dSessions.filter((s) => !!s.error);

    const lastErrorSession = errorSessions[0] || null;

    return {
      id: d.id,
      name: d.name || 'Sem nome',
      ownerId: d.owner_id,
      ownerEmail: userMap.get(d.owner_id) || 'Desconhecido',
      appVersion: d.app_version || 'Desconhecida',
      isLatest,
      createdAt: d.created_at,
      lastSeen: d.last_seen,
      online: isOnline,
      config: d.config || {},
      accountsCount: dAccounts.length,
      accounts: dAccounts.map((a) => {
        const accFull = accountMap.get(a.id);
        const pRaw = accFull?.proxy || a.proxy || a.data?.proxy || null;
        const pClean = cleanProxyHost(pRaw);
        return {
          id: a.id,
          platform: a.platform,
          username: a.username,
          hasProxy: Boolean(pRaw),
          proxyInfo: pClean,
          status: a.status,
          day: a.day,
          phase: a.phase,
        };
      }),
      totalSessions: dSessions.length,
      totalErrors: errorSessions.length,
      successRate: dSessions.length ? Math.round(((dSessions.length - errorSessions.length) / dSessions.length) * 100) : 100,
      lastError: lastErrorSession
        ? {
            at: lastErrorSession.started_at,
            error: lastErrorSession.error,
            account: accountMap.get(lastErrorSession.account_id)?.username || lastErrorSession.account_id,
          }
        : null,
      recentSessions: dSessions.slice(0, 15).map((s) => {
        const acc = accountMap.get(s.account_id);
        const accProxyRaw = acc?.proxy || null;

        const sessionStatsProxy = s.stats && typeof s.stats === 'object' && s.stats.proxy ? s.stats.proxy : null;
        const hasProxyError = Boolean(s.error && /tunnel|proxy|auth_credentials|socks|ERR_TUNNEL/i.test(s.error));

        let usedProxy = false;
        if (sessionStatsProxy) {
          usedProxy = true;
        } else if (s.stats && typeof s.stats === 'object' && 'proxy' in s.stats && !s.stats.proxy) {
          // Explícito { proxy: null } gravado na sessão
          usedProxy = false;
        } else if (hasProxyError || accProxyRaw) {
          usedProxy = true;
        }

        const proxyRaw = sessionStatsProxy || (usedProxy ? accProxyRaw : null);
        const cleanHost = cleanProxyHost(proxyRaw);

        return {
          id: s.id,
          account: acc?.username || s.account_id,
          usedProxy,
          proxyInfo: cleanHost || (usedProxy ? 'Proxy' : null),
          startedAt: s.started_at,
          endedAt: s.ended_at,
          minutes: s.minutes,
          result: s.result,
          error: s.error,
        };
      }),
    };
  });

  // Conta erros nas últimas 24h
  sessions.forEach((s) => {
    if (s.error && s.started_at && now - Date.parse(s.started_at) < 24 * 3600 * 1000) {
      errors24h++;
    }
  });

  return {
    summary: {
      totalDevices: devices.length,
      onlineDevices: onlineCount,
      outdatedDevices: outdatedCount,
      totalAccounts: accounts.length,
      totalErrors24h: errors24h,
      latestVersion,
    },
    devices: fleet,
  };
}

const router = express.Router();

router.get('/admin/fleet', async (req, res) => {
  if (!isAdmin(req.userId)) {
    return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return res.status(503).json({ error: 'Chave administrativa não configurada neste ambiente' });
  }

  try {
    const sb = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });

    const [{ data: usersData }, { data: devices, error: errD }, { data: accounts, error: errA }, { data: sessions, error: errS }] =
      await Promise.all([
        sb.auth.admin.listUsers(),
        sb.from('devices').select('*').order('last_seen', { ascending: false }),
        sb.from('accounts').select('id, platform, username, status, device_id, owner_id, proxy, data, created_at, day, phase'),
        sb
          .from('sessions')
          .select('id, account_id, owner_id, started_at, ended_at, day, phase, minutes, result, error, stats')
          .order('started_at', { ascending: false })
          .limit(250),
      ]);

    if (errD || errA || errS) {
      const err = errD || errA || errS;
      console.error('Erro ao buscar dados da frota no Supabase:', err);
      return res.status(500).json({ error: `Erro no banco: ${err.message}` });
    }

    const data = formatFleet({
      usersData,
      devices: devices || [],
      accounts: accounts || [],
      sessions: sessions || [],
      latestVersion: version,
    });

    res.json(data);
  } catch (e) {
    console.error('Falha na rota /api/admin/fleet:', e);
    res.status(500).json({ error: `Erro ao compilar painel de gestão: ${e.message}` });
  }
});

module.exports = router;
module.exports.isAdmin = isAdmin;
module.exports.formatFleet = formatFleet;
module.exports.cleanProxyHost = cleanProxyHost;
