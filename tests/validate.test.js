const test = require('node:test');
const assert = require('node:assert/strict');
const { schemas } = require('../motor/validate');

test('conta nova: tira o @, separa os interesses e aceita proxy vazio', () => {
  const ok = schemas.newAccount.parse({ platform: 'tiktok', username: ' @alemdofato5 ', interests: 'IA, comédia ,', proxy: '' });
  assert.deepEqual(ok, { platform: 'tiktok', username: 'alemdofato5', proxy: '', interests: ['IA', 'comédia'] });
  assert.deepEqual(schemas.newAccount.parse({ username: 'conta' }).interests, []);
  assert.equal(schemas.newAccount.parse({ username: 'conta' }).platform, 'instagram');
});

test('conta nova: recusa plataforma, usuário e proxy inválidos com mensagem clara', () => {
  const err = (body) => schemas.newAccount.safeParse(body).error?.issues[0].message;
  assert.equal(err({ platform: 'x', username: 'a' }), 'Plataforma inválida');
  assert.equal(err({ username: '' }), 'Informe o usuário');
  assert.match(err({ username: 'nome com espaço' }), /Usuário inválido/);
  assert.match(err({ username: 'ok', proxy: 'abc' }), /Proxy inválido/);
});

test('conta nova: guarda o endereço completo do proxy', () => {
  assert.equal(schemas.newAccount.parse({ username: 'ok', proxy: ' http://u:p@1.2.3.4:8080 ' }).proxy, 'http://u:p@1.2.3.4:8080');
  assert.equal(schemas.newAccount.parse({ username: 'ok', proxy: 'socks5://1.2.3.4:1080' }).proxy, 'socks5://1.2.3.4:1080');
});

test('config: descarta campos desconhecidos e valida horários e limite', () => {
  assert.deepEqual(schemas.configPatch.parse({ active: true, probe: true, max: '3' }), { active: true, max: 3 });
  assert.equal(schemas.configPatch.safeParse({ start: '25:00' }).success, false);
  assert.equal(schemas.configPatch.safeParse({ end: '8h' }).success, false);
  assert.equal(schemas.configPatch.safeParse({ max: 0 }).success, false);
  assert.equal(schemas.configPatch.safeParse({ max: 7 }).success, false);
});

test('proxy: exige protocolo, host e porta', () => {
  assert.equal(schemas.newProxy.safeParse({ url: 'http://u:p@host.com:3128' }).success, true);
  assert.equal(schemas.newProxy.safeParse({ url: 'host.com:3128' }).success, false);
  assert.equal(schemas.newProxy.safeParse({}).success, false);
});

test('navegador manual: login por padrão, captcha quando pedido', () => {
  assert.equal(schemas.openBrowser.parse({}).purpose, 'login');
  assert.equal(schemas.openBrowser.parse({ purpose: 'captcha' }).purpose, 'captcha');
  assert.equal(schemas.openBrowser.safeParse({ purpose: 'outro' }).success, false);
});
