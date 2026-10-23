import { createRequire } from 'node:module';
import arca from 'eslint-plugin-arca';
import ts from 'typescript-eslint';

// The plugin's TypeScript sources load through ts-node, which the register entry point installs.
const require = createRequire(import.meta.url);
require('@serverlessinbox/eslint-plugin-mailbox/register');
const mailboxPlugin = require('@serverlessinbox/eslint-plugin-mailbox');

// Lint-only tsconfigs, so tests, tools and scripts parse with type information
// without changing any package's build or test tsconfig.
const lintTsconfigs = [
  'packages/mailbox/tsconfig.eslint.json',
  'packages/mailbox-admin-api/tsconfig.json',
  'packages/mailbox-bundler/tsconfig.json',
  'packages/mailbox-cdk-shared/tsconfig.eslint.json',
  'packages/mailbox-cognito/tsconfig.eslint.json',
  'packages/eslint-plugin-mailbox/tsconfig.json',
  'tsconfig.scripts.json',
];

export default [
  {
    ignores: [
      'lib/',
      'dist/',
      '**/*.d.ts',
      '**/*.js',
      '.yarn/',
      'remote-git/',
      '**/*_pb.ts',
      '**/generated/**',
      'build/',
      '.pnp.cjs',
      '.pnp.loader.mjs',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        project: lintTsconfigs,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
      arca,
      mailbox: mailboxPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'signature',
            'call-signature',
            'field',
            'static-initialization',
            'constructor',
            ['public-get', 'public-set', 'public-method'],
            ['protected-get', 'protected-set', 'protected-method'],
            ['private-get', 'private-set', 'private-method'],
            ['#private-get', '#private-set', '#private-method'],
          ],
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: null,
          leadingUnderscore: 'forbid',
        },
        {
          selector: 'parameter',
          format: null,
          leadingUnderscore: 'allow',
        },
      ],
      'arca/import-align': 'error',
      'arca/import-ordering': 'error',
      'arca/import-quotes': 'error',
      'arca/newline-after-import-section': 'error',
      curly: ['error', 'all'],
      'mailbox/align': 'error',
      'mailbox/plan-labels': 'error',
      'id-length': [
        'error',
        {
          min: 3,
          properties: 'always',
          exceptions: ['i', 'j', 'k', 'id', 'ui', 's3', 't', 'ws', 'op', 'of', 'is'],
          exceptionPatterns: ['^[A-Z]'],
        },
      ],
      'max-classes-per-file': ['error', 1],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'no-restricted-properties': [
        'error',
        { property: 'grantReadData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs, including dynamodb:Scan.' },
        { property: 'grantWriteData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs.' },
        { property: 'grantReadWriteData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs, including dynamodb:Scan.' },
        { property: 'grantFullAccess', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs.' },
        { property: 'grantStreamRead', message: 'Use an exact-action grant method (iam-scoping section 0). CDK stream grant helpers grant more than the caller needs.' },
        { property: 'grantTableListStreams', message: 'Use an exact-action grant method (iam-scoping section 0). CDK stream grant helpers grant more than the caller needs.' },
      ],
    },
  },
  {
    // Family files: classes of one topic share one file (L-247); list each by name.
    files: ['packages/mailbox-admin-api/src/errors.ts'],
    rules: {
      'max-classes-per-file': 'off',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
];
