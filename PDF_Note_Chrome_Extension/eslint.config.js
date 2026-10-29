import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['pdf-note/vendor/**', 'node_modules/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['pdf-note/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly', PDFLib: 'readonly', fontkit: 'readonly' },
    },
    rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }] },
  },
  {
    files: ['tests/**/*.mjs', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
