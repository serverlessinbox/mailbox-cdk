import { RuleTester }    from '@typescript-eslint/rule-tester';
import typescriptEslint  from 'typescript-eslint';

import { logicalIdHome } from '../logical-id-home';

// Covers the R4 placement rule: overrideLogicalId is written by a Stack class or by the allow-listed file.

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const coreFile = '/repo/packages/mailbox/src/core/x.ts';

tester.run('logical-id-home', logicalIdHome, {
  valid:   [
    {
      name:     'inside a class extending Stack',
      filename: coreFile,
      code:     'class Root extends Stack { pin() { this.overrideLogicalId("a"); } }',
    },
    {
      name:     'inside a class extending a qualified NestedStack',
      filename: coreFile,
      code:     'class Nested extends cdk.NestedStack { pin() { this.overrideLogicalId("a"); } }',
    },
    {
      name:     'the allow-listed file, outside any Stack',
      filename: '/repo/packages/mailbox/src/core/apis/apis-section.ts',
      code:     'construct.overrideLogicalId("a");',
    },
  ],
  invalid: [
    {
      name:     'outside any Stack in core/',
      filename: coreFile,
      code:     'construct.overrideLogicalId("a");',
      errors:   [{ messageId: 'logicalId', line: 1 }],
    },
    {
      name:     'inside a class that is not a Stack',
      filename: coreFile,
      code:     'class NotAStack { pin() { construct.overrideLogicalId("a"); } }',
      errors:   [{ messageId: 'logicalId', line: 1 }],
    },
    {
      name:     'the allow-listed path with a suffix is not the allow-listed file',
      filename: '/repo/packages/mailbox/src/core/apis/apis-section.ts.bak',
      code:     'construct.overrideLogicalId("a");',
      errors:   [{ messageId: 'logicalId', line: 1 }],
    },
  ],
});
