import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['out/**', 'node_modules/**', '.vscode-test/**'] }, ...tseslint.configs.recommended, { files: ['scripts/**/*.cjs','test/ui/**/*.cjs'], languageOptions: { sourceType: 'commonjs' }, rules: { '@typescript-eslint/no-require-imports': 'off' } });
