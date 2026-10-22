/**
 * Pins the IAM statements the S3 grant helpers synthesize: exact object actions on the key pattern's
 * ARN, the KMS actions added only for the object actions that need the key, and a prefix-conditioned
 * ListBucket. A regression widens a role's bucket access or leaves a caller without the key actions
 * its object actions require.
 */

import { Match, Template }                                from 'aws-cdk-lib/assertions';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import * as kms                                           from 'aws-cdk-lib/aws-kms';
import * as s3                                            from 'aws-cdk-lib/aws-s3';
import * as cdk                                           from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                  from 'aws-cdk-lib';

import { S3Actions, grantListBucket, grantObjectActions } from '../s3-grants';

interface GetAtt {
  readonly 'Fn::GetAtt': string[];
}

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function createRole(stack: cdk.Stack): iam.Role {
  return new iam.Role(stack, 'TestRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
}

function createEncryptedBucket(stack: cdk.Stack, key: kms.Key): s3.Bucket {
  return new s3.Bucket(stack, 'TestBucket', { encryption: s3.BucketEncryption.KMS, encryptionKey: key });
}

function arnOf(stack: cdk.Stack, resource: s3.Bucket | kms.Key): GetAtt {
  return { 'Fn::GetAtt': [stack.getLogicalId(resource.node.defaultChild as cdk.CfnResource), 'Arn'] };
}

function objectsArnOf(stack: cdk.Stack, bucket: s3.Bucket, keyPattern: string): unknown {
  return { 'Fn::Join': ['', [arnOf(stack, bucket), `/${keyPattern}`]] };
}

function expectRolePolicy(stack: cdk.Stack, role: iam.Role, statements: unknown): void {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
    PolicyDocument: { Statement: statements },
  });
}

describe('grantObjectActions', () => {
  it('grants exactly the given actions on the key pattern objects of an unencrypted bucket, no KMS', () => {
    const stack  = createStack();
    const bucket = new s3.Bucket(stack, 'TestBucket');
    const role   = createRole(stack);

    grantObjectActions(role, bucket, S3Actions.readDelete, 'email/*');

    expectRolePolicy(stack, role, Match.arrayEquals([
      Match.objectEquals({
        Action:   ['s3:GetObject', 's3:DeleteObject'],
        Effect:   'Allow',
        Resource: objectsArnOf(stack, bucket, 'email/*'),
      }),
    ]));
  });

  it('adds GenerateDataKey, Decrypt and DescribeKey on a customer-managed key for read and write actions', () => {
    const stack  = createStack();
    const key    = new kms.Key(stack, 'TestKey');
    const bucket = createEncryptedBucket(stack, key);
    const role   = createRole(stack);

    grantObjectActions(role, bucket, S3Actions.readWrite, 'email/*');

    expectRolePolicy(stack, role, Match.arrayEquals([
      Match.objectEquals({
        Action:   ['s3:GetObject', 's3:PutObject'],
        Effect:   'Allow',
        Resource: objectsArnOf(stack, bucket, 'email/*'),
      }),
      Match.objectEquals({
        Action:   ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
        Effect:   'Allow',
        Resource: arnOf(stack, key),
      }),
    ]));
  });

  it('adds only Decrypt and DescribeKey on a customer-managed key for read actions', () => {
    const stack  = createStack();
    const key    = new kms.Key(stack, 'TestKey');
    const bucket = createEncryptedBucket(stack, key);
    const role   = createRole(stack);

    grantObjectActions(role, bucket, S3Actions.read, 'email/*');

    expectRolePolicy(stack, role, Match.arrayEquals([
      Match.objectEquals({
        Action:   's3:GetObject',
        Effect:   'Allow',
        Resource: objectsArnOf(stack, bucket, 'email/*'),
      }),
      Match.objectEquals({
        Action:   ['kms:Decrypt', 'kms:DescribeKey'],
        Effect:   'Allow',
        Resource: arnOf(stack, key),
      }),
    ]));
  });

  it('adds no KMS statement on a customer-managed key for delete actions alone', () => {
    const stack  = createStack();
    const key    = new kms.Key(stack, 'TestKey');
    const bucket = createEncryptedBucket(stack, key);
    const role   = createRole(stack);

    grantObjectActions(role, bucket, S3Actions.delete, 'email/*');

    expectRolePolicy(stack, role, Match.arrayEquals([
      Match.objectEquals({
        Action:   's3:DeleteObject',
        Effect:   'Allow',
        Resource: objectsArnOf(stack, bucket, 'email/*'),
      }),
    ]));
  });
});

describe('grantListBucket', () => {
  it('grants ListBucket on the bucket ARN restricted to the key prefix pattern', () => {
    const stack  = createStack();
    const bucket = new s3.Bucket(stack, 'TestBucket');
    const role   = createRole(stack);

    grantListBucket(role, bucket, 'email/*');

    expectRolePolicy(stack, role, Match.arrayEquals([
      Match.objectEquals({
        Action:    's3:ListBucket',
        Condition: { StringLike: { 's3:prefix': 'email/*' } },
        Effect:    'Allow',
        Resource:  arnOf(stack, bucket),
      }),
    ]));
  });
});

describe('S3Actions', () => {
  it('contains no bucket-level, wildcard or listing actions', () => {
    const all: string[] = Object.values(S3Actions).flat();

    for (const forbidden of ['s3:ListBucket', 's3:GetBucket*', 's3:List*', 's3:*', '*']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
