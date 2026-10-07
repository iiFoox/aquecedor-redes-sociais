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
