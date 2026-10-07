// Painel: tela de login, serve o site (web/dist) e repassa /api para o motor (só para quem entrou).
// Se o motor cair ou reiniciar, o painel continua no ar e avisa que o motor está voltando.
const path = require('path');
const { createAuth } = require('./auth');
const { supabaseStore } = require('./authStore');
const { createPainel } = require('./app');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env: usa as variáveis do sistema */
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const MOTOR_PORT = Number(process.env.MOTOR_PORT) || 3101;
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Faltam SUPABASE_URL e SUPABASE_KEY no .env (o login do painel usa o Supabase).');
  process.exit(1);
}

const auth = createAuth({ store: supabaseStore({ url: SUPABASE_URL, key: SUPABASE_KEY }) });
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
