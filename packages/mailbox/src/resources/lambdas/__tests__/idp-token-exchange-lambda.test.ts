/// <reference types="jest" />

/**
 * IdpTokenExchangeLambda wrapper tests.
 *
 * The function is created or updated only after the resources it is told to wait for: the Webmail
 * UI's token exchange reads OAuth client rows that the bootstrap writes, so a function that loses
 * this ordering can run before those rows exist. The environment names and the grants pin what the
 * exchange reads: the config table read-only and the audit queue send.
 */

import type { IArtifactResolver }                            from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf }                                         from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                                   from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                              from 'aws-cdk-lib/aws-dynamodb';
import { CfnResource }                                       from 'aws-cdk-lib';
import type { Stack }                                        from 'aws-cdk-lib';

import { AuthPolicyName, OAuthClientName }                   from '../../../contracts/auth-names';
import { AuditEventsQueue }                                  from '../../queues/audit-events-queue';
import { DataTable }                                         from '../../tables/data-tables';
import { IdpTokenExchangeLambda }                            from '../idp-token-exchange-lambda';

import { arrangeWrapperStack, onlyLambdaOf }                 from './lambda-wrapper-helpers';

describe('IdpTokenExchangeLambda', () => {
  let stack: Stack;
  let artifactResolver: IArtifactResolver;

  function newLambda(dependsOn?: CfnResource[]): IdpTokenExchangeLambda {
    return new IdpTokenExchangeLambda(stack, 'idp-token-exchange', {
      configTable:      new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authPolicyName:   AuthPolicyName.JMAP_API,
      oauthClientName:  OAuthClientName.WEBMAIL_UI,
      artifactResolver,
      serviceName: 'idp-token-exchange-webmail-ui',
      pipeline:    'jmap',
      dependsOn,
    });
  }

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;
    artifactResolver  = arrangement.artifactResolver;
  });

  it('depends on the resources it is told to wait for', () => {
    const prerequisite = new CfnResource(stack, 'prerequisite', { type: 'AWS::SNS::Topic' });

    newLambda([prerequisite]);

    Template.fromStack(stack).hasResource('AWS::Lambda::Function', {
      DependsOn: Match.arrayWith([stack.getLogicalId(prerequisite)]),
    });
  });

  it('sets the auth policy, OAuth client, config table and audit queue names it reads', () => {
    newLambda();

    const { environment } = onlyLambdaOf(Template.fromStack(stack));
    expect(environment).toMatchObject({
      AUTH_POLICY_NAME:  AuthPolicyName.JMAP_API,
      OAUTH_CLIENT_NAME: OAuthClientName.WEBMAIL_UI,
    });
    expect(Object.keys(environment)).toEqual(expect.arrayContaining(['CONFIG_TABLE_NAME', 'AUDIT_EVENTS_QUEUE_URL']));
  });

  it('reads the config table and sends audit events, and never writes the config table', () => {
    newLambda();

    const actions = onlyLambdaOf(Template.fromStack(stack)).statements.flatMap(actionsOf);
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'sqs:SendMessage']));
    expect(actions).not.toContain('dynamodb:PutItem');
  });
});
