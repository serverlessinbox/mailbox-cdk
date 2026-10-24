import type { TSESLint }       from '@typescript-eslint/utils';
import arca                    from 'eslint-plugin-arca';
import { globSync }            from 'node:fs';
import tseslint                from 'typescript-eslint';

import { mailboxRules }        from '../rules/mailbox-rules';

import { classFamilyFiles }    from './class-family-files';
import { forbiddenGrantRules } from './forbidden-grant-helpers';
import { styleRules }          from './style-rules';
import { typeSafetyRules }     from './type-safety-rules';

export interface RecommendedConfigOptions {
  readonly tsconfigRootDir: string;
  readonly extraConfigs?:   readonly TSESLint.FlatConfig.Config[];
}

export function recommendedConfig(options: RecommendedConfigOptions): TSESLint.FlatConfig.Config[] {
  const packageTsconfigs = globSync('packages/*/tsconfig.eslint.json', { cwd: options.tsconfigRootDir }).sort();
  const tsconfigs        = [...packageTsconfigs, 'packages/eslint-plugin-mailbox/tsconfig.json', 'tsconfig.scripts.json'];

  return [
    {
      files:           ['**/*.ts'],
      languageOptions: {
        parser:        tseslint.parser,
        parserOptions: {
          project:         tsconfigs,
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
      linterOptions:   {
        noInlineConfig:                true,
        reportUnusedDisableDirectives: 'error',
      },
      plugins:         {
        '@typescript-eslint': tseslint.plugin,
        arca,
        mailbox: { rules: mailboxRules },
      },
      rules:           {
        ...typeSafetyRules,
        ...styleRules,
        ...forbiddenGrantRules,
        'mailbox/align':         'error',
        'mailbox/events-import': 'error',
        'mailbox/kit-isolation': 'error',
        'mailbox/plan-labels':   'error',
        'mailbox/zone-imports':  'error',
      },
    },
    {
      files: [...classFamilyFiles],
      rules: { 'max-classes-per-file': 'off' },
    },
    {
      files: ['**/__tests__/**', '**/*.test.ts'],
      rules: { 'max-lines-per-function': 'off' },
    },
    ...(options.extraConfigs ?? []),
  ];
}
