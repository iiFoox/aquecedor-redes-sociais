const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

const unused = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true };

module.exports = [
  { ignores: ['node_modules/**', 'data/**', '.claude/**', 'web/**'] }, // web/ é TypeScript: checado pelo "npm run typecheck"
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['warn', unused], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  prettier,
];
