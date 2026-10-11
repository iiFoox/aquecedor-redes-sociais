// Poda do app empacotado (chamada pelo scripts/manifesto.js, antes de gravar a lista de arquivos do autoconserto).
// O PM2 só serve para rodar pelo terminal ("npm run ligar") e já fica fora do pacote, mas as dependências dele
// (lodash, dayjs, async...) iam junto: ~2.000 arquivos à toa, que deixavam a instalação lenta no notebook.
// Aqui: parte das dependências do app (menos as de FORA_DO_APP), segue o package.json de cada pacote do jeito que o
// Node procura (node_modules da pasta e das de cima) e apaga os pacotes que ninguém usa. Também apaga o que não roda
// (documentação e tipos). MANTER: carregados com try/catch (o "debug" usa supports-color se existir).
const fs = require('fs');
const path = require('path');

const FORA_DO_APP = ['pm2'];
const MANTER = ['supports-color', 'has-flag'];
const NAO_RODA = /(\.md|\.markdown|\.d\.ts|\.d\.mts|\.d\.cts|\.map)$/i;

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Pasta do pacote "name" vista de "from" (sobe procurando node_modules, sem sair do app)
function find(name, from, appDir) {
  for (let d = from; d.startsWith(appDir); d = path.dirname(d)) {
    const c = path.join(d, 'node_modules', name);
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
    if (d === appDir) break;
  }
  return null;
}

// Todas as pastas de pacote dentro de node_modules (inclusive @escopo/nome e node_modules aninhados)
function allPackages(dir, out = []) {
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) return out;
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = path.join(nm, e.name);
    const kids = e.name.startsWith('@')
      ? fs
          .readdirSync(p, { withFileTypes: true })
          .filter((x) => x.isDirectory())
          .map((x) => path.join(p, x.name))
      : [p];
    for (const k of kids) {
      if (fs.existsSync(path.join(k, 'package.json'))) out.push(k);
      allPackages(k, out);
    }
  }
  return out;
}

function prune(appDir) {
  const root = readJson(path.join(appDir, 'package.json'));
  const need = new Set();
  const visit = (dir) => {
    if (!dir || need.has(dir)) return;
    need.add(dir);
    const pj = readJson(path.join(dir, 'package.json'));
    for (const k of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies, ...pj.peerDependencies })) visit(find(k, dir, appDir));
  };
  for (const k of Object.keys(root.dependencies || {})) if (!FORA_DO_APP.includes(k)) visit(find(k, appDir, appDir));
  for (const k of MANTER) visit(find(k, appDir, appDir));

  let packages = 0;
  for (const p of allPackages(appDir)) {
    if (need.has(p) || !fs.existsSync(p)) continue; // já foi junto com a pasta de cima
    fs.rmSync(p, { recursive: true, force: true });
    packages++;
  }
  // Pastas @escopo que ficaram vazias
  const nm = path.join(appDir, 'node_modules');
  if (fs.existsSync(nm))
    for (const e of fs.readdirSync(nm)) {
      const p = path.join(nm, e);
      if (e.startsWith('@') && fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    }
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (NAO_RODA.test(e.name)) {
        fs.rmSync(p, { force: true });
        files++;
      }
    }
  };
  if (fs.existsSync(nm)) walk(nm);
  return { packages, files };
}

module.exports = { prune, FORA_DO_APP, MANTER };
