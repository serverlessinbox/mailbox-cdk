import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { eventsImport } from '../events-import';

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const restricted  = 'packages/mailbox/src/core/x.ts';
const eventModule = '../resources/events/audit-events-queue-event';

tester.run('events-import', eventsImport, {
  valid:   [
    {
      name:     'an importer allowed to import events imports an event value',
      filename: 'packages/mailbox/src/resources/lambdas/x.ts',
      code:     "import { value } from '../events/audit-events-queue-event';",
    },
    {
      name:     'a restricted importer imports the type of an event',
      filename: restricted,
      code:     `import type { value } from '${eventModule}';`,
    },
    {
      name:     'a restricted importer imports a module that is not an event',
      filename: restricted,
      code:     "import { value } from './other';",
    },
    {
      name:     'a restricted importer re-exports the type of an event',
      filename: restricted,
      code:     `export type { value } from '${eventModule}';`,
    },
    {
      name:     'a restricted importer re-exports all types of an event',
      filename: restricted,
      code:     `export type * from '${eventModule}';`,
    },
    {
      name:     'a restricted importer exports a local binding without a source',
      filename: restricted,
      code:     'const value = 1; export { value };',
    },
  ],
  invalid: [
    {
      name:     'a restricted importer imports an event value',
      filename: restricted,
      code:     `import { value } from '${eventModule}';`,
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'a restricted importer re-exports everything from an event',
      filename: restricted,
      code:     `export * from '${eventModule}';`,
      errors:   [{ messageId: 'eventImport' }],
    },
    {
      name:     'a restricted importer re-exports a named value from an event',
      filename: restricted,
      code:     `export { value } from '${eventModule}';`,
      errors:   [{ messageId: 'eventImport' }],
    },
  ],
});
