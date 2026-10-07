// Cofre dos logins das contas (TikTok/Instagram). Os logins vão para o Supabase cifrados com AES-256-GCM por uma
// chave aleatória do usuário. Essa chave fica guardada de dois jeitos:
// - no banco (user_keys), trancada por uma chave tirada da senha do app (scrypt);
// - neste aparelho (data/vault-key.bin), protegida pelo Windows (DPAPI): o robô liga sozinho sem pedir a senha.
// Senha trocada: a chave só é trancada de novo (nada se perde). Senha recuperada pelo e-mail: o aparelho que tem a
// cópia local tranca de novo com a senha nova quando você entra nele.
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const scryptOpts = (k) => ({ N: k.N, r: k.r, p: k.p, maxmem: 128 * k.N * k.r * 2 });

// ---------- Cifra (funções puras) ----------

function deriveKek(password, saltB64, kdf = KDF) {
  return crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), 32, scryptOpts(kdf));
}

// base64(iv 12 | tag 16 | dados). aad amarra o dado ao lugar dele (ex.: o id da conta).
function encrypt(key, data, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function decrypt(key, b64, aad = '') {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]); // senha/chave errada: lança erro
}

// Chave nova trancada pela senha
function wrapKey(key, password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { wrapped_key: encrypt(deriveKek(password, salt), key, 'wu-key'), salt, kdf: KDF };
}
function unwrapKey(row, password) {
  try {
    return decrypt(deriveKek(password, row.salt, row.kdf || KDF), row.wrapped_key, 'wu-key');
  } catch {
    return null;
  }
}

// Objeto → gzip → cifra (e o contrário)
const seal = (key, obj, aad) => encrypt(key, zlib.gzipSync(Buffer.from(JSON.stringify(obj))), aad);
const open = (key, b64, aad) => JSON.parse(zlib.gunzipSync(decrypt(key, b64, aad)).toString('utf8'));

// ---------- Gerente da chave ----------
// db: { get(), insert(row), update(row), dropLogins() } sobre user_keys/account_logins do usuário logado.
// local: { read(), write(obj) } da cópia deste aparelho (DPAPI). Os testes passam versões em memória.

function createVault({ db, local, userId }) {
  let key = null;
  let version = null;
  let status = 'off'; // ok | trancada (a senha deste login não abre a chave e o aparelho não tem cópia) | off

  const remember = (k, v) => {
    key = k;
    version = v;
    status = 'ok';
    local.write({ userId, version: v, key: k.toString('base64') });
  };
  const localCopy = () => {
    const c = local.read();
    return c && c.userId === userId && c.key ? { key: Buffer.from(c.key, 'base64'), version: c.version } : null;
  };

  // Aparelho ligando sozinho (sem senha): usa a cópia local se ela ainda é a chave em uso
  async function resume() {
    const c = localCopy();
    if (!c) return status;
    let row;
    try {
      row = await db.get();
    } catch {
      row = undefined; // sem internet: confia na cópia
    }
    if (row === null || (row && row.key_version !== c.version)) {
      status = 'trancada'; // chave apagada ou trocada em outro aparelho
      return status;
    }
    key = c.key;
    version = c.version;
    status = 'ok';
    return status;
  }

  // Você entrou com a senha (login no painel deste aparelho)
  async function unlock(password) {
    let row = await db.get();
    if (!row) {
      const k = crypto.randomBytes(32);
      const created = await db.insert({ ...wrapKey(k, password), key_version: 1 });
      if (created) {
        remember(k, 1);
        return { status, created: true };
      }
      row = await db.get(); // outro aparelho criou ao mesmo tempo
    }
    const k = unwrapKey(row, password);
    if (k) {
      remember(k, row.key_version);
      return { status };
    }
    // Senha nova (recuperada pelo e-mail): a cópia deste aparelho ainda abre os logins → tranca com a senha nova
    const c = localCopy();
    if (c && c.version === row.key_version) {
      await db.update({ ...wrapKey(c.key, password), key_version: c.version });
      remember(c.key, c.version);
      return { status, rewrapped: true };
    }
    key = null;
    status = 'trancada';
    return { status };
  }

  // Senha trocada pelo painel: tranca a mesma chave com a senha nova
  async function rewrap(password) {
    if (!key) return { status };
    await db.update({ ...wrapKey(key, password), key_version: version });
    return { status, rewrapped: true };
  }

  // Abrir com a senha antiga (chave trancada) e já trancar com a atual
  async function unlockOld(oldPassword, password) {
    const row = await db.get();
    const k = row && unwrapKey(row, oldPassword);
    if (!k) return { status, wrong: true };
    await db.update({ ...wrapKey(k, password), key_version: row.key_version });
    remember(k, row.key_version);
    return { status, rewrapped: true };
  }

  // Começar do zero: chave nova; os logins salvos com a antiga não abrem mais e saem do banco
  async function reset(password) {
    const row = await db.get();
    const v = (row ? row.key_version : 0) + 1;
    const k = crypto.randomBytes(32);
    if (row) await db.update({ ...wrapKey(k, password), key_version: v });
    else await db.insert({ ...wrapKey(k, password), key_version: v });
    await db.dropLogins();
    remember(k, v);
    return { status, reset: true };
  }

  return {
    resume,
    unlock,
    rewrap,
    unlockOld,
    reset,
    status: () => status,
    version: () => version,
    seal: (obj, aad) => {
      if (!key) throw new Error('Chave dos logins trancada');
      return seal(key, obj, `${aad}:${version}`);
    },
    open: (b64, aad, v) => {
      if (!key || v !== version) throw new Error('Login salvo com outra chave');
      return open(key, b64, `${aad}:${v}`);
    },
  };
}

// db de verdade (Supabase, como o usuário logado)
function supabaseDb(client, userId) {
  const fail = (r, what) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  return {
    async get() {
      const r = await client.from('user_keys').select('wrapped_key, salt, kdf, key_version').maybeSingle();
      fail(r, 'Ler a chave dos logins');
      return r.data;
    },
    async insert(row) {
      const r = await client.from('user_keys').insert(row);
      if (r.error && r.error.code === '23505') return false; // já existe
      fail(r, 'Criar a chave dos logins');
      return true;
    },
    async update(row) {
      const r = await client
        .from('user_keys')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('owner_id', userId);
      fail(r, 'Gravar a chave dos logins');
    },
    async dropLogins() {
      const r = await client.from('account_logins').delete().eq('owner_id', userId);
      fail(r, 'Apagar os logins antigos');
    },
  };
}

// Cópia da chave neste aparelho, protegida pelo Windows
function fileLocal(file, dpapi) {
  return {
    read() {
      try {
        return JSON.parse(dpapi.unprotect(fs.readFileSync(file, 'utf8')));
      } catch {
        return null;
      }
    },
    write(obj) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, dpapi.protect(JSON.stringify(obj)), { mode: 0o600 });
    },
  };
}

module.exports = { createVault, supabaseDb, fileLocal, encrypt, decrypt, wrapKey, unwrapKey, seal, open, deriveKek, KDF };
