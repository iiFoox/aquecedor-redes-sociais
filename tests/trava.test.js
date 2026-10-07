// O motor só atende o painel (senha interna e endereço) e cada usuário do painel só vê o que é dele.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const motorToken = require('../motor/token');
const store = require('../motor/store');
const { createApi } = require('../motor/api');

const TOKEN = 'a'.repeat(64);

async function motor() {
  const server = createApi({ token: TOKEN }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const request = ({ path: p = '/api/accounts', method = 'GET', headers = {}, body, user = 'u1', token = TOKEN } = {}) =>
    new Promise((resolve, reject) => {
      const h = { ...headers };
      if (token) h['x-motor-token'] = token;
      if (user) h['x-wu-user'] = user;
      const data = body === undefined ? null : JSON.stringify(body);
      if (data) h['content-type'] = 'application/json';
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(s);
          } catch {
            /* SSE ou vazio */
          }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  return { request, close: () => server.close() };
}

test('motor: recusa pedido sem a senha interna ou com endereço estranho; o painel (com a senha) passa', async () => {
  const m = await motor();
  try {
    assert.equal((await m.request({ token: null })).status, 401); // sem senha
    assert.equal((await m.request({ token: 'b'.repeat(64) })).status, 401); // senha errada
    assert.equal((await m.request({ token: null, method: 'POST', path: '/api/accounts/x/start' })).status, 401); // ação sem senha
    assert.equal((await m.request({ user: null })).status, 401); // sem usuário do painel
    assert.equal((await m.request()).status, 200);
    // Truque de DNS: nome de outro site apontando para este PC
    assert.equal((await m.request({ headers: { host: 'exemplo.com:1' } })).status, 403);
    assert.equal((await m.request({ token: null, user: null, path: '/api/health' })).status, 200); // só diz se está ligado
  } finally {
    m.close();
  }
});

test('senha interna: nova a cada vez, só no arquivo, comparação segura', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-')), 'motor.token');
  const a = motorToken.create(file);
  const b = motorToken.create(file);
  assert.notEqual(a, b);
  assert.equal(motorToken.read(file), b);
  assert.equal(a.length, 64);
  assert.equal(motorToken.same(b, b), true);
  assert.equal(motorToken.same(b, a), false);
  assert.equal(motorToken.same(undefined, b), false);
  assert.equal(motorToken.read(file + 'x'), null);
});

test('separação: cada usuário vê e mexe só nas próprias contas, proxies, eventos e tela ao vivo', async () => {
  const minha = store.add({ platform: 'tiktok', username: 'minha_conta', proxy: null, interests: [], ownerId: 'u1' });
  const dele = store.add({ platform: 'tiktok', username: 'conta_dele', proxy: null, interests: [], ownerId: 'u2' });
  const semDono = store.add({ platform: 'instagram', username: 'sem_dono', proxy: null, interests: [] });
  store.addLog(minha.id, 'evento meu');
  store.addLog(dele.id, 'evento dele');
  const meuProxy = store.addProxy('http://1.1.1.1:8080', 'u1');
  store.addProxy('http://2.2.2.2:8080', 'u2');
  const m = await motor();
  try {
    const lista = (await m.request()).json.map((a) => a.username);
    assert.ok(lista.includes('minha_conta'));
    assert.ok(!lista.includes('conta_dele'), 'viu a conta de outro usuário');
    assert.ok(!lista.includes('sem_dono'), 'conta sem dono apareceu para alguém');
    // Conta de outro usuário: 404 em tudo (nem confirma que existe)
    for (const [method, p] of [
      ['GET', `/api/accounts/${dele.id}`],
      ['POST', `/api/accounts/${dele.id}/start`],
      ['POST', `/api/accounts/${dele.id}/stop`],
      ['DELETE', `/api/accounts/${dele.id}`],
      ['GET', `/api/accounts/${dele.id}/screens/x.jpg`],
      ['GET', `/api/live/${dele.id}`],
    ])
      assert.equal((await m.request({ method, path: p })).status, 404, `${method} ${p}`);
    assert.equal((await m.request({ path: `/api/accounts/${minha.id}` })).status, 200);

    const feed = (await m.request({ path: '/api/feed' })).json.map((e) => e.msg);
    assert.ok(feed.includes('evento meu'));
    assert.ok(!feed.includes('evento dele'));

    const proxies = (await m.request({ path: '/api/proxies' })).json;
    assert.deepEqual(
      proxies.map((p) => p.id),
      [meuProxy.id],
    );

    // Conta criada fica com quem criou
    const nova = await m.request({ method: 'POST', body: { platform: 'tiktok', username: 'nova_conta', proxy: '', interests: [] } });
    assert.equal(nova.status, 200);
    assert.equal(store.get(nova.json.id).ownerId, 'u1');
    assert.ok(!(await m.request({ user: 'u2' })).json.some((a) => a.username === 'nova_conta'));
    store.remove(nova.json.id);
  } finally {
    m.close();
    for (const a of [minha, dele, semDono]) store.remove(a.id);
  }
});
