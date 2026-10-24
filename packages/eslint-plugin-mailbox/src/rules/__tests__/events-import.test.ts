import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { eventsImport } from '../events-import';

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const eventValue = "import { value } from '../resources/events/audit-events-queue-event';";

tester.run('events-import', eventsImport, {
  valid:   [
    {
      name:     'a wiring lambda imports an event',
      filename: 'packages/mailbox/src/resources/lambdas/x.ts',
      code:     "import { value } from '../events/audit-events-queue-event';",
    },
    {
      name:     'an event file imports a sibling event',
      filename: 'packages/mailbox/src/resources/events/x.ts',
      code:     "import { value } from './audit-events-queue-event';",
    },
    {
      name:     'a platform-list file is not restricted',
      filename: 'packages/mailbox/src/resources/workflows/sweeper-workflow.ts',
      code:     "import { value } from '../events/stack-failed-event';",
    },
    {
      name:     'a contract is not restricted',
      filename: 'packages/mailbox/src/contracts/x.ts',
      code:     eventValue,
    },
    {
      name:     'core may import the type of an event',
      filename: 'packages/mailbox/src/core/x.ts',
      code:     "import type { value } from '../resources/events/audit-events-queue-event';",
    },
    {
      name:     'an exempt test file may import an event',
      filename: 'packages/mailbox/src/core/__tests__/x.test.ts',
      code:     eventValue,
    },
    {
      name:     'a kit lambda imports an event',
      filename: 'packages/mailbox-cdk-shared/src/resources/lambdas/x.ts',
      code:     "import { value } from '../events/audit-events-queue-event';",
    },
    {
      name:     'the kit index may import an event',
      filename: 'packages/mailbox-cdk-shared/src/index.ts',
      code:     "import { value } from './resources/events/audit-events-queue-event';",
    },
    {
      name:     'a cognito lambda imports an event',
      filename: 'packages/mailbox-cognito/src/resources/lambdas/x.ts',
      code:     "import { value } from '../events/audit-events-queue-event';",
    },
    {
      name:     'a workflow other than the sweeper imports an event type',
      filename: 'packages/mailbox/src/resources/workflows/other-workflow.ts',
      code:     "import type { value } from '../events/stack-failed-event';",
    },
  ],
  invalid: [
    {
      name:     'a workflow other than the sweeper imports an event value',
      filename: 'packages/mailbox/src/resources/workflows/other-workflow.ts',
      code:     "import { value } from '../events/stack-failed-event';",
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'core imports an event value',
      filename: 'packages/mailbox/src/core/x.ts',
      code:     eventValue,
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'platform imports an event value',
      filename: 'packages/mailbox/src/platform/x.ts',
      code:     eventValue,
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'a resource imports an event value',
      filename: 'packages/mailbox/src/resources/tables/x.ts',
      code:     "import { value } from '../events/audit-events-queue-event';",
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'a named mailbox event import from core is an event value',
      filename: 'packages/mailbox/src/core/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox/resources/events/audit-events-queue-event';",
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'a kit file imports a kit event value',
      filename: 'packages/mailbox-cdk-shared/src/x.ts',
      code:     "import { value } from '@serverlessinbox/mailbox-cdk-shared/resources/events/audit-events-queue-event';",
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'the cognito root imports a mailbox event value',
      filename: 'packages/mailbox-cognito/src/x.ts',
      code:     "import { value } from '../../mailbox/src/resources/events/audit-events-queue-event';",
      errors:   [{ messageId: 'eventImport' }],
    },
  ],
});
