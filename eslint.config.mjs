// @ts-check

import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist',
    '**/build',
    '**/proto_generated',
    '**/.astro',
    '**/docs/public/*.js',
    'docs/**',
    'bruno',
    'packages/admin-client-lib/src/generated/**'
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase']
        }
      ]
    }
  }
);
