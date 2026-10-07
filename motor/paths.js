// Pasta de dados deste aparelho (logins das contas, prints, login do aparelho, sessões do painel).
// Padrão: data/ do projeto. No aplicativo (ou para rodar um segundo aparelho de teste no mesmo PC): WU_DATA_DIR.
const path = require('path');

const DATA = process.env.WU_DATA_DIR ? path.resolve(process.env.WU_DATA_DIR) : path.join(__dirname, '..', 'data');

module.exports = { DATA };
