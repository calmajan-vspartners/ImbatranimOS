import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Codified convention: a leading underscore marks intentionally unused
      // (e.g. the windowId prop of single-instance apps).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Add-ons may import ONLY core's public surface — no deep paths into
      // core internals, no reaching into sibling add-ons.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@imbatranim/core/*'],
              message: "Import only the public surface: '@imbatranim/core'.",
            },
            {
              group: ['@imbatranim/!(core)', '@imbatranim/!(core)/*'],
              message: 'Add-ons must not import other add-ons.',
            },
            {
              group: ['../../core/*', '../../../core/*'],
              message: "No relative escapes into core — use '@imbatranim/core'.",
            },
          ],
        },
      ],
    },
  },
])
