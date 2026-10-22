/// <reference types="jest" />

/**
 * DataBlobStore grant tests.
 *
 * Pin, for every purpose-named grant, the exact S3 object actions and key pattern it hands out, the
 * KMS actions it adds on a customer-managed key (none for a grant that only deletes), and the
 * prefix-conditioned ListBucket on the email-blob grant. A regression widens a role's bucket access
 * or leaves a caller without the key actions its object actions need.
 */

import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as kms                          from 'aws-cdk-lib/aws-kms';
import * as s3                           from 'aws-cdk-lib/aws-s3';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { BlobStore }                     from '../blob-store';
import { DataBlobStore }                 from '../data-blob-store';
import type { IDataBlobStore }           from '../data-blob-store';

type GrantMethod = Extract<keyof IDataBlobStore, `grant${string}`>;

interface GrantCase {
  readonly method:       GrantMethod;
  readonly s3Actions:    string[];
  readonly keyPattern:   string;
  readonly kmsActions:   string[];
  readonly listsPrefix?: boolean;
}

const EMAIL_PATTERN = 'tenants/*/accounts/*/emails/*';

const GRANT_CASES: GrantCase[] = [
  {
    method:     'grantEmailBlobWrite',
    s3Actions:  ['s3:PutObject'],
    keyPattern: EMAIL_PATTERN,
    kmsActions: ['kms:GenerateDataKey*', 'kms:DescribeKey'],
  },
  {
    method:     'grantEmailBlobRead',
    s3Actions:  ['s3:GetObject'],
    keyPattern: EMAIL_PATTERN,
    kmsActions: ['kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:      'grantEmailBlobReadWriteDelete',
    s3Actions:   ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    keyPattern:  EMAIL_PATTERN,
    kmsActions:  ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
    listsPrefix: true,
  },
  {
    method:     'grantUploadBlobReadWriteDelete',
    s3Actions:  ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    keyPattern: 'uploads/*',
    kmsActions: ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:     'grantIncomingEmailConsume',
    s3Actions:  ['s3:GetObject', 's3:DeleteObject'],
    keyPattern: `${BlobStore.INCOMING_EMAIL_PREFIX}*`,
    kmsActions: ['kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:     'grantContactBlobReadWriteDelete',
    s3Actions:  ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    keyPattern: 'tenants/*/accounts/*/contacts/*',
    kmsActions: ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:     'grantPrincipalBlobReadWriteDelete',
    s3Actions:  ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    keyPattern: 'tenants/*/principals/*',
    kmsActions: ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:     'grantSearchIndexRead',
    s3Actions:  ['s3:GetObject'],
    keyPattern: 'tenants/*/accounts/*/search-indexes/*',
    kmsActions: ['kms:Decrypt', 'kms:DescribeKey'],
  },
  {
    method:     'grantSearchIndexReadWrite',
    s3Actions:  ['s3:GetObject', 's3:PutObject'],
    keyPattern: 'tenants/*/accounts/*/search-indexes/*',
    kmsActions: ['kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey'],
  },
];

/** What CloudFormation renders for an action list: a single action stays a bare string. */
function renderedActions(actions: string[]): string | string[] {
  return actions.length === 1 ? actions[0] : actions;
}

/** Asserts the role's policy after `grantCase` is granted on a bucket that has a customer-managed key when `withKey` is set. */
function expectGrantedPolicy(grantCase: GrantCase, withKey: boolean): void {
  const stack  = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const key    = new kms.Key(stack, 'TestKey');
  const bucket = withKey
    ? new s3.Bucket(stack, 'TestBucket', { encryption: s3.BucketEncryption.KMS, encryptionKey: key })
    : new s3.Bucket(stack, 'TestBucket');
  const role   = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  new DataBlobStore(bucket)[grantCase.method](role);

  const bucketArn = { 'Fn::GetAtt': [stack.getLogicalId(bucket.node.defaultChild as cdk.CfnResource), 'Arn'] };
  const keyArn    = { 'Fn::GetAtt': [stack.getLogicalId(key.node.defaultChild as cdk.CfnResource), 'Arn'] };

  const statements: unknown[] = [
    Match.objectEquals({
      Action:   renderedActions(grantCase.s3Actions),
      Effect:   'Allow',
      Resource: { 'Fn::Join': ['', [bucketArn, `/${grantCase.keyPattern}`]] },
    }),
  ];

  if (withKey) {
    statements.push(Match.objectEquals({ Action: grantCase.kmsActions, Effect: 'Allow', Resource: keyArn }));
  }

  if (grantCase.listsPrefix) {
    statements.push(Match.objectEquals({
      Action:    's3:ListBucket',
      Condition: { StringLike: { 's3:prefix': grantCase.keyPattern } },
      Effect:    'Allow',
      Resource:  bucketArn,
    }));
  }

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
    PolicyDocument: { Statement: Match.arrayEquals(statements) },
  });
}

describe('DataBlobStore grants', () => {
  it.each(GRANT_CASES)('$method grants exactly its object actions on its key pattern, with no KMS statement on a bucket without a key', (grantCase) => {
    expectGrantedPolicy(grantCase, false);
  });

  it.each(GRANT_CASES)('$method adds exactly the KMS actions its object actions need on a bucket with a customer-managed key', (grantCase) => {
    expectGrantedPolicy(grantCase, true);
  });
});
