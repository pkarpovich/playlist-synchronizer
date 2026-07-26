import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['dist']),
    js.configs.recommended,
    tseslint.configs.recommended,
    prettier,
]);
