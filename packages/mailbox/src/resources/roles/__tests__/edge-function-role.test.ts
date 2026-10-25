/// <reference types="jest" />

/**
 * Pins the exact statements of the Lambda@Edge role behind the public blob endpoint. Widening the table
 * grant beyond `GetItem`, or the log grant beyond the function's own replica log groups, gives that
 * endpoint more reach than its code uses, so every statement is asserted whole.
 */

import { statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }     from 'aws-cdk-lib/assertions';
import { Stack }               from 'aws-cdk-lib';

import { AuthKeyStoreTable }   from '../../tables/auth-key-store-table';
import { EdgeFunctionRole }    from '../edge-function-role';

const EDGE_STACK_NAME_PATTERN = 'my-stack-edge-*';
const REPLICA_LOG_GROUP_ARN   = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}`]],
};
const REPLICA_LOG_STREAM_ARN  = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}:*`]],
};

function synthRole(): Template {
  const stack = new Stack();
  new EdgeFunctionRole(stack, 'role', {
    authKeyStoreTable:    new AuthKeyStoreTable(stack, 'auth-key-store-table'),
    edgeStackNamePattern: EDGE_STACK_NAME_PATTERN,
  });
  return Template.fromStack(stack);
}

describe('EdgeFunctionRole', () => {
  it('is assumed by Lambda and Lambda@Edge, with no managed policy', () => {
    synthRole().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } },
          { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'edgelambda.amazonaws.com' } },
        ],
      },
      ManagedPolicyArns:        Match.absent(),
    });
  });

  it('gets items from the auth key store table only, with no query or batch read', () => {
    const template = synthRole();
    const tableId  = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];

    expect(statementsForAction(template, 'dynamodb:GetItem')).toEqual([
      { Action: 'dynamodb:GetItem', Effect: 'Allow', Resource: { 'Fn::GetAtt': [tableId, 'Arn'] } },
    ]);
    expect(statementsForAction(template, 'dynamodb:BatchGetItem')).toHaveLength(0);
    expect(statementsForAction(template, 'dynamodb:Query')).toHaveLength(0);
  });

  it('creates log groups only for the replica log groups of its edge stack, in every region of the account', () => {
    expect(statementsForAction(synthRole(), 'logs:CreateLogGroup')).toEqual([
      { Action: 'logs:CreateLogGroup', Effect: 'Allow', Resource: REPLICA_LOG_GROUP_ARN },
    ]);
  });

  it('writes log streams and events only inside the replica log groups of its edge stack', () => {
    expect(statementsForAction(synthRole(), 'logs:PutLogEvents')).toEqual([
      { Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Effect: 'Allow', Resource: REPLICA_LOG_STREAM_ARN },
    ]);
  });
});
