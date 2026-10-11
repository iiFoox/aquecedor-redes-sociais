// Aplicativo do Windows: regras puras (cor da bandeja, versões, partes), bateria e atualização em partes.
// Nada aqui abre o Electron nem sai para a internet (o fetch é falso).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const logic = require('../desktop/logic');
const updater = require('../desktop/updater');
const power = require('../motor/power');
const rules = require('../motor/rules');

const info = (over = {}) => ({
  linked: true,
  ready: true,
  accounts: 2,
  running: 0,
  pilot: true,
  power: null,
  vault: 'ok',
  attention: [],
  ...over,
});

test('bandeja: cinza ligando, amarelo precisa de você, vermelho captcha/bloqueio, verde tudo certo', () => {
  assert.equal(logic.trayState(null).color, 'cinza');
  assert.equal(logic.trayState(info({ linked: false })).color, 'amarelo');
  assert.equal(logic.trayState(info({ ready: false })).color, 'cinza');
  assert.equal(logic.trayState(info({ attention: [{ kind: 'login' }] })).color, 'amarelo');
  assert.equal(logic.trayState(info({ attention: [{ kind: 'login' }, { kind: 'captcha' }] })).color, 'vermelho');
  assert.equal(logic.trayState(info({ attention: [{ kind: 'block' }] })).text, '1 conta(s) com captcha ou bloqueio');
  assert.equal(logic.trayState(info({ vault: 'trancada' })).color, 'amarelo');
  assert.equal(logic.trayState(info({ power: 'bateria' })).color, 'amarelo');
  assert.deepEqual(logic.trayState(info({ running: 2 })), { color: 'verde', text: 'aquecendo 2 conta(s)' });
  assert.equal(logic.trayState(info({ pilot: false })).text, 'ligado (piloto automático desligado)');
});

test('versões e partes', () => {
  assert.equal(logic.newer('2.1.0', '2.0.9'), true);
  assert.equal(logic.newer('2.0.10', '2.0.9'), true);
  assert.equal(logic.newer('2.0.0', '2.0.0'), false);
  assert.equal(logic.newer('2.0', '2.0.1'), false);
  assert.equal(logic.newer('3', '2.9.9'), true);
  assert.deepEqual(logic.chunks(10, 4), [
    [0, 4],
    [4, 8],
    [8, 10],
  ]);
  assert.deepEqual(logic.chunks(8, 4), [
    [0, 4],
    [4, 8],
  ]);
});

test('bateria: abaixo de 20% segura sessão nova; só solta na tomada ou acima de 25%', () => {
  assert.equal(power.holdFor({ onBattery: false, level: 5 }), null, 'na tomada nunca segura');
  assert.equal(power.holdFor({ onBattery: true, level: 50 }), null);
  assert.equal(power.holdFor({ onBattery: true, level: 19 }), 'bateria');
  assert.equal(power.holdFor({ onBattery: true, level: 22 }, 'bateria'), 'bateria', 'liga e desliga em 20%');
  assert.equal(power.holdFor({ onBattery: true, level: 22 }, null), null);
  assert.equal(power.holdFor({ onBattery: true, level: 25 }, 'bateria'), null);
  assert.equal(power.holdFor({ onBattery: true, level: null }), null, 'sem leitura não segura');
});

test('agendador: bateria fraca segura a conta (motivo "energia")', () => {
  const acc = { id: 'a', daily: {}, startedAt: new Date().toISOString(), history: [], attention: null };
  const ctx = { now: new Date(), config: { active: true, start: '00:00', end: '23:59', max: 2 }, powerHold: 'bateria' };
  assert.equal(rules.decide(acc, ctx), 'energia');
});

test('atualização: baixa as partes, confere cada uma e o instalador inteiro', async (t) => {
  const exe = crypto.randomBytes(100000);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const parts = logic
    .chunks(exe.length, 40000)
    .map(([s, e], i) => ({ name: `WarmUp-Studio-9.9.9.parte${i + 1}`, buf: exe.subarray(s, e) }));
  const manifest = {
    version: '9.9.9',
    file: 'WarmUp-Studio-Setup-9.9.9.exe',
    size: exe.length,
    sha256: sha(exe),
    parts: parts.map((p) => ({ name: p.name, size: p.buf.length, sha256: sha(p.buf) })),
  };
  const files = new Map(parts.map((p) => [p.name, p.buf]));
  const asked = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    asked.push(url);
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (name === 'latest.json') return new Response(JSON.stringify(manifest));
    if (files.has(name)) return new Response(files.get(name));
    return new Response('nada', { status: 404 });
  };
  t.after(() => (global.fetch = realFetch));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-upd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(await updater.latest('9.9.9'), null, 'mesma versão não é atualização');
  const m = await updater.latest('2.0.0');
  assert.equal(m.version, '9.9.9');
  const progress = [];
  const file = await updater.download(m, dir, (p) => progress.push(p));
  assert.ok(fs.readFileSync(file).equals(exe));
  assert.equal(progress.at(-1), 1);
  assert.ok(
    asked.every((u) => u.startsWith(updater.BASE)),
    'baixou de outro endereço',
  );

  // Parte adulterada: não instala nada
  files.set(parts[1].name, Buffer.concat([parts[1].buf.subarray(1), Buffer.from([0])]));
  fs.rmSync(file);
  await assert.rejects(updater.download(m, dir), /corrompida/);
  assert.equal(fs.existsSync(file), false);
  // Aviso de versão com nome de parte esquisito: recusa
  await assert.rejects(updater.download({ ...m, parts: [{ name: '../../x', sha256: 'a' }] }, dir), /inválido/);
});

test('bandeja: login do aparelho caído fica amarelo e diz o que fazer', () => {
  const t = logic.trayState(info({ needsLogin: true }));
  assert.equal(t.color, 'amarelo');
  assert.match(t.text, /entre de novo/);
});

test('atualização sozinha: só com a janela fechada e nada aberto', () => {
  assert.equal(logic.idleForUpdate(info(), false), true);
  assert.equal(logic.idleForUpdate(info(), true), false, 'janela aberta: pergunta');
  assert.equal(logic.idleForUpdate(info({ running: 1 }), false), false, 'sessão aquecendo');
  assert.equal(logic.idleForUpdate(info({ browsers: 1 }), false), false, 'navegador de login aberto');
  assert.equal(logic.idleForUpdate(null, false), false, 'motor sem responder');
});

test('depois de atualizar: confere a versão, tenta de novo até 3 vezes e esquece aviso velho', () => {
  const now = Date.parse('2026-10-07T20:00:00Z');
  const p = (o) => ({ from: '2.0.3', to: '2.0.4', at: now - 60000, attempts: 1, ...o });
  assert.equal(logic.pendingUpdate(null, '2.0.4', now), null);
  assert.equal(logic.pendingUpdate(p(), '2.0.4', now), 'ok');
  assert.equal(logic.pendingUpdate(p(), '2.0.5', now), 'ok', 'já passou da esperada');
  assert.equal(logic.pendingUpdate(p(), '2.0.3', now), 'tentar');
  assert.equal(logic.pendingUpdate(p({ attempts: 2 }), '2.0.3', now), 'tentar');
  assert.equal(logic.pendingUpdate(p({ attempts: 3 }), '2.0.3', now), 'desistir');
  assert.equal(logic.pendingUpdate(p({ at: now - 3 * 86400000 }), '2.0.3', now), 'ignorar');
});

test('instalar: avisa na hora se o instalador nem abre (arquivo sumiu)', async () => {
  await assert.rejects(updater.install(path.join(os.tmpdir(), `nao-existe-${Date.now()}.exe`)));
});

test('instalação: lista de arquivos no empacotamento; faltou ou mudou de tamanho = incompleta (o app se reinstala)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const integrity = require('../desktop/integrity');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-integ-'));
  try {
    // Rodando pelo projeto (sem lista): não confere
    assert.deepEqual(integrity.check(dir), { ok: true, total: 0, missing: [], count: 0 });
    fs.mkdirSync(path.join(dir, 'node_modules', 'playwright-extra'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'playwright-extra', 'index.js'), 'x'.repeat(50));
    fs.mkdirSync(path.join(dir, 'motor'));
    fs.writeFileSync(path.join(dir, 'motor', 'runner.js'), 'y'.repeat(10));
    assert.equal(integrity.writeManifest(dir, '9.9.9'), 2);
    assert.deepEqual(integrity.check(dir), { ok: true, total: 2, missing: [], count: 0 });
    // A atualização ficou pela metade: sumiu um módulo (o caso do notebook)
    fs.rmSync(path.join(dir, 'node_modules', 'playwright-extra'), { recursive: true });
    const r = integrity.check(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['node_modules/playwright-extra/index.js']);
    // Arquivo cortado (tamanho errado) também conta
    fs.writeFileSync(path.join(dir, 'motor', 'runner.js'), 'y');
    assert.equal(integrity.check(dir).count, 2);
    // Lista estragada: incompleta
    fs.writeFileSync(path.join(dir, 'arquivos.json'), '{lixo');
    assert.equal(integrity.check(dir).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canais: estável lê latest.json, teste lê latest-teste.json; canal desconhecido = estável', async (t) => {
  const updater = require('../desktop/updater');
  const man = (version) => ({ version, file: 'x.exe', sha256: 'a'.repeat(64), parts: [] });
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async (url) => {
    const name = new URL(url).pathname.split('/').pop();
    asked.push(name);
    if (name === 'latest.json') return new Response(JSON.stringify(man('2.1.2')));
    if (name === 'latest-teste.json') return new Response(JSON.stringify(man('2.2.0')));
    return new Response('nada', { status: 404 });
  };
  t.after(() => (global.fetch = realFetch));
  assert.equal((await updater.latest('2.1.0')).version, '2.1.2');
  assert.equal((await updater.latest('2.1.0', updater.BASE, 'teste')).version, '2.2.0');
  assert.equal((await updater.latest('2.1.0', updater.BASE, 'qualquer')).version, '2.1.2');
  assert.equal(await updater.latest('2.2.0', updater.BASE, 'teste'), null, 'já está na versão em teste');
  assert.deepEqual(asked, ['latest.json', 'latest-teste.json', 'latest.json', 'latest-teste.json']);
});

test('poda do pacote: tira o que só o PM2 usa e o que não roda; mantém tudo que o app carrega', () => {
  const { prune } = require('../scripts/podar');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-poda-'));
  const pkg = (dir, name, deps = {}, files = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, dependencies: deps }));
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;');
    for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), s);
  };
  const nm = (...p) => path.join(app, 'node_modules', ...p);
  pkg(app, 'app', { express: '1', '@supabase/supabase-js': '1', pm2: '1' });
  pkg(nm('express'), 'express', { 'on-finished': '1', debug: '1' }, { 'README.md': 'x', 'index.d.ts': 'x' });
  pkg(nm('on-finished'), 'on-finished', { 'ee-first': '1' });
  pkg(nm('ee-first'), 'ee-first');
  pkg(nm('debug'), 'debug', { ms: '1' });
  pkg(nm('ms'), 'ms');
  pkg(nm('@supabase', 'supabase-js'), '@supabase/supabase-js', { ws: '1' });
  pkg(nm('@supabase', 'supabase-js', 'node_modules', 'ws'), 'ws'); // aninhado: é dele
  pkg(nm('ws'), 'ws'); // o de cima é do pm2
  pkg(nm('pm2'), 'pm2', { lodash: '1', 'ee-first': '1', 'supports-color': '1' });
  pkg(nm('lodash'), 'lodash');
  pkg(nm('@pm2', 'io'), '@pm2/io');
  pkg(nm('supports-color'), 'supports-color', { 'has-flag': '1' });
  pkg(nm('has-flag'), 'has-flag');
  const r = prune(app);
  const has = (...p) => fs.existsSync(nm(...p));
  for (const p of [
    ['express'],
    ['on-finished'],
    ['ee-first'],
    ['debug'],
    ['ms'],
    ['@supabase', 'supabase-js'],
    ['@supabase', 'supabase-js', 'node_modules', 'ws'],
    ['supports-color'],
    ['has-flag'],
  ])
    assert.ok(has(...p), `tirou ${p.join('/')}, que o app usa`);
  for (const p of [['lodash'], ['ws'], ['pm2'], ['@pm2']]) assert.ok(!has(...p), `deixou ${p.join('/')}, que só o PM2 usa`);
  assert.ok(!has('express', 'README.md') && !has('express', 'index.d.ts') && has('express', 'index.js'));
  assert.deepEqual(r, { packages: 4, files: 2 });
  fs.rmSync(app, { recursive: true, force: true });
});
