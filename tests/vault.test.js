// Logins das contas no Supabase: cifra (AES-256-GCM + scrypt), chave trancada pela senha, cópia do aparelho,
// quando salvar e quando restaurar. O teste de navegador usa um Chromium de verdade, mas toda requisição é
// respondida pelo próprio teste (nada sai para o TikTok).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WU_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-vault-'));
const v = require('../motor/vault');
const logins = require('../motor/logins');

const USER = '11111111-1111-1111-1111-111111111111';

// Banco e cópia local em memória (o mesmo contrato do Supabase e do arquivo DPAPI)
function memDb() {
  const db = {
    row: null,
    logins: 1,
    async get() {
      return db.row ? { ...db.row } : null;
    },
    async insert(row) {
      if (db.row) return false;
      db.row = { ...row };
      return true;
    },
    async update(row) {
      db.row = { ...db.row, ...row };
    },
    async dropLogins() {
      db.logins = 0;
    },
  };
  return db;
}
function memLocal() {
  const l = {
    v: null,
    read: () => (l.v ? JSON.parse(l.v) : null),
    write: (o) => (l.v = JSON.stringify(o)),
  };
  return l;
}

test('cifra: ida e volta; chave errada, dado mexido ou dado de outra conta não abrem', () => {
  const key = Buffer.alloc(32, 7);
  const c = v.seal(key, { a: 1, txt: 'olá' }, 'conta-1');
  assert.deepEqual(v.open(key, c, 'conta-1'), { a: 1, txt: 'olá' });
  assert.throws(() => v.open(Buffer.alloc(32, 8), c, 'conta-1'));
  assert.throws(() => v.open(key, c, 'conta-2'), 'login de uma conta abriu como de outra');
  const buf = Buffer.from(c, 'base64');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => v.open(key, buf.toString('base64'), 'conta-1'));
  assert.notEqual(v.seal(key, { a: 1 }, 'x'), v.seal(key, { a: 1 }, 'x'), 'iv repetido');
});

test('chave: trancada pela senha; senha errada não abre; nada da senha fica no banco', () => {
  const key = Buffer.alloc(32, 3);
  const row = v.wrapKey(key, 'senha forte 123');
  assert.equal(row.kdf.name, 'scrypt');
  assert.ok(row.kdf.N >= 32768);
  assert.ok(!JSON.stringify(row).includes('senha forte'));
  assert.deepEqual(v.unwrapKey(row, 'senha forte 123'), key);
  assert.equal(v.unwrapKey(row, 'senha forte 124'), null);
});

test('cofre: o 1º login cria a chave; outro aparelho abre com a senha; religar usa a cópia do Windows', async () => {
  const db = memDb();
  const a = v.createVault({ db, local: memLocal(), userId: USER });
  assert.equal((await a.unlock('senha forte 123')).created, true);
  assert.equal(a.status(), 'ok');
  const segredo = a.seal({ cookies: [] }, 'c1');

  const localB = memLocal();
  const b = v.createVault({ db, local: localB, userId: USER });
  await b.unlock('senha forte 123');
  assert.deepEqual(b.open(segredo, 'c1', 1), { cookies: [] }, 'o outro aparelho não abriu o login');
  assert.ok(!localB.v.includes('senha'), 'senha na cópia local');

  // B reinicia sem senha: usa a cópia
  const b2 = v.createVault({ db, local: localB, userId: USER });
  assert.equal(await b2.resume(), 'ok');
  assert.deepEqual(b2.open(segredo, 'c1', 1), { cookies: [] });
  // Cópia de outro usuário não vale
  assert.equal(await v.createVault({ db, local: localB, userId: 'outro' }).resume(), 'off');
});

test('cofre: senha trocada tranca de novo; senha recuperada pelo e-mail: aparelho com a cópia tranca com a nova', async () => {
  const db = memDb();
  const localA = memLocal();
  const a = v.createVault({ db, local: localA, userId: USER });
  await a.unlock('senha velha 111');
  const segredo = a.seal({ x: 1 }, 'c1');
  await a.rewrap('senha nova 222');
  assert.equal(v.unwrapKey(db.row, 'senha velha 111'), null);
  assert.ok(v.unwrapKey(db.row, 'senha nova 222'));

  // Recuperou a senha pelo e-mail ("senha 333"): aparelho novo sem cópia fica trancado
  const novo = v.createVault({ db, local: memLocal(), userId: USER });
  assert.equal((await novo.unlock('senha 333 nova')).status, 'trancada');
  assert.throws(() => novo.seal({}, 'c1'));
  // O aparelho A (tem a cópia) entra com a senha nova: tranca de novo sozinho
  const a2 = v.createVault({ db, local: localA, userId: USER });
  assert.equal((await a2.unlock('senha 333 nova')).rewrapped, true);
  assert.deepEqual(a2.open(segredo, 'c1', 1), { x: 1 });
  // Agora o aparelho novo abre com a senha nova
  assert.equal((await novo.unlock('senha 333 nova')).status, 'ok');
});

test('cofre trancado: abrir com a senha antiga ou começar chave nova (os logins antigos saem)', async () => {
  const db = memDb();
  await v.createVault({ db, local: memLocal(), userId: USER }).unlock('senha antiga 1');
  const c = v.createVault({ db, local: memLocal(), userId: USER });
  await c.unlock('senha atual 22');
  assert.equal((await c.unlockOld('chute errado 1', 'senha atual 22')).wrong, true);
  assert.equal((await c.unlockOld('senha antiga 1', 'senha atual 22')).status, 'ok');
  assert.ok(v.unwrapKey(db.row, 'senha atual 22'), 'não trancou com a senha atual');

  const d = v.createVault({ db, local: memLocal(), userId: USER });
  await d.reset('senha atual 22');
  assert.equal(db.row.key_version, 2);
  assert.equal(db.logins, 0);
  // A cópia velha de outro aparelho (versão 1) não vale mais: fica trancado até entrar com a senha
  const localVelha = memLocal();
  localVelha.write({ userId: USER, version: 1, key: Buffer.alloc(32).toString('base64') });
  assert.equal(await v.createVault({ db, local: localVelha, userId: USER }).resume(), 'trancada');
  assert.throws(() => d.open(c.seal({}, 'c1'), 'c1', 1), 'login da chave velha abriu');
});

test('logins: só salva conta logada; leva só os dados do site da plataforma', () => {
  const state = {
    cookies: [
      { name: 'sessionid', value: 'abc', domain: '.tiktok.com' },
      { name: 'x', value: '1', domain: '.byteoversea.com' },
    ],
    origins: [
      { origin: 'https://www.tiktok.com', localStorage: [{ name: 'k', value: 'v' }] },
      { origin: 'https://ads.exemplo.com', localStorage: [{ name: 'k', value: 'v' }] },
      { origin: 'https://www.faketiktok.com', localStorage: [] },
    ],
  };
  assert.equal(logins.isLogged(state, 'tiktok'), true);
  assert.equal(logins.isLogged(state, 'instagram'), false);
  assert.equal(logins.isLogged({ cookies: [{ name: 'sessionid', value: '', domain: '.tiktok.com' }], origins: [] }, 'tiktok'), false);
  assert.equal(logins.isLogged({ cookies: [{ name: 'sessionid', value: 'a', domain: '.faketiktok.com' }], origins: [] }, 'tiktok'), false);
  assert.deepEqual(
    logins.trim(state, 'tiktok').origins.map((o) => o.origin),
    ['https://www.tiktok.com'],
  );
});

test('logins: restaura se a pasta sumiu, ou se a conta voltou de outro aparelho com login mais novo', () => {
  const cloud = { at: 2000, deviceId: 'B' };
  assert.equal(logins.needsRestore({ fresh: true, cloud: null, mine: 0, deviceId: 'A' }), false, 'nada salvo');
  assert.equal(logins.needsRestore({ fresh: true, cloud, mine: 0, deviceId: 'A' }), true);
  assert.equal(logins.needsRestore({ fresh: false, cloud, mine: 1000, deviceId: 'A' }), true, 'voltou de B mais novo');
  assert.equal(logins.needsRestore({ fresh: false, cloud, mine: 2000, deviceId: 'A' }), false, 'já é o mesmo');
  assert.equal(
    logins.needsRestore({ fresh: false, cloud: { at: 9000, deviceId: 'A' }, mine: 1000, deviceId: 'A' }),
    false,
    'salvo por mim',
  );
});

test('navegador: salva o login de um perfil e restaura num perfil novo (sem sair para a internet)', async (t) => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return t.skip('Playwright não instalado');
  }
  const rows = new Map();
  // Supabase falso (só o que logins.js usa)
  const client = {
    from: () => {
      const q = {
        _eq: null,
        select: () => q,
        eq: (_c, val) => ((q._eq = val), q),
        maybeSingle: async () => ({ data: rows.get(q._eq) || null }),
        upsert: async (row) => (rows.set(row.account_id, row), { error: null }),
        then: (res) =>
          res({
            data: [...rows.values()].map((r) => ({
              account_id: r.account_id,
              updated_at: r.updated_at,
              device_id: r.device_id,
              key_version: r.key_version,
            })),
          }),
      };
      return q;
    },
  };
  const vault = v.createVault({ db: memDb(), local: memLocal(), userId: USER });
  await vault.unlock('senha forte 123');
  const account = { id: 'conta-teste', platform: 'tiktok' };
  const offline = async (ctx) => {
    const sent = [];
    await ctx.route('**/*', (route) => {
      sent.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>tiktok falso</body></html>' });
    });
    return sent;
  };

  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-a-'));
  const dirB = path.join(os.tmpdir(), `perfil-b-${Date.now()}`);
  let a;
  let b;
  try {
    a = await chromium.launchPersistentContext(dirA, { headless: true });
    await offline(a);
    // Aparelho A: deslogado não salva
    await logins.init({ client, vault, deviceId: 'A', userId: USER });
    const pa = a.pages()[0] || (await a.newPage());
    await pa.goto('https://www.tiktok.com/');
    assert.equal(await logins.save(a, account), null, 'salvou conta deslogada');
    // Logado: salva
    await a.addCookies([{ name: 'sessionid', value: 'segredo-123', domain: '.tiktok.com', path: '/', secure: true, sameSite: 'None' }]);
    await pa.evaluate(() => localStorage.setItem('preferencia', 'mudo'));
    assert.ok(await logins.save(a, account));
    const row = rows.get(account.id);
    assert.ok(!row.cipher.includes('segredo'), 'login em texto puro no banco');

    // Aparelho B: pasta nova → restaura
    await logins.init({ client, vault, deviceId: 'B', userId: USER });
    b = await chromium.launchPersistentContext(dirB, { headless: true });
    const sent = await offline(b);
    const r = await logins.restoreIfNeeded(b, account, { fresh: true });
    assert.ok(r && r.deviceId === 'A');
    const cookies = await b.cookies('https://www.tiktok.com');
    assert.equal(cookies.find((c) => c.name === 'sessionid')?.value, 'segredo-123');
    const pb = b.pages()[0] || (await b.newPage());
    await pb.goto('https://www.tiktok.com/');
    assert.equal(await pb.evaluate(() => localStorage.getItem('preferencia')), 'mudo');
    assert.ok(
      sent.every((u) => u.startsWith('https://www.tiktok.com')),
      'saiu para outro endereço',
    );
    // Abrindo de novo no B (pasta já existe e o login é o mesmo): não restaura de novo
    assert.equal(await logins.restoreIfNeeded(b, account, { fresh: false }), null);
  } finally {
    if (a) await a.close();
    if (b) await b.close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
