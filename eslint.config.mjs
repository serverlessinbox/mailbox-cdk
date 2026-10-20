import { fixupPluginRules } from '@eslint/compat';
import alignAssignments from 'eslint-plugin-align-assignments';
import arca from 'eslint-plugin-arca';
import ts from 'typescript-eslint';

// Lint-only tsconfigs, so tests, tools and scripts parse with type information
// without changing any package's build or test tsconfig.
const lintTsconfigs = [
  'packages/mailbox/tsconfig.eslint.json',
  'packages/mailbox-admin-api/tsconfig.json',
  'packages/mailbox-bundler/tsconfig.json',
  'packages/mailbox-cdk-shared/tsconfig.eslint.json',
  'packages/mailbox-cognito/tsconfig.eslint.json',
  'tsconfig.scripts.json',
];

// Custom rule for plan labels and change narration
const planLabelRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow plan labels and change narration in comments',
    },
  },
  create(context) {
    const pattern = /\bsubplan\b|\bPhase [A-Z0-9]\b|\bplan-[a-e]\b|\.claude\/|\bmoved (to|from)\b|\bpreviously\b|\bno longer\b/i;
    return {
      Program() {
        const sourceCode = context.sourceCode;
        sourceCode.getAllComments().forEach((comment) => {
          if (pattern.test(comment.value)) {
            context.report({
              node: comment,
              message: `Found plan label or change narration in comment: "${comment.value.trim()}"`,
            });
          }
        });
      },
    };
  },
};

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
      'align-assignments': fixupPluginRules(alignAssignments),
      arca,
      custom: {
        rules: {
          'plan-labels': planLabelRule,
        },
      },
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
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: null,
          leadingUnderscore: 'forbid',
        },
      ],
      'align-assignments/align-assignments': 'error',
      'arca/import-align': 'error',
      'arca/import-ordering': 'error',
      curly: ['error', 'all'],
      'custom/plan-labels': 'error',
      'max-classes-per-file': ['error', 1],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
];
