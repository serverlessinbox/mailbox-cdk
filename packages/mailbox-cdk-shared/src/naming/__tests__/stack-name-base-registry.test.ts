import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BootstraplessSynthesizer } from 'aws-cdk-lib';
import { setStackNameBase, getStackNameBase } from '../stack-name-base-registry';
import { StackNamedBucket } from '../../named-bucket';

describe('Stack Name Base Registry', () => {
  describe('setStackNameBase and getStackNameBase', () => {
    it('returns the value set for that stack', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const nameBase = 'test-base-value';
      setStackNameBase(stack, nameBase);
      const retrieved = getStackNameBase(stack);

      expect(retrieved).toBe(nameBase);
    });

    it('returns undefined when no name base is registered', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const retrieved = getStackNameBase(stack);
      expect(retrieved).toBeUndefined();
    });

    it('throws when setting a different value twice', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      setStackNameBase(stack, 'value1');
      expect(() => {
        setStackNameBase(stack, 'value2');
      }).toThrow(/Stack name base already registered/);
    });

    it('allows setting the same value twice (idempotent)', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const nameBase = 'test-value';
      setStackNameBase(stack, nameBase);
      setStackNameBase(stack, nameBase); // Should not throw

      const retrieved = getStackNameBase(stack);
      expect(retrieved).toBe(nameBase);
    });

    it('handles tokens as name base', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const token = cdk.Fn.getAtt('SomeResource', 'Value');
      setStackNameBase(stack, token);
      const retrieved = getStackNameBase(stack);

      expect(retrieved).toBe(token);
    });
  });

  describe('StackNamedBucket with registry', () => {
    it('resolves to registered base when set before bucket creation', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const nameBase = 'custom-base';
      setStackNameBase(stack, nameBase);

      new StackNamedBucket(stack, 'test-bucket', {});

      const template = Template.fromStack(stack);
      // The bucket should have a BucketName that includes the custom base
      template.resourcePropertiesCountIs('AWS::S3::Bucket', {}, 1);
      const resources = template.findResources('AWS::S3::Bucket');
      expect(Object.values(resources)[0].Properties.BucketName).toBeDefined();
      expect(JSON.stringify(Object.values(resources)[0].Properties.BucketName)).toContain('custom-base');
    });

    it('resolves to registered base when set after bucket creation (Lazy evaluation)', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      // Create bucket before registering name base
      new StackNamedBucket(stack, 'test-bucket', {});

      // Register name base after bucket creation
      const nameBase = 'custom-base';
      setStackNameBase(stack, nameBase);

      const template = Template.fromStack(stack);
      // The bucket should have a BucketName that includes the custom base (set after creation)
      template.resourcePropertiesCountIs('AWS::S3::Bucket', {}, 1);
      const resources = template.findResources('AWS::S3::Bucket');
      expect(Object.values(resources)[0].Properties.BucketName).toBeDefined();
      expect(JSON.stringify(Object.values(resources)[0].Properties.BucketName)).toContain('custom-base');
    });

    it('resolves to AWS::StackName when nothing is registered', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      new StackNamedBucket(stack, 'test-bucket', {});

      const template = Template.fromStack(stack);
      // The bucket should have a BucketName that includes AWS::StackName reference
      template.resourcePropertiesCountIs('AWS::S3::Bucket', {}, 1);
      const resources = template.findResources('AWS::S3::Bucket');
      const bucketName = Object.values(resources)[0].Properties.BucketName;
      expect(bucketName).toBeDefined();
      const bucketNameStr = JSON.stringify(bucketName);
      expect(bucketNameStr).toContain('AWS::StackName');
    });

    it('uses explicit nameBase when provided (bypasses registry)', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const registeredBase = 'registered-base';
      setStackNameBase(stack, registeredBase);

      const explicitBase = 'explicit-base';
      new StackNamedBucket(stack, 'test-bucket', {
        nameBase: explicitBase,
      });

      const template = Template.fromStack(stack);
      // The bucket should have a BucketName that includes the explicit base, not the registered one
      template.resourcePropertiesCountIs('AWS::S3::Bucket', {}, 1);
      const resources = template.findResources('AWS::S3::Bucket');
      const bucketName = Object.values(resources)[0].Properties.BucketName;
      expect(bucketName).toBeDefined();
      const bucketNameStr = JSON.stringify(bucketName);
      expect(bucketNameStr).toContain('explicit-base');
      expect(bucketNameStr).not.toContain('registered-base');
    });
  });
});
