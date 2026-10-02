import ts from 'typescript-eslint';

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
        projectService: true,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
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
      'custom/plan-labels': 'error',
    },
  },
];
