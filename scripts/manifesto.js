// electron-builder (afterPack): poda o que o app não usa (scripts/podar.js) e grava em resources/app a lista de
// arquivos do app com o tamanho (arquivos.json). O app confere essa lista ao abrir e se reinstala sozinho se faltar
// algo (desktop/integrity.js). A poda vem antes: a lista é do que sobrou.
const path = require('path');
const { writeManifest } = require('../desktop/integrity');
const { prune } = require('./podar');

exports.default = async function manifesto(context) {
  const dir = path.join(context.appOutDir, 'resources', 'app');
  const version = context.packager.appInfo.version;
  const cut = prune(dir);
  console.log(`  • poda: ${cut.packages} pacotes que só o PM2 usa e ${cut.files} arquivos de documentação/tipos`);
  const n = writeManifest(dir, version);
  console.log(`  • lista de arquivos do app: ${n} arquivos (arquivos.json)`);
};
