/// <reference types="jest" />

/**
 * Pins the cognito data stack's name. The deployer deploys the stack under this name and the worker's
 * CloudFormation grant is scoped to it, so a change in either direction leaves a stack the worker may
 * not manage.
 */

import { App, Stack } from 'aws-cdk-lib';
import { cognitoDataStackName } from '../mailbox-cognito-data-stack-name';

describe('cognitoDataStackName', () => {
  it('is the deploying stack’s name followed by -cognito', () => {
    const stack = new Stack(new App(), 'test-stack');

    expect(stack.resolve(cognitoDataStackName())).toEqual({ 'Fn::Join': ['', [{ Ref: 'AWS::StackName' }, '-cognito']] });
  });
});
