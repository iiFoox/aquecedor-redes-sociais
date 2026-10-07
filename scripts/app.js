// Abre o aplicativo a partir do projeto (npm run app), sem instalar. Gera o painel antes, se precisar.
// Terminais do VS Code trazem ELECTRON_RUN_AS_NODE=1, que faria o Electron rodar como Node puro: sai aqui.
const path = require('path');
const { spawn } = require('child_process');

require('./build-web').build();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = require('electron'); // caminho do executável do Electron
const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code) => process.exit(code || 0));
