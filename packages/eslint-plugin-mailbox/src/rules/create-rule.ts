import { ESLintUtils } from '@typescript-eslint/utils';

export const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/serverlessinbox/mailbox-cdk/tree/main/packages/eslint-plugin-mailbox#${name}`,
);
