import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { kitIsolation } from '../kit-isolation';

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

tester.run('kit-isolation', kitIsolation, {
  valid:   [
    {
      name:     'the kit imports its own package by name',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox-cdk-shared/resources/x';",
    },
    {
      name:     'a package whose name only starts with the mailbox name is not the mailbox',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '@serverlessinbox/mailboxx/core/x';",
    },
    {
      name:     'the kit imports cognito by relative path',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '../../mailbox-cognito/src/x';",
    },
    {
      name:     'an exempt runtime file of the kit may import the mailbox',
      filename: 'packages/mailbox-cdk-shared/src/runtime/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox/core/x';",
    },
    {
      name:     'the mailbox may import the kit',
      filename: 'packages/mailbox/src/core/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox-cdk-shared/resources/x';",
    },
    {
      name:     'the kit exports a local binding without a source',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     'const value = 1; export { value };',
    },
  ],
  invalid: [
    {
      name:     'the kit re-exports everything from the mailbox',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "export * from '@serverlessinbox/mailbox/core/x';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
    {
      name:     'the kit re-exports a named value from the mailbox',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "export { value } from '@serverlessinbox/mailbox/core/x';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
    {
      name:     'the kit imports the mailbox root by name',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
    {
      name:     'the kit imports a mailbox subpath by name',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox/core/x';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
    {
      name:     'the kit root imports the mailbox source by relative path',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '../../mailbox/src/core/x';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
    {
      name:     'a kit lambda imports the mailbox source by relative path',
      filename: 'packages/mailbox-cdk-shared/src/resources/lambdas/x.ts',
      code:     "import type { value } from '../../../../mailbox/src/core/x';",
      errors:   [{ messageId: 'mailboxImport' }],
    },
  ],
});
