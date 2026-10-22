import { Match, Template }                    from 'aws-cdk-lib/assertions';
import * as dynamodb                          from 'aws-cdk-lib/aws-dynamodb';
import * as iam                               from 'aws-cdk-lib/aws-iam';
import * as cdk                               from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }      from 'aws-cdk-lib';

import { DynamoDbActions, grantTableActions } from '../dynamodb-grants';

describe('grantTableActions', () => {
  it('grants exactly one Allow statement scoped to the table and its indexes', () => {
    const app   = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const table = new dynamodb.Table(stack, 'TestTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });
    const role  = new iam.Role(stack, 'TestRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    grantTableActions(role, table, DynamoDbActions.read);

    const template = Template.fromStack(stack);
    const tableId  = stack.getLogicalId(table.node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:   [...DynamoDbActions.read],
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

describe('DynamoDbActions', () => {
  it('readWrite is read followed by write, with no enumeration/introspection actions', () => {
    expect(DynamoDbActions.readWrite).toEqual([...DynamoDbActions.read, ...DynamoDbActions.write]);

    const all = [...DynamoDbActions.read, ...DynamoDbActions.write, ...DynamoDbActions.readWrite];
    for (const forbidden of [
      'dynamodb:Scan',
      'dynamodb:PartiQLSelect',
      'dynamodb:PartiQLInsert',
      'dynamodb:PartiQLUpdate',
      'dynamodb:PartiQLDelete',
      'dynamodb:DescribeTable',
      'dynamodb:ConditionCheckItem',
      'dynamodb:BatchWriteItem',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});
