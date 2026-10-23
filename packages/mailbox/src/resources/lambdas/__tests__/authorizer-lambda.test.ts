/// <reference types="jest" />

/**
 * AuthorizerLambda: the read-only grant on the auth-key-store table, the auth policy and anonymous routes it is
 * configured with, and the table-name environment variable.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import type * as cdk                            from 'aws-cdk-lib';

import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { DataTable }                            from '../../tables/data-tables';
import { AuthorizerLambda }                     from '../authorizer-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('AuthorizerLambda auth-key-store grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable = new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');

    new AuthorizerLambda(stack, 'authorizer', {
      authKeyStoreTable,
      configTable:      new DataTable(configTable),
      artifactResolver: arrangement.artifactResolver,
      authPolicyName:   'ADMIN_API',
      anonymousRoutes:  ['GET /first', 'GET /second'],
      serviceName:      'jmap',
      pipeline:         'jmap',
    });

    template = Template.fromStack(stack);
  });

  function authKeyStoreResources(): unknown {
    return stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);
  }

  it('grants exactly the read actions, Allow, on the table + index resources', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:   Match.arrayEquals(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query']),
            Effect:   'Allow',
            Resource: Match.exact(authKeyStoreResources()),
          }),
        ]),
      },
    });
  });

  it('passes the auth policy name and the anonymous routes on as given', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AUTH_POLICY_NAME:       'ADMIN_API',
          ALLOW_ANONYMOUS_ROUTES: 'GET /first,GET /second',
        }),
      },
    });
  });

  it('sets AUTH_KEY_STORE_TABLE_NAME on the function environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          AUTH_KEY_STORE_TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });
});
