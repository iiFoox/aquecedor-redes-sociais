/* global document, location, innerWidth */ // os page.evaluate rodam dentro do navegador
// Tela de login num Chromium de verdade, com o painel local (login em memória e motor falso; nada vai para a internet).
// Usa o painel gerado (web/dist): o "npm test" depois de "npm run build".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createAuth, REMEMBER_MS } = require('../painel/auth');
const { memoryStore } = require('../painel/authStore');
const { createPainel } = require('../painel/app');

const DIST = path.join(__dirname, '..', 'web', 'dist');
const SENHA = 'senha forte 123';

test('tela de login no navegador: página certa depois de entrar, cookie invisível ao JS, sessão vencida volta ao login', async (t) => {
  if (!fs.existsSync(path.join(DIST, 'login.html'))) return t.skip('painel não gerado (rode npm run build)');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    return t.skip('Chromium do Playwright não instalado');
  }
  let now = Date.now();
  const store = memoryStore({ now: () => now });
  // Motor falso: o painel abre (listas vazias), sem rede
  const motor = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/stream') || req.url.startsWith('/api/live')) {
      res.setHeader('content-type', 'text/event-stream');
      return res.write(': ok\n\n');
    }
    const empty = {
      '/api/meta': { phases: [], readyDay: 22, checklist: [], platforms: {} },
      '/api/config': { active: false, start: '08:00', end: '22:00', max: 2 },
    };
    res.end(JSON.stringify(empty[req.url] || []));
  });
  await new Promise((r) => motor.listen(0, '127.0.0.1', r));
  const auth = createAuth({ store, now: () => now });
  const server = createPainel({ auth, dist: DIST, motorPort: motor.address().port, readToken: () => 'x' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    // Abrir uma página do painel sem estar logado: cai no login, guardando o #conta/...
    await page.goto(`${base}/#conta/abc`);
    await page.waitForSelector('h1');
    assert.equal(new URL(page.url()).pathname, '/login');
    assert.equal(new URL(page.url()).hash, '#conta/abc');
    assert.equal(await page.textContent('h1'), 'Entrar');

    // Cadastro (liberado e neste PC): volta para a página em que estava
    await page.click('text=Criar conta');
    assert.equal(new URL(page.url()).pathname, '/cadastro');
    await page.fill('#email', 'eu@exemplo.com');
    await page.fill('#senha', SENHA);
    await page.fill('#confirma', SENHA);
    await Promise.all([page.waitForURL(`${base}/#conta/abc`), page.click('button[type=submit]')]);
    // O cookie da sessão é httpOnly: o JavaScript da página não enxerga
    assert.ok(!(await page.evaluate(() => document.cookie)).includes('wu_sess'));
    // Logado: /login pula direto para o painel
    await page.goto(`${base}/login`);
    assert.equal(new URL(page.url()).pathname, '/');

    // Sair e entrar de novo (senha errada mostra erro; o e-mail fica lembrado)
    await page.evaluate(() => fetch('/auth/sair', { method: 'POST' }));
    await page.goto(`${base}/#rotina`);
    await page.waitForSelector('#senha');
    assert.equal(await page.inputValue('#email'), 'eu@exemplo.com');
    await page.fill('#senha', 'errada 999');
    await page.click('button[type=submit]');
    await page.waitForSelector('.err-box');
    assert.match(await page.textContent('.err-box'), /E-mail ou senha incorretos/);
    await page.fill('#senha', SENHA);
    await page.check('.auth-check input');
    await Promise.all([page.waitForURL(`${base}/#rotina`), page.click('button[type=submit]')]);

    // Sessão vence com o painel aberto: na próxima atualização volta para o login, com aviso e na mesma página
    now += REMEMBER_MS + 60000;
    await page.waitForURL(/\/login#rotina$/, { timeout: 15000 });
    await page.waitForSelector('.auth-note');
    assert.match(await page.textContent('.auth-note'), /sessão expirou/);

    // Celular: sem rolagem para o lado
    await page.setViewportSize({ width: 360, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    assert.equal(await page.evaluate(() => location.pathname), '/login');
  } finally {
    await browser.close();
    server.close();
    motor.close();
  }
});
