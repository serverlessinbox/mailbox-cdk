/// <reference types="jest" />

/**
 * IdpTokenExchangeLambda wrapper tests.
 *
 * The function is created or updated only after the resources it is told to wait for: the Webmail
 * UI's token exchange reads OAuth client rows that the bootstrap writes, so a function that loses
 * this ordering can run before those rows exist.
 */

import type { IArtifactResolver }                            from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                   from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                              from 'aws-cdk-lib/aws-dynamodb';
import { CfnResource }                                       from 'aws-cdk-lib';
import type { Stack }                                        from 'aws-cdk-lib';

import { AUTH_POLICY_JMAP_API, OAUTH_CLIENT_WEBMAIL_UI }     from '../../../contracts/auth-names';
import { AuditEventsQueue }                                  from '../../queues/audit-events-queue';
import { DataTable }                                         from '../../tables/data-tables';
import { IdpTokenExchangeLambda }                            from '../idp-token-exchange-lambda';

import { arrangeWrapperStack }                               from './lambda-wrapper-helpers';

describe('IdpTokenExchangeLambda', () => {
  let stack: Stack;
  let artifactResolver: IArtifactResolver;

  function newLambda(dependsOn?: CfnResource[]): IdpTokenExchangeLambda {
    return new IdpTokenExchangeLambda(stack, 'idp-token-exchange', {
      configTable:      new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authPolicyName:   AUTH_POLICY_JMAP_API,
      oauthClientName:  OAUTH_CLIENT_WEBMAIL_UI,
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
});
