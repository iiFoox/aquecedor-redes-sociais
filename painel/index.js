// Painel: serve o site (web/dist) e repassa /api para o motor.
// Se o motor cair ou reiniciar, o painel continua no ar e avisa que o motor está voltando.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const motorToken = require('../motor/token');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env: usa as variáveis do sistema */
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const MOTOR_PORT = Number(process.env.MOTOR_PORT) || 3101;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

const app = express();

// Senha do painel (opcional): PANEL_PASSWORD no .env. Usuário qualquer, senha = PANEL_PASSWORD
if (PANEL_PASSWORD) {
  const expected = Buffer.from(PANEL_PASSWORD);
  app.use((req, res, next) => {
    const [, b64 = ''] = (req.headers.authorization || '').split(' ');
    const pass = Buffer.from(Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':'));
    if (pass.length === expected.length && crypto.timingSafeEqual(pass, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WarmUp Studio"').status(401).send('Senha necessária');
  });
}

// Repassa a requisição para o motor, sem ler o corpo (funciona também para o tempo real)
app.use('/api', (req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${MOTOR_PORT}`, [motorToken.HEADER]: motorToken.read() || '' };
  delete headers.authorization;
  delete headers.cookie; // o motor não precisa dos cookies do painel
  const up = http.request({ hostname: '127.0.0.1', port: MOTOR_PORT, path: req.originalUrl, method: req.method, headers }, (r) => {
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

// Painel gerado (npm run build). As outras rotas caem no index.html.
const DIST = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(DIST));
app.get('*', (_, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err && !res.headersSent)
      res.status(503).send('O painel ainda não foi gerado. Rode "npm run build" (o npm start faz isso sozinho).');
  });
});

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !PANEL_PASSWORD) {
  console.warn('⚠️  Painel aberto na rede SEM senha. Defina PANEL_PASSWORD no .env.');
}
const server = app.listen(PORT, HOST, () => console.log(`🔥 WarmUp Studio em http://localhost:${PORT}`));
server.on('error', (e) => {
  console.error(`❌ O painel não conseguiu usar a porta ${PORT}: ${e.message}`);
  process.exit(1);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', (m) => m === 'shutdown' && stop());
