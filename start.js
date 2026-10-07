// Sobe o motor e o painel juntos (npm start). Ctrl+C encerra os dois com segurança:
// o Ctrl+C chega aos dois programas pelo terminal, e este só espera eles terminarem.
const { spawn } = require('child_process');
const path = require('path');

let stopping = false;
const alive = new Set();

function launch(name, file) {
  const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  alive.add(name);
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  }
  child.on('exit', (code) => {
    alive.delete(name);
    if (!stopping) console.error(`[${name}] parou (código ${code}). ${name === 'motor' ? 'O painel continua no ar.' : ''}`);
    if (!alive.size) process.exit(code || 0);
  });
  return child;
}

// Painel desatualizado ou ainda não gerado: gera antes de subir
require('./scripts/build-web').build();

const children = [launch('motor', 'motor/index.js'), launch('painel', 'painel/index.js')];

process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  // No Windows o Ctrl+C do terminal já chega aos dois. Fora dele, repassa (pedido repetido é ignorado)
  if (process.platform !== 'win32') children.forEach((c) => c.kill('SIGINT'));
  setTimeout(() => process.exit(1), 35000).unref();
});
