/**
 * MailLogTable: the key schema, indexes, TTL and retention the mail log is written and read by, and the
 * two grants the writer and the reader are given. The grant assertions pin the exact action lists, since
 * the list is the least-privilege boundary.
 */
import { Match, Template } from 'aws-cdk-lib/assertions';
import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import * as iam            from 'aws-cdk-lib/aws-iam';
import * as kms            from 'aws-cdk-lib/aws-kms';
import * as cdk            from 'aws-cdk-lib';

import { MailLogTable }    from '../mail-log-table';

function createStack(): cdk.Stack {
  return new cdk.Stack(new cdk.App(), 'TestStack');
}

function newRole(stack: cdk.Stack): iam.Role {
  return new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
}

describe('MailLogTable', () => {
  it('is keyed by string pk and sk, with gsi1 and gsi2 projecting every attribute', () => {
    const stack = createStack();
    new MailLogTable(stack, 'mail-log-table', { encryption: TableEncryption.AWS_MANAGED });

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:              [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: [
        {
          IndexName:  'gsi1',
          KeySchema:  [{ AttributeName: 'gsi1pk', KeyType: 'HASH' }, { AttributeName: 'gsi1sk', KeyType: 'RANGE' }],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName:  'gsi2',
          KeySchema:  [{ AttributeName: 'gsi2pk', KeyType: 'HASH' }, { AttributeName: 'gsi2sk', KeyType: 'RANGE' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  it('expires rows on the ttl attribute, bills per request, and has no point-in-time recovery', () => {
    const stack = createStack();
    new MailLogTable(stack, 'mail-log-table', { encryption: TableEncryption.AWS_MANAGED });

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode:                      'PAY_PER_REQUEST',
      TimeToLiveSpecification:          { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: Match.absent(),
    });
  });

  it('is deleted together with its stack', () => {
    const stack = createStack();
    new MailLogTable(stack, 'mail-log-table', { encryption: TableEncryption.AWS_MANAGED });

    Template.fromStack(stack).hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy:      'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  it('grantRead grants exactly GetItem and Query on the table and its indexes', () => {
    const stack             = createStack();
    const table             = new MailLogTable(stack, 'mail-log-table', { encryption: TableEncryption.AWS_MANAGED });
    const role              = newRole(stack);
    const tableArn: unknown = stack.resolve(table.tableArn);

    table.grantRead(role);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['dynamodb:GetItem', 'dynamodb:Query'],
            Effect:   'Allow',
            Resource: [tableArn, { 'Fn::Join': ['', [tableArn, '/index/*']] }],
          }),
        ]),
      },
    });
  });

  it('grantWrite grants exactly PutItem on the table', () => {
    const stack             = createStack();
    const table             = new MailLogTable(stack, 'mail-log-table', { encryption: TableEncryption.AWS_MANAGED });
    const role              = newRole(stack);
    const tableArn: unknown = stack.resolve(table.tableArn);

    table.grantWrite(role);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'dynamodb:PutItem',
            Effect:   'Allow',
            Resource: tableArn,
          }),
        ]),
      },
    });
  });

  it('adds the KMS write actions on its customer-managed key to grantWrite', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'key');
    const table = new MailLogTable(stack, 'mail-log-table', {
      encryption:    TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
    });
    const role              = newRole(stack);
    const tableArn: unknown = stack.resolve(table.tableArn);
    const keyArn: unknown   = stack.resolve(key.keyArn);

    table.grantWrite(role);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'dynamodb:PutItem',
            Effect:   'Allow',
            Resource: tableArn,
          }),
          Match.objectEquals({
            Action:   ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
            Effect:   'Allow',
            Resource: keyArn,
          }),
        ]),
      },
    });
  });
});
