/// <reference types="jest" />

import * as cdk from 'aws-cdk-lib';
import { resolveDeployerType } from '../deployer-type';
import { DEPLOYER_TYPE_CONTEXT_KEY } from '../context-keys';

describe('resolveDeployerType', () => {
  it('returns the valid context value', () => {
    const app = new cdk.App({ context: { [DEPLOYER_TYPE_CONTEXT_KEY]: 'marketplace' } });
    const stack = new cdk.Stack(app, 'TestStack');
    expect(resolveDeployerType(stack)).toBe('marketplace');
  });

  it('falls back to cdk when the context key is absent', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    expect(resolveDeployerType(stack)).toBe('cdk');
  });

  it('throws when the context value is present but invalid', () => {
    const app = new cdk.App({ context: { [DEPLOYER_TYPE_CONTEXT_KEY]: 'bogus' } });
    const stack = new cdk.Stack(app, 'TestStack');
    expect(() => resolveDeployerType(stack)).toThrow(
      `@serverlessinbox/mailbox: invalid CDK context value for "${DEPLOYER_TYPE_CONTEXT_KEY}": "bogus". ` +
      'Must be one of: cdk, cfn, marketplace.',
    );
  });
});
