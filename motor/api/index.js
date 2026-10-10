// API interna do motor. Só o painel fala com ela (escuta apenas em 127.0.0.1).
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const store = require('../store');
const motorToken = require('../token');
const runner = require('../runner');
const cloud = require('../cloud');
const { version } = require('../../package.json');

// Atalho criado por "npm run autostart:ligar"
const AUTOSTART = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
  'WarmUp Studio.vbs',
);

// token: senha interna (motor/token.js). Só o painel a conhece.
// deviceUser(): usuário dono deste aparelho (null = ainda ninguém entrou aqui). Os testes passam o seu.
// deviceUser(): null também quando o login do aparelho caiu (senha trocada): o painel pede para entrar de novo
function createApi({ token, deviceUser = () => (cloud.ready() && !cloud.needsLogin() ? cloud.user().id : null) } = {}) {
  const app = express();

  // Tranca: o endereço tem de ser este PC (barra truques de DNS) e o pedido tem de trazer a senha interna.
  // /api/health fica aberto: só diz se o motor está ligado (o "npm run restaurar" usa).
  app.use((req, res, next) => {
    const port = req.socket.localPort;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
      return res.status(403).json({ error: 'Endereço não permitido' });
    if (req.path === '/api/health') return next();
    if (!motorToken.same(req.headers[motorToken.HEADER], token))
      return res.status(401).json({ error: 'Pedido recusado: só o painel fala com o motor' });
    // Quem está logado no painel (o painel sempre manda, sobrescrevendo o que vier do navegador)
    req.userId = String(req.headers['x-wu-user'] || '');
    if (!req.userId) return res.status(401).json({ error: 'Sem usuário do painel', auth: false });
    if (req.path.startsWith('/api/_device') || req.path === '/api/meta') return next();
    // O aparelho roda para um usuário só: quem entrou no painel tem de ser ele
    const owner = deviceUser();
    if (!owner)
      return res.status(503).json({
        error: cloud.needsLogin()
          ? 'O login deste aparelho caiu (a senha foi trocada?). Entre de novo no painel.'
          : 'Este aparelho ainda não está ligado à sua conta. Entre de novo no painel.',
        needsDevice: true,
      });
    if (owner !== req.userId)
      return res.status(403).json({ error: 'Este aparelho está ligado a outro usuário do WarmUp Studio.', otherUser: true });
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      sessions: Object.keys(runner.activeSessions()).length,
      pending: store.pendingCount(),
    });
  });
  // Situação do motor para a tela de ajustes
  app.get('/api/system', (_, res) => {
    res.json({
      version,
      uptime: Math.round(process.uptime()),
      pm2: process.env.pm_id !== undefined,
      app: process.env.WU_APP === '1', // aberto pelo aplicativo do Windows (desktop/main.js)
      restarts: Number(process.env.restart_time) || 0,
      autostart: fs.existsSync(AUTOSTART),
      sessions: Object.keys(runner.activeSessions()).length,
      pending: store.pendingCount(),
      tz: require('../rules').TZ,
      onHours: store.hours(), // horas em que este PC costuma ficar ligado (Rotina)
    });
  });
  app.use('/api', require('./device'), require('./accounts'), require('./proxies'), require('./config'), require('./stream'));
  app.use('/api', (_, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // JSON quebrado no corpo vira 400; o resto, 500 com a causa no terminal
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corpo da requisição não é um JSON válido' });
    console.error('Erro na API do motor:', err);
    res.status(500).json({ error: 'Erro interno no motor' });
  });
  return app;
}

module.exports = { createApi };
