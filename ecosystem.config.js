// PM2: mantém o motor e o painel rodando em segundo plano e reinicia se algum cair.
// Use pelos comandos do package.json (npm run ligar / desligar / status / logs).
const path = require('path');

const logs = path.join(__dirname, 'data', 'logs');
const common = {
  cwd: __dirname,
  autorestart: true,
  min_uptime: '30s', // caiu antes de 30 s = início com problema
  max_restarts: 30,
  exp_backoff_restart_delay: 2000, // espera cada vez mais entre reinícios seguidos (até 15 s)
  shutdown_with_message: true, // no Windows o PM2 avisa por mensagem; o programa fecha com segurança
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'warmup-motor',
      script: 'motor/index.js',
      kill_timeout: 35000, // tempo para fechar as sessões e salvar no Supabase
      max_memory_restart: '1500M',
      out_file: path.join(logs, 'motor.log'),
      error_file: path.join(logs, 'motor-erros.log'),
    },
    {
      ...common,
      name: 'warmup-painel',
      script: 'painel/index.js',
      kill_timeout: 5000,
      out_file: path.join(logs, 'painel.log'),
      error_file: path.join(logs, 'painel-erros.log'),
    },
  ],
};
