/**
 * StackNamedBucket naming tests.
 *
 * Pins how the explicit physical bucket name is composed (`<account>-<name base>-<id>`) and where the
 * name base comes from: the prop, else the base registered for the stack (even when registered after
 * the bucket was constructed), else the stack name. A regression renames live buckets on deploy.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { setStackNameBase }              from '../../../naming/stack-name-base-registry';
import { StackNamedBucket }              from '../named-bucket';

const accountRef   = { Ref: 'AWS::AccountId' };
const stackNameRef = { Ref: 'AWS::StackName' };

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function nameOf(stack: cdk.Stack, bucket: StackNamedBucket): unknown {
  return stack.resolve(bucket.explicitBucketName);
}

describe('StackNamedBucket', () => {
  it('names the bucket <account>-<stack name>-<id> when no name base is given or registered', () => {
    const stack = createStack();

    const sut = new StackNamedBucket(stack, 'assets');

    expect(nameOf(stack, sut)).toEqual({
      'Fn::Join': ['', [accountRef, '-', stackNameRef, '-assets']],
    });
  });

  it('uses the name base registered for the stack, also when it is registered after the bucket', () => {
    const stack = createStack();
    const sut   = new StackNamedBucket(stack, 'assets');

    setStackNameBase(stack, 'registered');

    expect(nameOf(stack, sut)).toEqual({
      'Fn::Join': ['', [accountRef, '-registered-assets']],
    });
  });

  it('prefers the nameBase prop over the registered name base', () => {
    const stack = createStack();
    setStackNameBase(stack, 'registered');

    const sut = new StackNamedBucket(stack, 'assets', { nameBase: 'custom' });

    expect(nameOf(stack, sut)).toEqual({
      'Fn::Join': ['', [accountRef, '-custom-assets']],
    });
  });

  it('treats an empty nameBase as absent', () => {
    const stack = createStack();

    const sut = new StackNamedBucket(stack, 'assets', { nameBase: '' });

    expect(nameOf(stack, sut)).toEqual({
      'Fn::Join': ['', [accountRef, '-', stackNameRef, '-assets']],
    });
  });

  it('sets the template BucketName to the explicit bucket name', () => {
    const stack = createStack();

    const sut = new StackNamedBucket(stack, 'assets', { nameBase: 'custom' });

    Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
      BucketName: nameOf(stack, sut),
    });
  });
});
