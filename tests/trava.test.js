// O motor só atende o painel: sem a senha interna (ou com endereço estranho), recusa.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const motorToken = require('../motor/token');
const { createApi } = require('../motor/api');

function request(port, { path: p = '/api/accounts', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

test('motor: recusa pedido sem a senha interna ou com endereço estranho; o painel (com a senha) passa', async () => {
  const token = 'a'.repeat(64);
  const server = createApi({ token }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    assert.equal(await request(port), 401); // sem senha
    assert.equal(await request(port, { headers: { 'x-motor-token': 'b'.repeat(64) } }), 401); // senha errada
    assert.equal(await request(port, { method: 'POST', path: '/api/accounts/x/start' }), 401); // ação sem senha
    assert.equal(await request(port, { headers: { 'x-motor-token': token } }), 200);
    // Truque de DNS: nome de outro site apontando para este PC
    assert.equal(await request(port, { headers: { 'x-motor-token': token, host: `exemplo.com:${port}` } }), 403);
    assert.equal(await request(port, { path: '/api/health' }), 200); // só diz se está ligado
  } finally {
    server.close();
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
