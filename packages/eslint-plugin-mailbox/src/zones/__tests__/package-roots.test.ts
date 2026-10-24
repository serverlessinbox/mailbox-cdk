import { sourceRuleScope } from '../package-roots';

describe('sourceRuleScope', () => {
  it('lists the src tree of each source package as a file glob', () => {
    expect(sourceRuleScope.files).toEqual([
      'packages/mailbox/src/**/*.ts',
      'packages/mailbox-cdk-shared/src/**/*.ts',
      'packages/mailbox-cognito/src/**/*.ts',
    ]);
  });

  it('ignores the runtime and test folders of each source package', () => {
    expect(sourceRuleScope.ignores).toEqual([
      'packages/mailbox/src/runtime/**',
      'packages/mailbox/src/**/__tests__/**',
      'packages/mailbox-cdk-shared/src/runtime/**',
      'packages/mailbox-cdk-shared/src/**/__tests__/**',
      'packages/mailbox-cognito/src/runtime/**',
      'packages/mailbox-cognito/src/**/__tests__/**',
    ]);
  });
});
