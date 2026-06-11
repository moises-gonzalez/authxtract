// ESLint flat config — TypeScript recommended rules + Prettier compatibility.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: [
            'dist/',
            'node_modules/',
            'playwright-report/',
            'test-results/',
            'blob-report/',
            'coverage/',
            '.authxtract/',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    }
);
