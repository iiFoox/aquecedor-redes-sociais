// Teste da rota e agregação de dados do painel de gestão de frotas (admin)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApi } = require('../motor/api');
const { isAdmin, formatFleet, cleanProxyHost } = require('../motor/api/admin');

test('isAdmin: só autoriza o usuário do Vini', () => {
  assert.equal(isAdmin('40945f3c-8e9f-4a9a-a814-59d0aacb8bcb'), true);
  assert.equal(isAdmin('b5d502f2-4ffe-4c9b-90f5-5903d39828f3'), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(''), false);
  assert.equal(isAdmin(undefined), false);
});

test('cleanProxyHost: limpa senhas e retorna apenas o host:porta', () => {
  assert.equal(cleanProxyHost('http://usuario:senha123@45.38.101.186:6119'), '45.38.101.186:6119');
  assert.equal(cleanProxyHost('http://45.38.101.186:6119'), '45.38.101.186:6119');
  assert.equal(cleanProxyHost('http://proxymesh.com:31280'), 'proxymesh.com:31280');
  assert.equal(cleanProxyHost(''), null);
  assert.equal(cleanProxyHost(null), null);
});

test('formatFleet: consolida aparelhos, contas, status online, reconciliação de proxies e erros', () => {
  const now = Date.now();
  const latestVersion = '2.1.18';

  const usersData = {
    users: [
      { id: 'u-vini', email: 'vfbnn29@gmail.com' },
      { id: 'u-juninho', email: 'juninho@gmail.com' },
    ],
  };

  const devices = [
    {
      id: 'dev-1',
      name: 'PC Vini',
      owner_id: 'u-vini',
      app_version: '2.1.18',
      created_at: '2026-10-01T10:00:00Z',
      last_seen: new Date(now - 30 * 1000).toISOString(), // 30s atrás (online)
      config: { start: '08:00', end: '22:00', max: 4, headless: false, muteAudio: true },
    },
    {
      id: 'dev-2',
      name: 'PC Juninho',
      owner_id: 'u-juninho',
      app_version: '2.1.13', // desatualizado
      created_at: '2026-10-05T10:00:00Z',
      last_seen: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min atrás (offline)
      config: { start: '09:00', end: '20:00', max: 2 },
    },
  ];

  const accounts = [
    {
      id: 'acc-1',
      platform: 'instagram',
      username: 'conta_vini',
      device_id: 'dev-1',
      owner_id: 'u-vini',
      proxy: 'http://user:pass@proxy1:8080',
      status: { schedule: 'aquecendo', live: null },
      day: 5,
      phase: 2,
    },
    {
      id: 'acc-data-proxy',
      platform: 'tiktok',
      username: 'conta_com_data_proxy',
      device_id: 'dev-1',
      owner_id: 'u-vini',
      proxy: null, // coluna proxy null, mas presente em data.proxy
      data: { proxy: 'http://user:pass@45.38.101.186:6119' },
      status: { schedule: 'agendada', live: null },
      day: 3,
      phase: 1,
    },
    {
      id: 'acc-2',
      platform: 'tiktok',
      username: 'conta_juninho',
      device_id: 'dev-2',
      owner_id: 'u-juninho',
      proxy: null,
      status: { schedule: 'fora-da-janela', live: null },
      day: 2,
      phase: 1,
    },
  ];

  const sessions = [
    {
      id: 1,
      account_id: 'acc-1',
      owner_id: 'u-vini',
      started_at: new Date(now - 3600 * 1000).toISOString(),
      ended_at: new Date(now - 3000 * 1000).toISOString(),
      minutes: 10,
      result: 'ok',
      error: null,
    },
    {
      id: 2,
      account_id: 'acc-data-proxy',
      owner_id: 'u-vini',
      started_at: new Date(now - 1200 * 1000).toISOString(),
      ended_at: new Date(now - 1100 * 1000).toISOString(),
      minutes: 1.5,
      result: 'stopped',
      error: null,
      stats: { proxy: 'http://user:pass@45.38.101.186:6119' },
    },
    {
      id: 3,
      account_id: 'acc-2',
      owner_id: 'u-juninho',
      started_at: new Date(now - 1800 * 1000).toISOString(),
      ended_at: new Date(now - 1790 * 1000).toISOString(),
      minutes: 0,
      result: 'error',
      error: 'net::ERR_TUNNEL_CONNECTION_FAILED',
    },
  ];

  const result = formatFleet({ usersData, devices, accounts, sessions, latestVersion, now });

  // Validação do resumo
  assert.equal(result.summary.totalDevices, 2);
  assert.equal(result.summary.onlineDevices, 1);
  assert.equal(result.summary.outdatedDevices, 1);
  assert.equal(result.summary.totalAccounts, 3);
  assert.equal(result.summary.totalErrors24h, 1);
  assert.equal(result.summary.latestVersion, '2.1.18');

  // Validação do dev-1 (Vini)
  const d1 = result.devices.find((d) => d.id === 'dev-1');
  assert.ok(d1);
  assert.equal(d1.name, 'PC Vini');
  assert.equal(d1.ownerEmail, 'vfbnn29@gmail.com');
  assert.equal(d1.online, true);
  assert.equal(d1.isLatest, true);
  assert.equal(d1.accountsCount, 2);
  
  // Conta 1 (proxy direto)
  assert.equal(d1.accounts[0].username, 'conta_vini');
  assert.equal(d1.accounts[0].hasProxy, true);
  assert.equal(d1.accounts[0].proxyInfo, 'proxy1:8080');

  // Conta 2 (proxy em data.proxy)
  assert.equal(d1.accounts[1].username, 'conta_com_data_proxy');
  assert.equal(d1.accounts[1].hasProxy, true);
  assert.equal(d1.accounts[1].proxyInfo, '45.38.101.186:6119');

  // Sessões dev-1
  assert.equal(d1.totalSessions, 2);
  assert.equal(d1.totalErrors, 0);
  assert.equal(d1.successRate, 100);
  assert.equal(d1.lastError, null);

  // Sessão 2 do dev-1 (usou proxy e limpou credenciais)
  const sess2 = d1.recentSessions.find((s) => s.id === 2);
  assert.ok(sess2);
  assert.equal(sess2.usedProxy, true);
  assert.equal(sess2.proxyInfo, '45.38.101.186:6119');

  // Validação do dev-2 (Juninho)
  const d2 = result.devices.find((d) => d.id === 'dev-2');
  assert.ok(d2);
  assert.equal(d2.name, 'PC Juninho');
  assert.equal(d2.ownerEmail, 'juninho@gmail.com');
  assert.equal(d2.online, false);
  assert.equal(d2.isLatest, false);
  assert.equal(d2.accountsCount, 1);
  assert.equal(d2.accounts[0].username, 'conta_juninho');
  assert.equal(d2.accounts[0].hasProxy, false);
  assert.equal(d2.totalSessions, 1);
  assert.equal(d2.totalErrors, 1);
  assert.equal(d2.successRate, 0);
  assert.ok(d2.lastError);
  assert.equal(d2.lastError.error, 'net::ERR_TUNNEL_CONNECTION_FAILED');
  assert.equal(d2.lastError.account, 'conta_juninho');
  assert.equal(d2.recentSessions.length, 1);
  assert.equal(d2.recentSessions[0].usedProxy, true); // detectado pelo erro de túnel
});

test('trava HTTP: usuário comum recebe 403 Forbidden em /api/admin/fleet', async () => {
  const TOKEN = 'b'.repeat(64);
  const server = createApi({ token: TOKEN, deviceUser: () => 'u-cliente' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();

  const req = (userId) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/admin/fleet',
          method: 'GET',
          headers: {
            'x-motor-token': TOKEN,
            'x-wu-user': userId,
          },
        },
        (res) => {
          let s = '';
          res.on('data', (d) => (s += d));
          res.on('end', () => resolve({ status: res.statusCode, body: s }));
        },
      );
      r.on('error', reject);
      r.end();
    });

  try {
    const resForbidden = await req('u-cliente-comum');
    assert.equal(resForbidden.status, 403);
    assert.match(resForbidden.body, /Acesso restrito/);

    const resForbidden2 = await req('b5d502f2-4ffe-4c9b-90f5-5903d39828f3'); // juninho
    assert.equal(resForbidden2.status, 403);
  } finally {
    server.close();
  }
});
