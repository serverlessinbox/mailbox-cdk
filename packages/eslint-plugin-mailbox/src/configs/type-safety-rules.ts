import type { TSESLint } from '@typescript-eslint/utils';

export const typeSafetyRules: TSESLint.FlatConfig.Rules = {
  '@typescript-eslint/no-explicit-any':                        'error',
  '@typescript-eslint/no-unsafe-assignment':                   'error',
  '@typescript-eslint/no-unsafe-member-access':                'error',
  '@typescript-eslint/no-unsafe-call':                         'error',
  '@typescript-eslint/no-unsafe-return':                       'error',
  '@typescript-eslint/no-unsafe-argument':                     'error',
  '@typescript-eslint/no-non-null-assertion':                  'error',
  '@typescript-eslint/ban-ts-comment':                         'error',
  '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
};
