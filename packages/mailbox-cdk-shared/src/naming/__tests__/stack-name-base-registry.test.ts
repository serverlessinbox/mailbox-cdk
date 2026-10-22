import { Template }                           from 'aws-cdk-lib/assertions';
import * as cdk                               from 'aws-cdk-lib';
import { BootstraplessSynthesizer }           from 'aws-cdk-lib';

import { StackNamedBucket }                   from '../../resources/buckets/named-bucket';
import { setStackNameBase, getStackNameBase } from '../stack-name-base-registry';

/**
 * Pins the per-stack name-base registry: one value per stack, the identical value may be registered
 * again, a different one is rejected. A silently replaced base would give resources of one stack
 * two different name bases.
 */
function newStack(): cdk.Stack {
  return new cdk.Stack(new cdk.App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function bucketNameOf(stack: cdk.Stack): string {
  const template = Template.fromStack(stack);
  template.resourcePropertiesCountIs('AWS::S3::Bucket', {}, 1);
  const resources  = template.findResources('AWS::S3::Bucket');
  const bucketName = Object.values(resources)[0].Properties.BucketName;
  expect(bucketName).toBeDefined();
  return JSON.stringify(bucketName);
}

describe('Stack Name Base Registry', () => {
  describe('setStackNameBase and getStackNameBase', () => {
    it('returns the value set for that stack', () => {
      const stack = newStack();

      setStackNameBase(stack, 'test-base-value');

      expect(getStackNameBase(stack)).toBe('test-base-value');
    });

    it('returns undefined when no name base is registered', () => {
      expect(getStackNameBase(newStack())).toBeUndefined();
    });

    it('throws when setting a different value twice', () => {
      const stack = newStack();

      setStackNameBase(stack, 'value1');

      expect(() => setStackNameBase(stack, 'value2')).toThrow(/Stack name base already registered/);
    });

    it('allows setting the same value twice', () => {
      const stack = newStack();

      setStackNameBase(stack, 'test-value');
      setStackNameBase(stack, 'test-value');

      expect(getStackNameBase(stack)).toBe('test-value');
    });

    it('handles tokens as name base', () => {
      const stack = newStack();
      const token = cdk.Fn.getAtt('SomeResource', 'Value');

      setStackNameBase(stack, token);

      expect(getStackNameBase(stack)).toBe(token);
    });
  });

  describe('StackNamedBucket with registry', () => {
    it('resolves to registered base when set before bucket creation', () => {
      const stack = newStack();
      setStackNameBase(stack, 'custom-base');

      new StackNamedBucket(stack, 'test-bucket', {});

      expect(bucketNameOf(stack)).toContain('custom-base');
    });

    it('resolves to registered base when set after bucket creation (Lazy evaluation)', () => {
      const stack = newStack();
      new StackNamedBucket(stack, 'test-bucket', {});

      setStackNameBase(stack, 'custom-base');

      expect(bucketNameOf(stack)).toContain('custom-base');
    });

    it('resolves to AWS::StackName when nothing is registered', () => {
      const stack = newStack();

      new StackNamedBucket(stack, 'test-bucket', {});

      expect(bucketNameOf(stack)).toContain('AWS::StackName');
    });

    it('uses explicit nameBase when provided (bypasses registry)', () => {
      const stack = newStack();
      setStackNameBase(stack, 'registered-base');

      new StackNamedBucket(stack, 'test-bucket', { nameBase: 'explicit-base' });

      const bucketName = bucketNameOf(stack);
      expect(bucketName).toContain('explicit-base');
      expect(bucketName).not.toContain('registered-base');
    });
  });
});
