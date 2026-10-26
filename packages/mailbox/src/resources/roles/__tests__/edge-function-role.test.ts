/// <reference types="jest" />

/**
 * Pins what the Lambda@Edge role behind the public blob endpoint adds itself: the log statements, asserted
 * whole, since widening them beyond the function's own replica log groups gives that endpoint more reach
 * than its code uses. The table statement belongs to `AuthKeyStoreTable.grantGetItem`; here only the
 * hand-off of the role to that grant is asserted.
 */

import { statementsForAction }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }         from 'aws-cdk-lib/assertions';
import { Stack }                   from 'aws-cdk-lib';

import type { IAuthKeyStoreTable } from '../../tables/auth-key-store-table';
import { EdgeFunctionRole }        from '../edge-function-role';

const EDGE_STACK_NAME_PATTERN = 'my-stack-edge-*';
const REPLICA_LOG_GROUP_ARN   = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}`]],
};
const REPLICA_LOG_STREAM_ARN  = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}:*`]],
};

function fakeAuthKeyStoreTable(): jest.Mocked<IAuthKeyStoreTable> {
  return {
    tableName:      'auth-key-store',
    tableArn:       'arn:aws:dynamodb:us-east-1:123456789012:table/auth-key-store',
    grantGetItem:   jest.fn(),
    grantRead:      jest.fn(),
    grantReadWrite: jest.fn(),
  };
}

function createRole(table: IAuthKeyStoreTable = fakeAuthKeyStoreTable()): { readonly role: EdgeFunctionRole; readonly stack: Stack } {
  const stack = new Stack();
  const role  = new EdgeFunctionRole(stack, 'role', { authKeyStoreTable: table, edgeStackNamePattern: EDGE_STACK_NAME_PATTERN });
  return { role, stack };
}

function synthRole(): Template {
  return Template.fromStack(createRole().stack);
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

  it('asks the auth key store table for a GetItem grant to itself', () => {
    const table    = fakeAuthKeyStoreTable();
    const { role } = createRole(table);

    expect(table.grantGetItem).toHaveBeenCalledTimes(1);
    expect(table.grantGetItem).toHaveBeenCalledWith(role);
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
