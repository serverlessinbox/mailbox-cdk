import { RuleTester }       from '@typescript-eslint/rule-tester';
import typescriptEslint     from 'typescript-eslint';

import { iamStatementHome } from '../iam-statement-home';

// Covers the R2 placement rule: IAM statements are written only in resources/, grants/ and the allow-list.

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const coreFile = '/repo/packages/mailbox/src/core/x.ts';

tester.run('iam-statement-home', iamStatementHome, {
  valid:   [
    {
      name:     'a statement in resources/',
      filename: '/repo/packages/mailbox/src/resources/lambdas/x.ts',
      code:     'const statement = new PolicyStatement();',
    },
    {
      name:     'a statement in the kit grants/',
      filename: '/repo/packages/mailbox-cdk-shared/src/grants/x.ts',
      code:     'const statement = new PolicyStatement();',
    },
    {
      name:     'an allow-listed file',
      filename: '/repo/packages/mailbox/src/core/apis/websocket.ts',
      code:     'const statement = new PolicyStatement();',
    },
    {
      name:     'an allow-listed sweeper file, exact path',
      filename: '/repo/packages/mailbox/src/platform/ops/sweeper/sweeper-infra.ts',
      code:     'const statement = new PolicyStatement();',
    },
    {
      name:     'a sweeper removal file matched by the glob',
      filename: '/repo/packages/mailbox/src/platform/ops/sweeper/edge-function-removal.ts',
      code:     'role.addToRolePolicy(statement);',
    },
    {
      name:     'a bare addToRolePolicy call is not a member call',
      filename: coreFile,
      code:     'addToRolePolicy(statement);',
    },
  ],
  invalid: [
    {
      name:     'a PolicyStatement in core/',
      filename: coreFile,
      code:     'const statement = new PolicyStatement();',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'a qualified Policy in core/',
      filename: coreFile,
      code:     'const policy = new iam.Policy();',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'addToRolePolicy in core/',
      filename: coreFile,
      code:     'role.addToRolePolicy(statement);',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'addToPrincipalPolicy in core/',
      filename: coreFile,
      code:     'role.addToPrincipalPolicy(statement);',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'the glob does not reach a sub-folder of the sweeper',
      filename: '/repo/packages/mailbox/src/platform/ops/sweeper/nested/edge-removal.ts',
      code:     'const statement = new PolicyStatement();',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'a sweeper file that is not allow-listed',
      filename: '/repo/packages/mailbox/src/platform/ops/sweeper/other.ts',
      code:     'const statement = new PolicyStatement();',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
    {
      name:     'an allow-listed name with a suffix is not the allow-listed file',
      filename: '/repo/packages/mailbox/src/core/apis/websocket.ts.bak',
      code:     'const statement = new PolicyStatement();',
      errors:   [{ messageId: 'iamStatement', line: 1 }],
    },
  ],
});
