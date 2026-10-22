/// <reference types="jest" />

/**
 * DataTable grant tests.
 *
 * Pin the exact DynamoDB actions each grant hands out and that both cover the table and its indexes
 * but never `Scan` or PartiQL; a regression widens the access of every Lambda that reads or writes
 * a data table.
 */

import { Match, Template }               from 'aws-cdk-lib/assertions';
import { AttributeType, Table }          from 'aws-cdk-lib/aws-dynamodb';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { DataTable }                     from '../data-tables';

type GrantMethod = 'grantRead' | 'grantReadWrite';

/** Asserts the single statement a role holds after `method` is granted on a data table. */
function expectGrantedStatement(method: GrantMethod, actions: string[]): void {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const table = new Table(stack, 'Table', { partitionKey: { name: 'pk', type: AttributeType.STRING } });
  const role  = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  new DataTable(table)[method](role);

  const tableArn = { 'Fn::GetAtt': [stack.getLogicalId(table.node.defaultChild as cdk.CfnResource), 'Arn'] };

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    Roles:          Match.arrayWith([{ Ref: stack.getLogicalId(role.node.defaultChild as cdk.CfnResource) }]),
    PolicyDocument: {
      Statement: Match.arrayEquals([
        Match.objectEquals({
          Action:   actions,
          Effect:   'Allow',
          Resource: [tableArn, { 'Fn::Join': ['', [tableArn, '/index/*']] }],
        }),
      ]),
    },
  });
}

describe('DataTable', () => {
  it('grantRead grants exactly the read actions on the table and its indexes', () => {
    expectGrantedStatement('grantRead', ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query']);
  });

  it('grantReadWrite grants exactly the read and write actions on the table and its indexes', () => {
    expectGrantedStatement('grantReadWrite', [
      'dynamodb:GetItem',
      'dynamodb:BatchGetItem',
      'dynamodb:Query',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    ]);
  });
});
