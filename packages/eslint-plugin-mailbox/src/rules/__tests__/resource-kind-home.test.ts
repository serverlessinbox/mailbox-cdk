import { RuleTester }       from '@typescript-eslint/rule-tester';
import typescriptEslint     from 'typescript-eslint';

import { resourceKindHome } from '../resource-kind-home';

const tester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const corePath    = 'packages/mailbox/src/core/example.ts';
const tablesPath  = 'packages/mailbox/src/resources/tables/example.ts';
const lambdasPath = 'packages/mailbox/src/resources/lambdas/example.ts';
const topicsPath  = 'packages/mailbox/src/resources/topics/example.ts';

tester.run('resource-kind-home', resourceKindHome, {
  valid:   [
    {
      name:     'a bare covered class in its own kind folder',
      code:     'const table = new Table();',
      filename: tablesPath,
    },
    {
      name:     'a member covered class in its own kind folder',
      code:     'const table = new dynamodb.Table();',
      filename: tablesPath,
    },
    {
      name:     'a bare Function in the lambdas folder',
      code:     'const fn = new Function();',
      filename: lambdasPath,
    },
    {
      name:     'a lambda member Function in the lambdas folder',
      code:     'const fn = new lambda.Function();',
      filename: lambdasPath,
    },
    {
      name:     'a Function from a non-lambda namespace is not covered',
      code:     'const fn = new other.Function();',
      filename: corePath,
    },
    {
      name:     'a Function through a nested namespace is not covered',
      code:     'const fn = new cdk.aws_lambda.Function();',
      filename: corePath,
    },
    {
      name:     'a class no kind covers',
      code:     'const widget = new Widget();',
      filename: corePath,
    },
  ],
  invalid: [
    {
      name:     'a bare covered class outside resources',
      code:     'const table = new Table();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Table', folder: 'tables' } }],
    },
    {
      name:     'a member covered class outside resources',
      code:     'const table = new dynamodb.Table();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Table', folder: 'tables' } }],
    },
    {
      name:     'a covered class in a foreign kind folder',
      code:     'const table = new Queue();',
      filename: tablesPath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Queue', folder: 'queues' } }],
    },
    {
      name:     'a member Rule in the topics folder',
      code:     'const rule = new events.Rule();',
      filename: topicsPath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Rule', folder: 'events' } }],
    },
    {
      name:     'a StateMachine outside workflows',
      code:     'const machine = new StateMachine();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'StateMachine', folder: 'workflows' } }],
    },
    {
      name:     'a bare Function outside the lambdas folder',
      code:     'const fn = new Function();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Function', folder: 'lambdas' } }],
    },
    {
      name:     'a lambda member Function outside the lambdas folder',
      code:     'const fn = new lambda.Function();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Function', folder: 'lambdas' } }],
    },
    {
      name:     'an aws_lambda member Function outside the lambdas folder',
      code:     'const fn = new aws_lambda.Function();',
      filename: corePath,
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Function', folder: 'lambdas' } }],
    },
    {
      name:     'a covered class in a folder outside any kind',
      code:     'const table = new Table();',
      filename: 'packages/mailbox/src/resources/example.ts',
      errors:   [{ messageId: 'wrongFolder', data: { className: 'Table', folder: 'tables' } }],
    },
  ],
});
