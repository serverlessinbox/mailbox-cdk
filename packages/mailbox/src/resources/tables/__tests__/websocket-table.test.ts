import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { WebSocketTable }                from '../websocket-table';

/**
 * WebSocketTable tests.
 *
 * Pin the table definition the WebSocket Lambdas depend on (single-table keys, the `gsi1` index,
 * TTL, on-demand billing) and that each grant method hands out the action set meant for its kind of
 * caller; a regression breaks connection storage or widens a Lambda's DynamoDB access.
 */

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('WebSocketTable', () => {
  it('defines the pk/sk table with TTL, on-demand billing, a gsi1 index and no point-in-time recovery', () => {
    const stack = createStack();
    new WebSocketTable(stack, 'websocket-table');

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:                        [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode:                      'PAY_PER_REQUEST',
      TimeToLiveSpecification:          { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      GlobalSecondaryIndexes:           [
        {
          IndexName:  'gsi1',
          KeySchema:  [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  it('is deleted together with the stack', () => {
    const stack = createStack();
    new WebSocketTable(stack, 'websocket-table');

    Template.fromStack(stack).hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });

  it('tableName resolves to the table resource', () => {
    const stack = createStack();
    const sut   = new WebSocketTable(stack, 'websocket-table');

    expect(stack.resolve(sut.tableName)).toEqual({ Ref: 'websockettablewebsocketEF927F93' });
  });

  it('grantWrite grants exactly one Allow statement with the write actions', () => {
    const stack = createStack();
    const sut   = new WebSocketTable(stack, 'websocket-table');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantWrite(role);

    const tableId  = 'websockettablewebsocketEF927F93';
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
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
    const sut   = new WebSocketTable(stack, 'websocket-table');
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    sut.grantReadWrite(role);

    const tableId  = 'websockettablewebsocketEF927F93';
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
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
