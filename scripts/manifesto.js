// electron-builder (afterPack): grava em resources/app a lista de arquivos do app com o tamanho (arquivos.json).
// O app confere essa lista ao abrir e se reinstala sozinho se faltar algo (desktop/integrity.js).
const path = require('path');
const { writeManifest } = require('../desktop/integrity');

exports.default = async function manifesto(context) {
  const dir = path.join(context.appOutDir, 'resources', 'app');
  const version = context.packager.appInfo.version;
  const n = writeManifest(dir, version);
  console.log(`  • lista de arquivos do app: ${n} arquivos (arquivos.json)`);
};
