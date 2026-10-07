// Login do painel: regras de e-mail e senha, sessões, bloqueio por tentativas, CSRF e rotas protegidas
const test = require('node:test');
const assert = require('node:assert/strict');
const cred = require('../painel/credenciais');

test('credenciais: e-mail normalizado; senha com 10+ caracteres, letras e números', () => {
  assert.equal(cred.email.parse('  Eu@Exemplo.COM '), 'eu@exemplo.com');
  assert.equal(cred.email.safeParse('sem-arroba').success, false);
  assert.equal(cred.firstError(cred.password.safeParse('curta1')), 'A senha precisa de pelo menos 10 caracteres');
  assert.equal(cred.firstError(cred.password.safeParse('sóletrasaqui')), 'Use letras e números na senha');
  assert.equal(cred.password.safeParse('frase com 3 palavras').success, true);
  assert.equal(cred.login.parse({ email: 'a@b.co', password: 'x' }).remember, false);
});
