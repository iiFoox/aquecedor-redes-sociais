// Logins das contas no Supabase (account_logins), cifrados pelo cofre (vault.js).
// - Salva: quando o login é detectado e no fim de cada sessão (só se a conta estiver logada).
// - Restaura sozinho: quando a pasta do perfil não existe neste aparelho, ou quando a conta voltou de outro
//   aparelho com um login mais novo que o daqui.
// O que vai: cookies + dados do site (localStorage) da plataforma, pelo Playwright. Nada disso abre o TikTok/Instagram:
// a restauração usa uma página interna que não sai para a internet.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const SYNC_FILE = path.join(DATA, 'logins-sync.json');
const LOGIN_COOKIES = ['sessionid', 'sessionid_ss'];
const DOMAINS = { tiktok: 'tiktok.com', instagram: 'instagram.com' };

let client = null;
let vault = null;
let deviceId = null;
let userId = null;
const saved = new Map(); // conta -> { at (ms), deviceId, version }
let sync = null; // conta -> horário (ms) do login que este aparelho tem no perfil (salvo ou restaurado por ele)

function readSync() {
  if (sync) return sync;
  try {
    sync = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  } catch {
    sync = {};
  }
  return sync;
}
function writeSync(id, at) {
  readSync()[id] = at;
  try {
    fs.mkdirSync(path.dirname(SYNC_FILE), { recursive: true });
    fs.writeFileSync(SYNC_FILE + '.tmp', JSON.stringify(sync));
    fs.renameSync(SYNC_FILE + '.tmp', SYNC_FILE);
  } catch {
    /* só um índice: na pior hipótese restaura de novo */
  }
}

const onDomain = (host, domain) => {
  const h = String(host || '').replace(/^\./, '');
  return h === domain || h.endsWith(`.${domain}`);
};

// Conta logada? (cookie de sessão da plataforma)
function isLogged(state, platform) {
  const d = DOMAINS[platform];
  return !!state && state.cookies.some((c) => LOGIN_COOKIES.includes(c.name) && c.value && onDomain(c.domain, d));
}

// Só o que é da plataforma: todos os cookies (o login pode depender de domínios irmãos) e o localStorage do site
function trim(state, platform) {
  const d = DOMAINS[platform];
  return {
    cookies: state.cookies,
    origins: (state.origins || [])
      .filter((o) => {
        try {
          return onDomain(new URL(o.origin).hostname, d);
        } catch {
          return false;
        }
      })
      .map((o) => ({ origin: o.origin, localStorage: o.localStorage })),
  };
}

// Precisa restaurar antes de abrir o navegador?
// fresh: a pasta do perfil não existia. cloud: o que está salvo no Supabase. mine: horário do login que este aparelho tem.
function needsRestore({ fresh, cloud, mine, deviceId: me }) {
  if (!cloud) return false;
  if (fresh) return true;
  return cloud.deviceId !== me && cloud.at > (mine || 0);
}

function init(opts) {
  client = opts.client;
  vault = opts.vault;
  deviceId = opts.deviceId;
  userId = opts.userId;
  saved.clear();
  return reload();
}

// Quando cada login foi salvo (para o painel e para decidir a restauração)
async function reload() {
  if (!client) return;
  const r = await client.from('account_logins').select('account_id, updated_at, device_id, key_version');
  if (r.error) throw new Error(r.error.message);
  saved.clear();
  for (const x of r.data) saved.set(x.account_id, { at: Date.parse(x.updated_at), deviceId: x.device_id, version: x.key_version });
}

const ready = () => !!(client && vault && vault.status() === 'ok');

// Salva o login da conta (contexto aberto do navegador). Devolve o horário, ou null se não salvou.
async function save(ctx, account) {
  if (!ready()) return null;
  const state = await ctx.storageState();
  if (!isLogged(state, account.platform)) return null; // deslogada: não estraga o último login bom
  const at = Date.now();
  const row = {
    account_id: account.id,
    owner_id: userId,
    cipher: vault.seal(trim(state, account.platform), account.id),
    key_version: vault.version(),
    device_id: deviceId,
    updated_at: new Date(at).toISOString(),
  };
  const r = await client.from('account_logins').upsert(row);
  if (r.error) throw new Error(r.error.message);
  saved.set(account.id, { at, deviceId, version: row.key_version });
  writeSync(account.id, at);
  return at;
}

// Restaura no contexto recém-aberto, se for o caso. Devolve { at, deviceId } do login restaurado, ou null.
async function restoreIfNeeded(ctx, account, { fresh }) {
  if (!ready()) return null;
  const cloud = saved.get(account.id);
  if (!needsRestore({ fresh, cloud, mine: readSync()[account.id], deviceId })) return null;
  if (cloud.version !== vault.version()) return null; // salvo com uma chave antiga
  const r = await client
    .from('account_logins')
    .select('cipher, key_version, updated_at, device_id')
    .eq('account_id', account.id)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  const state = vault.open(r.data.cipher, account.id, r.data.key_version);
  await ctx.setStorageState(state);
  const at = Date.parse(r.data.updated_at);
  writeSync(account.id, at);
  return { at, deviceId: r.data.device_id };
}

module.exports = {
  init,
  reload,
  save,
  restoreIfNeeded,
  ready,
  savedAt: (id) => (saved.has(id) ? saved.get(id).at : null),
  forget: (id) => saved.delete(id),
  isLogged,
  trim,
  needsRestore,
  LOGIN_COOKIES,
  vault: () => vault,
};
