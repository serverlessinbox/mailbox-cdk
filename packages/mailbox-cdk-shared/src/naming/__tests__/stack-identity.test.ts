/// <reference types="jest" />

/**
 * Pins how the stack's unique id renders in a template. Role, state machine and log group names are
 * built from these values, so a different intrinsic changes the physical names of resources that are
 * retained across deploys and which later deploys would then fail to recreate.
 */

import { Stack } from 'aws-cdk-lib';
import { StackIdentity } from '../stack-identity';

describe('StackIdentity', () => {
  const stack = new Stack();

  it('renders the guid as the third slash-separated part of the stack id', () => {
    expect(stack.resolve(StackIdentity.guid)).toEqual({
      'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }],
    });
  });

  it('renders the guid prefix as the first hyphen-separated part of the guid', () => {
    expect(stack.resolve(StackIdentity.guidPrefix)).toEqual({
      'Fn::Select': [0, { 'Fn::Split': ['-', { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] }] }],
    });
  });
});
