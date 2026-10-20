/// <reference types="jest" />

/**
 * Pins the statement that lets a deployer function ask whether its parent stack is rolling back. Naming a
 * stack by a literal would bake the id of the stack it was synthesized as into a template deployed elsewhere,
 * and a wider resource would let the function read every stack of the account.
 */

import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { parentStackStatusReadStatement }       from '../parent-stack-status-read';

describe('parentStackStatusReadStatement', () => {
  const stack = new Stack(new App(), 'TestStack', { env: { account: '123456789012', region: 'us-west-2' }, synthesizer: new BootstraplessSynthesizer() });

  it('allows DescribeStacks on the stack the template is deployed as, even when it was synthesized with an environment', () => {
    const statement = stack.resolve(parentStackStatusReadStatement().toStatementJson());

    expect(statement).toEqual({ Effect: 'Allow', Action: 'cloudformation:DescribeStacks', Resource: { Ref: 'AWS::StackId' } });
  });
});
