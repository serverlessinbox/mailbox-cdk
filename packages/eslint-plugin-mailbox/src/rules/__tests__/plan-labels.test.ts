import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { planLabels }   from '../plan-labels';

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

tester.run('plan-labels', planLabels, {
  valid:   [
    {
      name: 'a plain comment',
      code: 'const value = 1; // reads the table',
    },
    {
      name: 'subplans is not the subplan label',
      code: 'const value = 1; // subplans are listed below',
    },
    {
      name: 'Phase followed by a word is not the Phase label',
      code: 'const value = 1; // Phase Alpha is a name',
    },
    {
      name: 'plan- followed by a letter after e is not a plan label',
      code: 'const value = 1; // plan-f fallback',
    },
    {
      name: 'the claude folder without the leading dot is not the .claude/ reference',
      code: 'const value = 1; // see the claude skills folder',
    },
    {
      name: 'moves is not moved to or moved from',
      code: 'const value = 1; // the handler moves config',
    },
    {
      name: 'a comment without previously',
      code: 'const value = 1; // this reads the table',
    },
    {
      name: 'not longer is not no longer',
      code: 'const value = 1; // the cache is not longer lived',
    },
  ],
  invalid: [
    {
      name:   'subplan is a plan label',
      code:   'const value = 1; // the subplan owns this',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'Phase followed by a single capital or digit is a plan label',
      code:   'const value = 1; // Phase A kept for now',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'plan- followed by a letter a to e is a plan label',
      code:   'const value = 1; // plan-c fallback',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'a .claude/ reference is a plan label',
      code:   'const value = 1; // see .claude/skills for rules',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'moved to is change narration',
      code:   'const value = 1; // moved to the shared package',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'previously is change narration',
      code:   'const value = 1; // previously this read the table',
      errors: [{ messageId: 'planLabel' }],
    },
    {
      name:   'no longer is change narration',
      code:   'const value = 1; // no longer used by the loader',
      errors: [{ messageId: 'planLabel' }],
    },
  ],
});
