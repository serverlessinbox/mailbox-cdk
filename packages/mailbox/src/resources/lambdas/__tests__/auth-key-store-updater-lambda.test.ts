/// <reference types="jest" />

/**
 * AuthKeyStoreUpdaterLambda: the read-write grant on the auth-key-store table, its invocation by the refresh schedule
 * and the stack-deployed event, and the table-name environment variable.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import type * as cdk                            from 'aws-cdk-lib';

import { AuthKeyStoreTable }                    from '../../tables/auth-key-store-table';
import { AuthKeyStoreUpdaterLambda }            from '../auth-key-store-updater-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('AuthKeyStoreUpdaterLambda auth-key-store grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let authKeyStoreTable: AuthKeyStoreTable;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');

    new AuthKeyStoreUpdaterLambda(stack, 'auth-key-store-updater', {
      issuers: ['https://issuer.example.com'],
      authKeyStoreTable,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('grants exactly the read-write actions, Allow, on the table + index resources', () => {
    const expectedResource: unknown = stack.resolve([
      authKeyStoreTable.tableArn,
      `${authKeyStoreTable.tableArn}/index/*`,
    ]);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:   Match.arrayEquals(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem']),
            Effect:   'Allow',
            Resource: expectedResource,
          }),
        ]),
      },
    });
  });

  it('is invoked by the 6-hourly refresh and by the stack-deployed event', () => {
    const targets = [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^authkeystoreupdater'), 'Arn'] }, Id: 'Target0' }];

    template.resourceCountIs('AWS::Events::Rule', 2);
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(6 hours)', Targets: targets });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.cloudformation'] }),
      Targets:      targets,
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
