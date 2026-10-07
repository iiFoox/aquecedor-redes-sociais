const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

const unused = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true };

module.exports = [
  { ignores: ['node_modules/**', 'data/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['warn', unused], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // Front atual: script comum no navegador, com funções chamadas pelo HTML (onclick)
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, Chart: 'readonly' } },
    rules: { 'no-unused-vars': ['warn', { ...unused, vars: 'local' }] },
  },
  prettier,
];
