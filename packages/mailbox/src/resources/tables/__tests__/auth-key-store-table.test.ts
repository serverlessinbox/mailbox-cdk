import { PositionHash, StackIdentity }   from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { defaultCfnResource }            from '../../../utils/cfn-resource';
import { AuthKeyStoreTable }             from '../auth-key-store-table';

/**
 * AuthKeyStoreTable tests.
 *
 * Pin the table definition the signing-key readers and the updater depend on (pk/sk keys, on-demand
 * billing) and that each grant method hands out the action set meant for its kind of caller; a
 * regression breaks key lookup or widens a Lambda's DynamoDB access.
 */

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('AuthKeyStoreTable', () => {
  it('takes its physical name from the stack name, the position hash and the install id', () => {
    // StackNamedTable falls back to Aws.STACK_NAME, so the table name must not reference the data-stack nameBase.
    const stack = createStack();
    const sut   = new AuthKeyStoreTable(stack, 'auth-key-store');

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: {
        'Fn::Join': ['', [
          { Ref: 'AWS::AccountId' },
          '-',
          { Ref: 'AWS::StackName' },
          `-auth-key-store-${PositionHash.of(sut)}-`,
          stack.resolve(StackIdentity.guidPrefix),
        ]],
      },
    });
  });

  it('defines a pk/sk on-demand table that is deleted together with the stack', () => {
    const stack = createStack();
    new AuthKeyStoreTable(stack, 'auth-key-store-table');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:   [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });

  it('grantGetItem grants exactly one Allow statement with GetItem on the table only', () => {
    const stack = createStack();
    const sut   = new AuthKeyStoreTable(stack, 'auth-key-store-table');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantGetItem(role);

    const tableId = stack.getLogicalId(defaultCfnResource(sut));

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(defaultCfnResource(role)) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   'dynamodb:GetItem',
            Effect:   'Allow',
            Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
          }),
        ]),
      },
    });
  });

  it('grantRead grants exactly one Allow statement with the read actions', () => {
    const stack = createStack();
    const sut   = new AuthKeyStoreTable(stack, 'auth-key-store-table');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantRead(role);

    const tableId  = stack.getLogicalId(defaultCfnResource(sut));
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(defaultCfnResource(role)) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'],
            Effect:   'Allow',
            Resource: [
              { 'Fn::GetAtt': [tableId, 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
            ],
          }),
        ]),
      },
    });
  });

  it('grantReadWrite grants exactly one Allow statement with the read+write actions', () => {
    const stack = createStack();
    const sut   = new AuthKeyStoreTable(stack, 'auth-key-store-table');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantReadWrite(role);

    const tableId  = stack.getLogicalId(defaultCfnResource(sut));
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(defaultCfnResource(role)) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   [
              'dynamodb:GetItem',
              'dynamodb:BatchGetItem',
              'dynamodb:Query',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
            ],
            Effect:   'Allow',
            Resource: [
              { 'Fn::GetAtt': [tableId, 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
            ],
          }),
        ]),
      },
    });
  });
});
