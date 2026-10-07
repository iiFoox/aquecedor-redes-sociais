// Painel: tela de login, serve o site (web/dist) e repassa /api para o motor (só para quem entrou).
// Se o motor cair ou reiniciar, o painel continua no ar e avisa que o motor está voltando.
const path = require('path');
const { createAuth } = require('./auth');
const http = require('http');
const { cloudStore } = require('./authStore');
const motorToken = require('../motor/token');
const { createPainel } = require('./app');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env: usa as variáveis do sistema */
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const MOTOR_PORT = Number(process.env.MOTOR_PORT) || 3101;

// Pedido interno ao motor deste aparelho (rotas que o navegador não alcança: login e chave dos logins)
function motorPost(route, payload, userId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: MOTOR_PORT,
        path: route,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          [motorToken.HEADER]: motorToken.read() || '',
          'x-wu-user': userId,
        },
        timeout: 60000,
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, ...JSON.parse(s) });
          } catch {
            resolve({ status: res.statusCode });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('O motor não respondeu')));
    req.end(body);
  });
}

// Quem acabou de entrar: o login do Supabase vai para o motor (o aparelho passa a rodar como ele) e a senha destranca
// a chave dos logins das contas (o motor não grava a senha)
const linkDevice = (session, userId, password) => motorPost('/api/_device/link', { ...session, password }, userId);
const vaultAction = (userId, req) => motorPost('/api/_device/vault', req, userId);

const auth = createAuth({
  store: cloudStore({ dir: path.join(require('../motor/paths').DATA, 'painel') }),
  onLogin: linkDevice,
  onVault: vaultAction,
});
const app = createPainel({ auth, dist: path.join(__dirname, '..', 'web', 'dist'), motorPort: MOTOR_PORT });

if (process.env.PANEL_PASSWORD) console.warn('ℹ️  PANEL_PASSWORD não é mais usada: o painel agora tem tela de login.');
const server = app.listen(PORT, HOST, () => console.log(`🔥 WarmUp Studio em http://localhost:${PORT}`));
server.on('error', (e) => {
  console.error(`❌ O painel não conseguiu usar a porta ${PORT}: ${e.message}`);
  process.exit(1);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', (m) => m === 'shutdown' && stop());
