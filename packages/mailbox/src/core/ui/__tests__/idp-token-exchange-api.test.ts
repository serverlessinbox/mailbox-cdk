/// <reference types="jest" />

/**
 * IdpTokenExchangeApi wiring tests.
 *
 * `dependsOn` is how a caller makes the token-exchange function wait for work that must exist
 * before the function runs (e.g. the config rows it reads). If the dependency is not placed on the
 * function itself, the function can be created or updated before that work has completed.
 */

import { ArtifactZone, PinnedArtifactResolver }          from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                      from 'aws-cdk-lib/assertions';
import * as dynamodb                                     from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { AUTH_POLICY_JMAP_API, OAUTH_CLIENT_WEBMAIL_UI } from '../../../contracts/auth-names';
import { AuditEventsQueue }                              from '../../../resources/queues/audit-events-queue';
import { DataTable }                                     from '../../../resources/tables/data-tables';
import { IdpTokenExchangeApi }                           from '../idp-token-exchange-api';

interface SynthesizedFunction {
  Properties?: { Environment?: { Variables?: Record<string, string> } };
  DependsOn?:  string[];
}

describe('IdpTokenExchangeApi', () => {
  let stack: cdk.Stack;

  function createApi(dependsOn?: cdk.CfnResource[]): IdpTokenExchangeApi {
    return new IdpTokenExchangeApi(stack, 'oauth-api', {
      artifactResolver: new PinnedArtifactResolver({
        packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      configTable:      new DataTable(new dynamodb.Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authPolicyName:   AUTH_POLICY_JMAP_API,
      oauthClientName:  OAUTH_CLIENT_WEBMAIL_UI,
      dependsOn,
      serviceName: 'idp-token-exchange-test',
      pipeline:    'jmap',
    });
  }

  function tokenExchangeFunctionDependsOn(template: Template): string[] {
    const matching = Object.values<SynthesizedFunction>(template.findResources('AWS::Lambda::Function')).filter(
      (functionResource) => functionResource.Properties?.Environment?.Variables?.SERVICE_NAME === 'idp-token-exchange-test',
    );
    expect(matching).toHaveLength(1);
    return matching[0].DependsOn ?? [];
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('makes the token-exchange function depend on the given resources', () => {
    const prerequisite = new cdk.CfnResource(stack, 'prerequisite', { type: 'Custom::Prerequisite' });
    createApi([prerequisite]);

    const dependsOn = tokenExchangeFunctionDependsOn(Template.fromStack(stack));

    expect(dependsOn).toContain(stack.getLogicalId(prerequisite));
  });

  it('routes every method under /auth/{proxy+} to the token-exchange function', () => {
    createApi();

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /auth/{proxy+}',
    });
  });

  it('backs the route with a proxy integration', () => {
    createApi();

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
    });
  });
});
