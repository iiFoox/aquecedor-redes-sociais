// Prints das sessões no Supabase Storage (bucket privado "screens", pasta <dono>/<conta>/).
// O print é tirado em data/screens/<conta>/ e sobe em seguida; qualquer aparelho do usuário vê pelo painel.
const BUCKET = 'screens';
let client = null;
let userId = null;

function init(opts) {
  client = opts.client;
  userId = opts.userId;
}

const key = (accountId, file) => `${userId}/${accountId}/${file}`;

// Nunca derruba nada: print que não subiu continua no aparelho
async function upload(accountId, file, buffer) {
  if (!client) return false;
  const r = await client.storage.from(BUCKET).upload(key(accountId, file), buffer, { contentType: 'image/jpeg', upsert: true });
  if (r.error) console.error(`⚠️  Print não subiu para o Supabase: ${r.error.message}`);
  return !r.error;
}

async function remove(accountId, files) {
  if (!client || !files.length) return;
  await client.storage.from(BUCKET).remove(files.map((f) => key(accountId, f)));
}

async function download(accountId, file) {
  if (!client) return null;
  const r = await client.storage.from(BUCKET).download(key(accountId, file));
  if (r.error || !r.data) return null;
  return Buffer.from(await r.data.arrayBuffer());
}

// Apaga a pasta da conta (conta removida)
async function removeAll(accountId) {
  if (!client) return;
  const r = await client.storage.from(BUCKET).list(`${userId}/${accountId}`, { limit: 1000 });
  if (r.data && r.data.length)
    await remove(
      accountId,
      r.data.map((x) => x.name),
    );
}

module.exports = { init, upload, remove, download, removeAll, BUCKET };
