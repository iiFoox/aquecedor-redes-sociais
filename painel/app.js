// O painel: login, proteção de tudo e repasse de /api ao motor (com a senha interna e o usuário logado).
// Separado do index.js para os testes subirem o painel com um login em memória e um motor falso.
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const motorToken = require('../motor/token');

const USER_HEADER = 'x-wu-user';

// Arquivos que a tela de login usa (lidos do login.html gerado): só eles abrem sem login
function loginAssets(dist) {
  const out = new Set(['/login', '/cadastro', '/nova-senha', '/favicon.svg', '/favicon.ico']);
  try {
    const html = fs.readFileSync(path.join(dist, 'login.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) out.add(m[1]);
  } catch {
    /* painel ainda não gerado */
  }
  return out;
}

function createPainel({ auth, dist, motorPort, readToken = motorToken.read }) {
  const app = express();
  app.disable('x-powered-by');
  const publicPaths = loginAssets(dist);

  app.use(auth.guard({ publicPaths }));
  app.use('/auth', auth.router);

  // Tela de login e de cadastro (já logado: vai direto para o painel, sem piscar a tela de login)
  const loginPage = async (req, res) => {
    if (await auth.sessionOf(req)) return res.redirect(302, '/');
    res.sendFile(path.join(dist, 'login.html'), (err) => {
      if (err && !res.headersSent) res.status(503).send('O painel ainda não foi gerado. Rode "npm run build".');
    });
  };
  app.get('/login', loginPage);
  app.get('/cadastro', loginPage);
  // Link do e-mail de "esqueci a senha": abre a tela de login no modo "senha nova" (mesmo se já estiver logado)
  app.get('/nova-senha', (req, res) => res.sendFile(path.join(dist, 'login.html')));

  // Repassa a requisição para o motor, sem ler o corpo (funciona também para o tempo real).
  // Leva a senha interna e quem está logado; nunca repassa cabeçalhos com esses nomes vindos do navegador.
  app.use('/api', (req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${motorPort}` };
    delete headers.authorization;
    delete headers.cookie; // o motor não precisa dos cookies do painel
    headers[motorToken.HEADER] = readToken() || '';
    headers[USER_HEADER] = req.session.userId;
    const up = http.request({ hostname: '127.0.0.1', port: motorPort, path: req.originalUrl, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      res.flushHeaders(); // tempo real: o navegador conecta na hora, sem esperar o primeiro evento
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent)
        res.status(503).json({ error: 'O motor está fora do ar ou reiniciando. Tente de novo em alguns segundos.', motorOff: true });
      else res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  });

  // Painel gerado (npm run build). Sem cache no index.html (ele aponta para os arquivos novos a cada build).
  app.use(express.static(dist, { index: false }));
  app.get('*', (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err && !res.headersSent)
        res.status(503).send('O painel ainda não foi gerado. Rode "npm run build" (o npm start faz isso sozinho).');
    });
  });
  return app;
}

module.exports = { createPainel, loginAssets, USER_HEADER };
