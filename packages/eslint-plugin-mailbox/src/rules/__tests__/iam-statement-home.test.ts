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
  ],
});
