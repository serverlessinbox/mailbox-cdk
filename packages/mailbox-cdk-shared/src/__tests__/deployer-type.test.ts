/// <reference types="jest" />

/**
 * Pins how the deployment mechanism is read from CDK context. A customer install passes no context at
 * all, so an unset key must resolve to 'cdk' rather than throw; a set but unknown value must throw,
 * because silently falling back would tag every resource with the wrong deployer type.
 */

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

  it('falls back to cdk when the context value is null', () => {
    const app = new cdk.App({ context: { [DEPLOYER_TYPE_CONTEXT_KEY]: null } });
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
