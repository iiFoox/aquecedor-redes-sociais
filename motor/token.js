// Senha interna entre o painel e o motor. O motor gera uma nova a cada vez que liga e grava em
// data/motor.token (fora do Git); o painel lê o arquivo e manda em cada pedido (cabeçalho x-motor-token).
// Sem ela o motor recusa tudo: nenhum outro programa, nem um site aberto no navegador, aciona o robô.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(require('./paths').DATA, 'motor.token');
const HEADER = 'x-motor-token';

function create(file = FILE) {
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

function read(file = FILE) {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// Comparação em tempo constante (não vaza quantos caracteres bateram)
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { create, read, same, FILE, HEADER };
