/// <reference types="jest" />

/**
 * IdpTokenExchangeLambda wrapper tests.
 *
 * The function is created or updated only after the resources it is told to wait for: the Webmail
 * UI's token exchange reads OAuth client rows that the bootstrap writes, so a function that loses
 * this ordering can run before those rows exist.
 */

import { ArtifactZone, PinnedArtifactResolver }              from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                   from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                              from 'aws-cdk-lib/aws-dynamodb';
import { App, BootstraplessSynthesizer, CfnResource, Stack } from 'aws-cdk-lib';

import { AUTH_POLICY_JMAP_API, OAUTH_CLIENT_WEBMAIL_UI }     from '../../../contracts/auth-names';
import { AuditEventsQueue }                                  from '../../queues/audit-events-queue';
import { DataTable }                                         from '../../tables/data-tables';
import { IdpTokenExchangeLambda }                            from '../idp-token-exchange-lambda';

describe('IdpTokenExchangeLambda', () => {
  let stack: Stack;

  function newLambda(dependsOn?: CfnResource[]): IdpTokenExchangeLambda {
    return new IdpTokenExchangeLambda(stack, 'idp-token-exchange', {
      configTable:      new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authPolicyName:   AUTH_POLICY_JMAP_API,
      oauthClientName:  OAUTH_CLIENT_WEBMAIL_UI,
      artifactResolver: new PinnedArtifactResolver({
        packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      serviceName:      'idp-token-exchange-webmail-ui',
      pipeline:         'jmap',
      dependsOn,
    });
  }

  beforeEach(() => {
    stack = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('depends on the resources it is told to wait for', () => {
    const prerequisite = new CfnResource(stack, 'prerequisite', { type: 'AWS::SNS::Topic' });

    newLambda([prerequisite]);

    Template.fromStack(stack).hasResource('AWS::Lambda::Function', {
      DependsOn: Match.arrayWith([stack.getLogicalId(prerequisite)]),
    });
  });
});
