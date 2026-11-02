/// <reference types="jest" />

/**
 * Pins what the Lambda@Edge role behind the public blob endpoint adds itself: the log statements, asserted
 * whole, since widening them beyond the function's own replica log groups gives that endpoint more reach
 * than its code uses. The table statements belong to `AuthKeyStoreTable.grantReadJwks` and
 * `AuthKeyStoreTable.grantReadHmac`; here only the hand-off of the role to those grants is asserted.
 */

import { statementsForAction }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }         from 'aws-cdk-lib/assertions';
import { Table }                   from 'aws-cdk-lib/aws-dynamodb';
import { Stack }                   from 'aws-cdk-lib';

import { fakePatTable }            from '../../lambdas/__tests__/lambda-wrapper-fakes';
import type { IAuthKeyStoreTable } from '../../tables/auth-key-store-table';
import type { IPatTable }          from '../../tables/data-pat-table';
import { DataPatTable }            from '../../tables/data-pat-table';
import { EdgeFunctionRole }        from '../edge-function-role';

const EDGE_STACK_NAME_PATTERN = 'my-stack-edge-*';
const PAT_TABLE_ARN           = 'arn:aws:dynamodb:us-east-1:123456789012:table/pat';
const REPLICA_LOG_GROUP_ARN   = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}`]],
};
const REPLICA_LOG_STREAM_ARN  = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':logs:*:', { Ref: 'AWS::AccountId' }, `:log-group:/aws/lambda/us-east-1.${EDGE_STACK_NAME_PATTERN}:*`]],
};

function fakeAuthKeyStoreTable(): jest.Mocked<IAuthKeyStoreTable> {
  return {
    tableName:                     'auth-key-store',
    tableArn:                      'arn:aws:dynamodb:us-east-1:123456789012:table/auth-key-store',
    grantReadJwks:                 jest.fn(),
    grantReadHmac:                 jest.fn(),
    grantManageHmac:               jest.fn(),
    grantManageJwks:               jest.fn(),
    grantManageConnectionKeys:     jest.fn(),
    grantReadConnectionPublicKey:  jest.fn(),
    grantReadConnectionPrivateKey: jest.fn(),
  };
}

function createRole(
  table: IAuthKeyStoreTable = fakeAuthKeyStoreTable(),
  patTable: IPatTable = fakePatTable('pat-table'),
): { readonly role: EdgeFunctionRole; readonly stack: Stack } {
  const stack = new Stack();
  const role  = new EdgeFunctionRole(stack, 'role', { authKeyStoreTable: table, patTable, edgeStackNamePattern: EDGE_STACK_NAME_PATTERN });
  return { role, stack };
}

/** The role with the real token-table grant, so the statements it renders are in the template. */
function synthRoleWithPatTable(): Template {
  const stack    = new Stack();
  const patTable = new DataPatTable(Table.fromTableArn(stack, 'pat-table', PAT_TABLE_ARN));
  new EdgeFunctionRole(stack, 'role', { authKeyStoreTable: fakeAuthKeyStoreTable(), patTable, edgeStackNamePattern: EDGE_STACK_NAME_PATTERN });
  return Template.fromStack(stack);
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

  it('asks the auth key store table for the JWKS and HMAC read grants to itself', () => {
    const table    = fakeAuthKeyStoreTable();
    const { role } = createRole(table);

    expect(table.grantReadJwks).toHaveBeenCalledTimes(1);
    expect(table.grantReadJwks).toHaveBeenCalledWith(role);
    expect(table.grantReadHmac).toHaveBeenCalledTimes(1);
    expect(table.grantReadHmac).toHaveBeenCalledWith(role);
  });

  it('asks the token table for the edge lookup grant to itself', () => {
    const patTable = fakePatTable('pat-table');
    const { role } = createRole(undefined, patTable);

    expect(patTable.grantPatEdgeLookup).toHaveBeenCalledTimes(1);
    expect(patTable.grantPatEdgeLookup).toHaveBeenCalledWith(role);
  });

  it('reads token rows by PAT key with GetItem and cannot update them', () => {
    const template = synthRoleWithPatTable();

    expect(statementsForAction(template, 'dynamodb:GetItem')).toEqual([
      {
        Action:    'dynamodb:GetItem',
        Effect:    'Allow',
        Resource:  PAT_TABLE_ARN,
        Condition: {
          'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['PAT#*'] },
          'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'tenantId', 'tokenId', 'expiresAt', 'revokedAt'] },
        },
      },
    ]);
    expect(statementsForAction(template, 'dynamodb:UpdateItem')).toEqual([]);
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
