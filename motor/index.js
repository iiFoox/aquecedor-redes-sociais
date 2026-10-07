// Motor: robô (Playwright), agendador e banco. Escuta só em 127.0.0.1; quem fala com ele é o painel.
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env: usa as variáveis do sistema */
}

const store = require('./store');
const runner = require('./runner');
const cloud = require('./cloud');
const boot = require('./boot');
const { createApi } = require('./api');

const PORT = Number(process.env.MOTOR_PORT) || 3101;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
let closing = false;

async function main() {
  // Senha interna nova a cada vez que o motor liga (o painel lê de data/motor.token)
  server = createApi({ token: require('./token').create() }).listen(PORT, '127.0.0.1', () =>
    console.log(`⚙️  Motor pronto em 127.0.0.1:${PORT}`),
  );
  server.on('error', (e) => {
    console.error(`❌ O motor não conseguiu usar a porta ${PORT}: ${e.message}`);
    process.exit(1);
  });
  // Login salvo deste aparelho: liga sozinho. Senão, espera você entrar no painel.
  if (await cloud.resume()) await boot.startDevice();
  else console.log('⏳ Entre no painel para ligar este aparelho à sua conta.');
}

// Fecha as sessões (elas gravam o histórico) e grava o que falta antes de sair
async function shutdown(reason, code = 0) {
  if (closing) return;
  closing = true;
  console.log(`\n💾 Encerrando o motor (${reason}): fechando sessões e salvando no Supabase...`);
  boot.stopAll();
  if (server) server.close();
  await Promise.race([runner.closeAll(), wait(20000)]);
  await Promise.race([store.flush(), wait(8000)]);
  process.exit(code);
}

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('pedido de parada'));
process.on('message', (m) => m === 'shutdown' && shutdown('pedido de parada'));
// Aberto pelo aplicativo (canal IPC): se o aplicativo cair, encerra também (no Windows o filho ficaria solto nas portas)
if (process.send) process.on('disconnect', () => shutdown('o aplicativo fechou'));
process.on('unhandledRejection', (e) => console.error('⚠️  Erro não tratado (o motor continua):', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => {
  console.error('❌ Falha grave no motor:', e);
  shutdown('falha grave', 1); // código 1: o PM2 sabe que caiu e reinicia
});

main().catch((e) => {
  console.error('❌ O motor não iniciou:', e.message);
  process.exit(1);
});
