// Login do painel: regras de e-mail e senha, sessões, bloqueio por tentativas, CSRF e rotas protegidas
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cred = require('../painel/credenciais');
const { createAuth, SHORT_MS } = require('../painel/auth');
const { memoryStore } = require('../painel/authStore');
const { createPainel } = require('../painel/app');

test('credenciais: e-mail normalizado; senha com 10+ caracteres, letras e números', () => {
  assert.equal(cred.email.parse('  Eu@Exemplo.COM '), 'eu@exemplo.com');
  assert.equal(cred.email.safeParse('sem-arroba').success, false);
  assert.equal(cred.firstError(cred.password.safeParse('curta1')), 'A senha precisa de pelo menos 10 caracteres');
  assert.equal(cred.firstError(cred.password.safeParse('sóletrasaqui')), 'Use letras e números na senha');
  assert.equal(cred.password.safeParse('frase com 3 palavras').success, true);
  assert.equal(cred.login.parse({ email: 'a@b.co', password: 'x' }).remember, false);
});

// ---------- Painel de verdade com login em memória e motor falso ----------

function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><script src="/assets/app.js"></script>painel</html>');
  fs.writeFileSync(path.join(dir, 'login.html'), '<html><script src="/assets/login.js"></script>login</html>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), '// painel');
  fs.writeFileSync(path.join(dir, 'assets', 'login.js'), '// login');
  return dir;
}

async function setup() {
  let t = Date.parse('2026-10-08T12:00:00Z');
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const store = memoryStore({ now: clock.now });
  // Motor falso: devolve os cabeçalhos que recebeu
  const motor = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method, headers: req.headers }));
  });
  await new Promise((r) => motor.listen(0, '127.0.0.1', r));
  const auth = createAuth({ store, now: clock.now });
  const app = createPainel({ auth, dist: fakeDist(), motorPort: motor.address().port, readToken: () => 'senha-interna' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const req = (p, { method = 'GET', body, cookie, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const h = { ...headers };
      if (data) h['content-type'] = 'application/json';
      if (cookie) h.cookie = cookie;
      const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(s);
          } catch {
            /* não é JSON */
          }
          const sc = res.headers['set-cookie'];
          resolve({ status: res.statusCode, json, text: s, location: res.headers.location, setCookie: sc ? sc[0] : null });
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  const post = (p, body, cookie, extra = {}) => req(p, { method: 'POST', body, cookie, headers: { origin, ...extra } });
  const cookieOf = (r) => (r.setCookie ? r.setCookie.split(';')[0] : null);
  const close = () => {
    server.close();
    motor.close();
  };
  return { req, post, cookieOf, store, clock, close, origin };
}

const SENHA = 'senha forte 123';

test('login: sem sessão nada abre (painel, API, arquivos do painel); só a tela de login e os arquivos dela', async () => {
  const s = await setup();
  try {
    const home = await s.req('/');
    assert.equal(home.status, 302);
    assert.equal(home.location, '/login');
    const api = await s.req('/api/accounts');
    assert.equal(api.status, 401);
    assert.equal(api.json.auth, false);
    assert.equal((await s.req('/api/stream')).status, 401);
    assert.equal((await s.req('/api/accounts/x/screens/a.jpg')).status, 401);
    assert.equal((await s.req('/assets/app.js')).status, 302, 'o código do painel abriu sem login');
    assert.equal((await s.req('/assets/login.js')).status, 200);
    const login = await s.req('/login');
    assert.equal(login.status, 200);
    assert.match(login.text, /login/);
    // Nome de outro site apontando para este PC (truque de DNS)
    assert.equal((await s.req('/login', { headers: { host: 'exemplo.com' } })).status, 403);
  } finally {
    s.close();
  }
});

test('cadastro e login: cookie httpOnly; "Manter conectado" dura 30 dias; o primeiro usuário fica com as contas', async () => {
  const s = await setup();
  try {
    const cad = await s.post('/auth/cadastro', { email: 'Eu@Exemplo.com', password: SENHA });
    assert.equal(cad.status, 200);
    assert.equal(cad.json.first, true);
    assert.match(cad.setCookie, /HttpOnly/);
    assert.match(cad.setCookie, /SameSite=Lax/);
    assert.doesNotMatch(cad.setCookie, /Max-Age/); // sem "Manter conectado": some ao fechar o navegador
    const me = s.store._users.get('eu@exemplo.com');
    assert.equal(s.store._orphans.claimedBy, me.id);
    // Senha não fica em lugar nenhum do registro de acessos
    assert.ok(!JSON.stringify(s.store._attempts).includes(SENHA));

    const segundo = await s.post('/auth/cadastro', { email: 'outro@exemplo.com', password: SENHA });
    assert.equal(segundo.json.first, false);
    assert.equal(s.store._orphans.claimedBy, me.id, 'o segundo usuário pegou as contas do primeiro');
    assert.equal((await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA })).status, 409);
    assert.equal((await s.post('/auth/cadastro', { email: 'x@exemplo.com', password: 'curta' })).status, 400);

    const lembrar = await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA, remember: true });
    assert.equal(lembrar.status, 200);
    assert.match(lembrar.setCookie, /Max-Age=2592000/);
    // Logado: /login vai direto para o painel
    assert.equal((await s.req('/login', { cookie: s.cookieOf(lembrar) })).location, '/');
    // Sessão guardada só pelo hash: o código do cookie não aparece no banco
    const code = s.cookieOf(lembrar).split('=')[1];
    assert.ok(![...s.store._sessions.keys()].includes(code));
  } finally {
    s.close();
  }
});

test('login errado: mesma mensagem para e-mail e senha; 5 erros em 15 min bloqueiam por 15 min', async () => {
  const s = await setup();
  try {
    await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA });
    const semUsuario = await s.post('/auth/login', { email: 'ninguem@exemplo.com', password: SENHA });
    const senhaErrada = await s.post('/auth/login', { email: 'eu@exemplo.com', password: 'errada 999' });
    assert.equal(semUsuario.status, 401);
    assert.equal(semUsuario.json.error, senhaErrada.json.error);
    for (let i = 0; i < 2; i++) assert.equal((await s.post('/auth/login', { email: 'eu@exemplo.com', password: 'x' })).status, 401);
    const quinta = await s.post('/auth/login', { email: 'eu@exemplo.com', password: 'x' });
    assert.equal(quinta.status, 429);
    assert.match(quinta.json.error, /Tente de novo em 15 min/);
    // Bloqueado: nem a senha certa entra
    assert.equal((await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA })).status, 429);
    s.clock.advance(10 * 60000);
    assert.match((await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA })).json.error, /5 min/);
    s.clock.advance(5 * 60000 + 1000);
    assert.equal((await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA })).status, 200);
  } finally {
    s.close();
  }
});

test('API: repassa ao motor com a senha interna e o usuário logado; ação de outra origem é recusada', async () => {
  const s = await setup();
  try {
    const c = s.cookieOf(await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA }));
    const me = s.store._users.get('eu@exemplo.com');
    // O navegador tenta se passar por outro usuário e mandar a senha interna: o painel sobrescreve
    const r = await s.req('/api/accounts', { cookie: c, headers: { 'x-wu-user': 'outro', 'x-motor-token': 'chute' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.headers['x-wu-user'], me.id);
    assert.equal(r.json.headers['x-motor-token'], 'senha-interna');
    assert.equal(r.json.headers.cookie, undefined);
    // Ação sem origem ou de outro site: 403. Da própria página: passa.
    assert.equal((await s.req('/api/accounts/a/start', { method: 'POST', cookie: c })).status, 403);
    const evil = await s.req('/api/accounts/a/start', { method: 'POST', cookie: c, headers: { origin: 'https://site-malicioso.com' } });
    assert.equal(evil.status, 403);
    assert.equal((await s.post('/api/accounts/a/start', {}, c)).status, 200);
    // Login de outra origem também é recusado
    assert.equal((await s.req('/auth/login', { method: 'POST', body: { email: 'eu@exemplo.com', password: SENHA } })).status, 403);
  } finally {
    s.close();
  }
});

test('sessão: vence sem uso, sair encerra no servidor, trocar a senha derruba os outros aparelhos', async () => {
  const s = await setup();
  try {
    await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA });
    const curta = s.cookieOf(await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA }));
    const pc = s.cookieOf(await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA, remember: true }));
    const cel = s.cookieOf(await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA, remember: true }));
    assert.equal((await s.req('/api/x', { cookie: curta })).status, 200);
    s.clock.advance(SHORT_MS + 60000);
    assert.equal((await s.req('/api/x', { cookie: curta })).status, 401, 'sessão curta não venceu');
    assert.equal((await s.req('/api/x', { cookie: pc })).status, 200, '"Manter conectado" venceu cedo');
    assert.equal((await s.req('/api/x', { cookie: 'wu_sess=inventado' })).status, 401);

    assert.equal((await s.post('/auth/senha', { current: 'errada', password: 'nova senha 456' }, pc)).status, 400);
    assert.equal((await s.post('/auth/senha', { current: SENHA, password: 'nova senha 456' }, pc)).status, 200);
    assert.equal((await s.req('/api/x', { cookie: cel })).status, 401, 'o outro aparelho continuou logado');
    assert.equal((await s.req('/api/x', { cookie: pc })).status, 200);
    assert.equal((await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA })).status, 401);

    const acessos = await s.req('/auth/acessos', { cookie: pc });
    assert.ok(acessos.json.some((a) => a.reason === 'troca-senha'));
    assert.ok(acessos.json.length <= 10);

    assert.equal((await s.post('/auth/sair', {}, pc)).status, 200);
    assert.equal((await s.req('/api/x', { cookie: pc })).status, 401, 'sair não encerrou no servidor');
  } finally {
    s.close();
  }
});

test('sessão apagada por fora (troca de senha pelo terminal) cai em até 30 s', async () => {
  const s = await setup();
  try {
    await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA });
    const c = s.cookieOf(await s.post('/auth/login', { email: 'eu@exemplo.com', password: SENHA, remember: true }));
    assert.equal((await s.req('/api/x', { cookie: c })).status, 200);
    s.store._sessions.clear(); // o que o "npm run usuario -- senha" faz no banco
    s.clock.advance(31000);
    assert.equal((await s.req('/api/x', { cookie: c })).status, 401);
  } finally {
    s.close();
  }
});

test('cadastro: dá para fechar em Ajustes', async () => {
  const s = await setup();
  try {
    const c = s.cookieOf(await s.post('/auth/cadastro', { email: 'eu@exemplo.com', password: SENHA }));
    assert.equal((await s.req('/auth/estado')).json.signup, true);
    const off = await s.req('/auth/cadastro-liberado', { method: 'PUT', body: { on: false }, cookie: c, headers: { origin: s.origin } });
    assert.equal(off.status, 200);
    assert.equal((await s.req('/auth/estado')).json.signup, false);
    assert.equal((await s.post('/auth/cadastro', { email: 'novo@exemplo.com', password: SENHA })).status, 403);
  } finally {
    s.close();
  }
});
