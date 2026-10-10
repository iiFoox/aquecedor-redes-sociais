// O app confere a própria instalação: arquivos.json (gerado no empacotamento por scripts/manifesto.js) lista cada
// arquivo do app com o tamanho. Faltou algum (atualização interrompida, antivírus, app aberto no meio da instalação):
// o motor cai com "Cannot find module" e nada funciona. desktop/main.js então se reinstala sozinho.
const fs = require('fs');
const path = require('path');

const MANIFEST = 'arquivos.json';

// Lista os arquivos de "dir" (caminhos com /) com o tamanho
function listFiles(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[path.relative(dir, p).split(path.sep).join('/')] = fs.statSync(p).size;
    }
  };
  walk(dir);
  delete files[MANIFEST];
  return files;
}

function writeManifest(dir, version) {
  const files = listFiles(dir);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ version, files }));
  return Object.keys(files).length;
}

/**
 * Confere a instalação. { ok: true } sem arquivos.json (rodando pelo projeto, sem empacotar).
 * Senão { ok, total, missing: [até 20 caminhos faltando ou com tamanho errado], count }.
 */
function check(dir) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? { ok: true, total: 0, missing: [], count: 0 } : { ok: false, total: 0, missing: [MANIFEST], count: 1 };
  }
  const bad = [];
  for (const [rel, size] of Object.entries(m.files || {})) {
    let st = null;
    try {
      st = fs.statSync(path.join(dir, rel));
    } catch {
      /* faltando */
    }
    if (!st || st.size !== size) bad.push(rel);
  }
  return { ok: !bad.length, total: Object.keys(m.files || {}).length, missing: bad.slice(0, 20), count: bad.length };
}

module.exports = { check, writeManifest, listFiles, MANIFEST };
