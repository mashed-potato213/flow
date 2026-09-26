// ESLint v8 配置文件（项目是 type:module，所以必须用 .cjs）
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    worker: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'prefer-const': 'error',
    eqeqeq: ['error', 'smart'],
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.wrangler/',
    'public/sw.js',
    'coverage/',
    '*.config.js',
    '*.config.ts',
  ],
  overrides: [
    {
      files: ['worker/**/*.ts'],
      env: { worker: true },
    },
    {
      files: ['src/**/*.ts'],
      env: { browser: true },
    },
    {
      files: ['shared/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
