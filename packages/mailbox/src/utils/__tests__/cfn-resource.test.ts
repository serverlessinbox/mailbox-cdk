/// <reference types="jest" />

/**
 * cfn-resource: retaining the CloudFormation resource behind a construct. A construct without a CFN
 * default child must fail the synth, because a retention that silently did not apply is a resource
 * CloudFormation deletes with the stack.
 */

import { Template }                                       from 'aws-cdk-lib/assertions';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import { Stack }                                          from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';

import { retainOnEveryOperation, retainOnUpdateOrDelete } from '../cfn-resource';

describe('retainOnUpdateOrDelete', () => {
  it('retains the resource on update and delete, but not on a failed create', () => {
    const stack = new Stack();
    const role  = new iam.Role(stack, 'role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

    retainOnUpdateOrDelete(role);

    const [synthesizedRole] = Object.values(Template.fromStack(stack).findResources('AWS::IAM::Role'));
    expect(synthesizedRole).toMatchObject({ DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
  });

  it('throws naming the construct when it has no CloudFormation default child', () => {
    const stack = new Stack();
    const plain = new Construct(stack, 'plain');

    expect(() => retainOnUpdateOrDelete(plain)).toThrow('plain: expected its default child to be a CfnResource, found none');
  });
});

describe('retainOnEveryOperation', () => {
  it('retains the resource on update, delete and a failed create', () => {
    const stack = new Stack();
    const role  = new iam.Role(stack, 'role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

    retainOnEveryOperation(role);

    const [synthesizedRole] = Object.values(Template.fromStack(stack).findResources('AWS::IAM::Role'));
    expect(synthesizedRole).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });

  it('throws naming the construct when it has no CloudFormation default child', () => {
    const stack = new Stack();
    const plain = new Construct(stack, 'plain');

    expect(() => retainOnEveryOperation(plain)).toThrow('plain: expected its default child to be a CfnResource, found none');
  });
});
