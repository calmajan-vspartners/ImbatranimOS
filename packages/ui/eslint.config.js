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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // The SDK sits BELOW the OS: it is what apps link against, so it may
      // depend on nothing above itself. An import from core here would drag
      // the whole compositor into every app bundle and dissolve the seam.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@imbatranim/core', '@imbatranim/core/*'],
              message:
                'The SDK must not depend on the OS. Capabilities reach apps through the injected system handle; the handle implementation lives in core.',
            },
          ],
        },
      ],
    },
  },
])
