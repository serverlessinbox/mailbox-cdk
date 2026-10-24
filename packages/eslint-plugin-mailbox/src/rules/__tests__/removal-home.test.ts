import { RuleTester }   from '@typescript-eslint/rule-tester';
import typescriptEslint from 'typescript-eslint';

import { removalHome }  from '../removal-home';

// Covers the R5 removal boundary: IResourceRemoval implementations and grantStatements() holders live in the sweeper folder.

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const opsFile     = '/repo/packages/mailbox/src/platform/ops/x.ts';
const sweeperFile = '/repo/packages/mailbox/src/platform/ops/sweeper/x.ts';

tester.run('removal-home', removalHome, {
  valid:   [
    {
      name:     'a bare IResourceRemoval implementation in the sweeper folder',
      filename: sweeperFile,
      code:     'class Removal implements IResourceRemoval {}',
    },
    {
      name:     'a qualified IResourceRemoval implementation in the sweeper folder',
      filename: sweeperFile,
      code:     'class Removal implements ns.IResourceRemoval {}',
    },
    {
      name:     'grantStatements next to PolicyStatement in the sweeper folder',
      filename: sweeperFile,
      code:     'import { PolicyStatement } from "x"; class Holder { grantStatements() { return []; } }',
    },
    {
      name:     'grantStatements without a PolicyStatement name',
      filename: opsFile,
      code:     'class Holder { grantStatements() { return []; } }',
    },
    {
      name:     'an implements clause for another interface',
      filename: opsFile,
      code:     'class Other implements IOther {}',
    },
  ],
  invalid: [
    {
      name:     'a bare IResourceRemoval implementation outside the sweeper',
      filename: opsFile,
      code:     'class Removal implements IResourceRemoval {}',
      errors:   [{ messageId: 'bareRemoval', line: 1 }],
    },
    {
      name:     'a qualified IResourceRemoval implementation outside the sweeper',
      filename: opsFile,
      code:     'class Removal implements ns.IResourceRemoval {}',
      errors:   [{ messageId: 'qualifiedRemoval', line: 1 }],
    },
    {
      name:     'grantStatements next to PolicyStatement outside the sweeper',
      filename: opsFile,
      code:     'import { PolicyStatement } from "x";\nclass Holder { grantStatements() { return []; } }',
      errors:   [{ messageId: 'statementHolder', line: 1 }],
    },
  ],
});
