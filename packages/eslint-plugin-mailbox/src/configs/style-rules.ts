import type { TSESLint } from '@typescript-eslint/utils';

export const styleRules: TSESLint.FlatConfig.Rules = {
  'arca/import-align':                    'error',
  'arca/import-ordering':                 'error',
  'arca/import-quotes':                   'error',
  'arca/newline-after-import-section':    'error',
  curly:                                  ['error', 'all'],
  'id-length':                            [
    'error',
    {
      min:               3,
      properties:        'always',
      exceptions:        ['i', 'j', 'k', 'id', 'ui', 's3', 't', 'ws', 'op', 'of', 'is'],
      exceptionPatterns: ['^[A-Z]'],
    },
  ],
  'max-classes-per-file':                 ['error', 1],
  'max-lines-per-function':               ['error', { max: 80, skipBlankLines: true, skipComments: true }],
  '@typescript-eslint/member-ordering':   [
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
      selector:          'default',
      format:            null,
      leadingUnderscore: 'forbid',
    },
    {
      selector:          'parameter',
      format:            null,
      leadingUnderscore: 'allow',
    },
  ],
};
