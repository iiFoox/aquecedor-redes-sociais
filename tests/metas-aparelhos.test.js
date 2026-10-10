// Meta personalizada com vários aparelhos: os modelos ficam numa lista só no banco (user_config). Um aparelho que ainda
// não releu (relê a cada 2 min) não pode apagar o modelo que outro acabou de gravar, nem ressuscitar um apagado.
// Banco falso: guarda só o user_config; o resto responde vazio.
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../motor/store');
const custom = require('../motor/custom');
const platforms = require('../motor/platforms');

function fakeDb() {
  const db = { user: { goalTemplates: [] }, writes: 0, reads: 0, failRead: false };
  const builder = (table) => {
    const q = { table, op: 'select', payload: null };
    const run = async () => {
      if (table === 'user_config' && q.op === 'select') {
        db.reads++;
        if (db.failRead) return { data: null, error: { message: 'sem rede' } };
        return { data: { data: JSON.parse(JSON.stringify(db.user)) }, error: null };
      }
      if (table === 'user_config' && q.op === 'upsert') {
        db.writes++;
        db.user = JSON.parse(JSON.stringify(q.payload.data));
      }
      return { data: [], error: null };
    };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: () => run(),
      upsert: (p) => ((q.op = 'upsert'), (q.payload = p), chain),
      update: (p) => ((q.op = 'update'), (q.payload = p), chain),
      insert: (p) => ((q.op = 'insert'), (q.payload = p), chain),
      delete: () => ((q.op = 'delete'), chain),
      then: (ok, bad) => run().then(ok, bad),
    };
    return chain;
  };
  return { db, client: { from: builder } };
}

const tpl = (name, platform = 'tiktok', over = {}) =>
  custom.normalizeTemplate({ name, platform, ...over }, platforms[platform].plans, platforms[platform].actions);

test('dois aparelhos: gravar um modelo relê o banco antes e não apaga o que o outro aparelho gravou', async () => {
  const { db, client } = fakeDb();
  store._useClient(client);
  const a = tpl('Do aparelho A');
  await store.saveTemplate(a);
  assert.deepEqual(
    db.user.goalTemplates.map((t) => t.name),
    ['Do aparelho A'],
  );
  // Outro aparelho grava "B" direto no banco; este ainda não releu (a lista local só tem A)
  const b = tpl('Do aparelho B');
  db.user.goalTemplates.push(b);
  assert.equal(store.getConfig().goalTemplates.length, 1);
  await store.saveTemplate(tpl('Daqui C'));
  assert.deepEqual(db.user.goalTemplates.map((t) => t.name).sort(), ['Daqui C', 'Do aparelho A', 'Do aparelho B']);
  // O outro aparelho apagou A; este (desatualizado) edita C: A não volta
  db.user.goalTemplates = db.user.goalTemplates.filter((t) => t.id !== a.id);
  const c = store.getConfig().goalTemplates.find((t) => t.name === 'Daqui C');
  await store.saveTemplate({ ...c, readyDay: 30 });
  assert.deepEqual(db.user.goalTemplates.map((t) => t.name).sort(), ['Daqui C', 'Do aparelho B']);
  assert.equal(db.user.goalTemplates.find((t) => t.id === c.id).readyDay, 30);
  // Apagar daqui também relê antes (o B, que este aparelho nunca releu sozinho, fica)
  await store.removeTemplate(c.id);
  assert.deepEqual(
    db.user.goalTemplates.map((t) => t.name),
    ['Do aparelho B'],
  );
  await assert.rejects(store.removeTemplate(c.id), /não encontrado/);
});

test('dois aparelhos: mudanças ao mesmo tempo neste aparelho saem uma por vez, nenhuma se perde', async () => {
  const { db, client } = fakeDb();
  store._useClient(client);
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.saveTemplate(tpl(`Modelo ${n}`))));
  assert.equal(db.user.goalTemplates.length, 5);
  assert.equal(store.getConfig().goalTemplates.length, 5);
});

test('nome repetido na mesma plataforma é recusado (maiúsculas e espaços não contam); em outra plataforma pode', async () => {
  const { db, client } = fakeDb();
  store._useClient(client);
  const r = await store.saveTemplate(tpl('Rápida'));
  await assert.rejects(store.saveTemplate(tpl('  rápida ')), /Já existe um modelo do TikTok chamado/);
  await store.saveTemplate(tpl('Rápida', 'instagram'));
  // Editar o próprio modelo mantendo o nome passa
  await store.saveTemplate({ ...r, readyDay: 18 });
  assert.equal(db.user.goalTemplates.length, 2);
});

test('sem conexão ao gravar: o modelo não é gravado e o erro diz para tentar de novo', async () => {
  const { db, client } = fakeDb();
  store._useClient(client);
  db.failRead = true;
  await assert.rejects(store.saveTemplate(tpl('Sem rede')), /Sem conexão/);
  assert.equal(db.user.goalTemplates.length, 0);
  assert.equal(
    store.getConfig().goalTemplates.some((t) => t.name === 'Sem rede'),
    false,
  );
});

test('editar o modelo: a conta que usa refaz o plano de hoje com transição e o registro diz o que mudou', async () => {
  const { client } = fakeDb();
  store._useClient(client);
  const t = await store.saveTemplate(tpl('Usada', 'tiktok', { vary: false }));
  const acc = store.add({ platform: 'tiktok', username: 'usa_modelo', proxy: null, interests: [] });
  store.updateAccount(acc.id, { goalTemplate: t.id });
  const p = platforms.tiktok;
  const first = store.planOf(acc, p.planForDay);
  assert.equal(first.like, t.phases[0].like);
  await store.saveTemplate({ ...t, phases: t.phases.map((ph, i) => (i === 0 ? { ...ph, like: ph.like + 1 } : ph)) });
  assert.equal(acc.goalRamp, store.localDate(), 'transição não ligou');
  const log = acc.events.filter((e) => e.kind === 'log').map((e) => e.msg);
  assert.ok(
    log.some((m) => /Meta "Usada" editada: curtidas fase 1 de \d+ para \d+/.test(m)),
    log.join(' | '),
  );
  const again = store.planOf(acc, p.planForDay);
  assert.equal(again.like, t.phases[0].like + 1, 'plano de hoje não foi refeito');
});
