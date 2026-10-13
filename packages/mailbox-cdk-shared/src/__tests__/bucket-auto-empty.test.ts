/**
 * Pins the template that BucketAutoEmpty synthesizes. The bucket grants must sit in a Policy of their own and
 * the custom resource must depend on it: a grant added to the role's shared DefaultPolicy is reverted by a
 * rollback before the resource's Delete runs, which then fails with AccessDenied and the bucket cannot be deleted.
 */

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CfnRole } from 'aws-cdk-lib/aws-iam';
import { Bucket, CfnBucket } from 'aws-cdk-lib/aws-s3';
import type { IArtifactResolver, ResolvedArtifact } from '@serverlessinbox/artifact-registry-cdk';
import { BucketAutoEmpty } from '../bucket-auto-empty';

/** Minimal stand-in for the real resolver — resolves everything to a fixed S3 location. */
const fakeResolver: IArtifactResolver = {
  getUrl: () => 'https://example.invalid/x.zip',
  getArn: () => 'arn:aws:s3:::artifacts/lambdas/x.zip',
  getVersion: () => 'dev',
  location: { bucketBase: 'artifacts', project: 'serverlessinbox' },
  resolve: (): ResolvedArtifact => ({ bucket: 'artifacts', key: 'lambdas/x.zip' }),
};

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

function synth() {
  const stack = newStack();
  const bucket = new Bucket(stack, 'target-bucket');
  const bucketAutoEmpty = BucketAutoEmpty.getOrCreate(stack, fakeResolver);
  bucketAutoEmpty.attach(stack, 'auto-empty', bucket);
  return {
    template: Template.fromStack(stack),
    bucketLogicalId: stack.getLogicalId(bucket.node.defaultChild as CfnBucket),
    roleLogicalId: stack.getLogicalId(bucketAutoEmpty.role?.node.defaultChild as CfnRole),
  };
}

const LIST_VERSIONS_STATEMENT = Match.objectLike({ Action: Match.arrayWith(['s3:ListBucketVersions']) });

describe('BucketAutoEmpty', () => {
  describe('Lambda', () => {
    it('is created once per stack', () => {
      const stack = newStack();

      const first = BucketAutoEmpty.getOrCreate(stack, fakeResolver);
      const second = BucketAutoEmpty.getOrCreate(stack, fakeResolver);

      expect(second).toBe(first);
    });

    it('wires the Lambda to the bundle entry point and the service name its configuration requires', () => {
      const { template } = synth();

      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Environment: { Variables: Match.objectLike({ SERVICE_NAME: 'bucket-auto-empty' }) },
      });
    });

    it('lets the Lambda read the status of its own stack', () => {
      const { template } = synth();

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            { Action: 'cloudformation:DescribeStacks', Effect: 'Allow', Resource: { Ref: 'AWS::StackId' } },
          ]),
        },
      });
    });
  });

  describe('attach', () => {
    it('puts the bucket grants in a dedicated Policy on the Lambda role, not in the role DefaultPolicy', () => {
      const { template, bucketLogicalId, roleLogicalId } = synth();

      const grantPolicies = template.findResources('AWS::IAM::Policy', {
        Properties: { PolicyDocument: { Statement: Match.arrayWith([LIST_VERSIONS_STATEMENT]) } },
      });

      expect(Object.keys(grantPolicies)).toHaveLength(1);
      expect(Object.keys(grantPolicies)[0].toLowerCase()).not.toContain('defaultpolicy');
      template.hasResourceProperties('AWS::IAM::Policy', {
        Roles: [{ Ref: roleLogicalId }],
        PolicyDocument: {
          Statement: [
            {
              Action: ['s3:ListBucket', 's3:ListBucketVersions'],
              Effect: 'Allow',
              Resource: { 'Fn::GetAtt': [bucketLogicalId, 'Arn'] },
            },
            {
              Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
              Effect: 'Allow',
              Resource: { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketLogicalId, 'Arn'] }, '/*']] },
            },
          ],
        },
      });
    });

    it('makes the custom resource depend on that Policy so it is deleted first', () => {
      const { template } = synth();
      const grantPolicyId = Object.keys(
        template.findResources('AWS::IAM::Policy', {
          Properties: { PolicyDocument: { Statement: Match.arrayWith([LIST_VERSIONS_STATEMENT]) } },
        }),
      )[0];

      template.hasResource('Custom::BucketAutoEmpty', { DependsOn: Match.arrayWith([grantPolicyId]) });
    });

    it('creates a custom resource that names the bucket and gives up after the Lambda timeout', () => {
      const { template, bucketLogicalId } = synth();

      template.resourceCountIs('Custom::BucketAutoEmpty', 1);
      template.hasResourceProperties('Custom::BucketAutoEmpty', {
        bucketName: { Ref: bucketLogicalId },
        ServiceTimeout: '900',
      });
    });

    it('refuses to attach when the Lambda has no execution role', () => {
      const stack = newStack();
      const bucketAutoEmpty = BucketAutoEmpty.getOrCreate(stack, fakeResolver);
      Object.defineProperty(bucketAutoEmpty, 'role', { value: undefined });

      expect(() => bucketAutoEmpty.attach(stack, 'auto-empty', new Bucket(stack, 'target-bucket'))).toThrow(
        'Lambda has no execution role',
      );
    });
  });
});
