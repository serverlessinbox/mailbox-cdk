/// <reference types="jest" />

/**
 * SERVICE_NAME Uniqueness Test
 *
 * Regression guard: several distinct physical Lambda functions in the Mailbox stack
 * historically shared one `lambdaId` (and therefore one artifact) — e.g. stack-deployer
 * (starter+worker x3 call sites), resource-sweeper (starter+worker), authorizer
 * (admin-api + jmap-api), idp-token-exchange (admin-ui + webmail-ui) — which meant they
 * all wrote the same `SERVICE_NAME`, defeating log attribution. This test synthesizes the
 * full Mailbox construct and asserts no two Lambda functions in the template share a
 * SERVICE_NAME value.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Mailbox }                                       from '../mailbox';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

describe('Mailbox stack SERVICE_NAME uniqueness', () => {
  it('no two Lambda functions share a SERVICE_NAME value', () => {
    const app   = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxServiceName', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    const template  = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { Type?: string; Properties?: Record<string, unknown> }> | undefined;
    if (!resources) {throw new Error('No resources in template');}

    const serviceNamesByLogicalId = new Map<string, string>();

    for (const [logicalId, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::Lambda::Function') {continue;}

      const env         = resource.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined;
      const serviceName = env?.Variables?.SERVICE_NAME;
      if (typeof serviceName !== 'string') {continue;}

      serviceNamesByLogicalId.set(logicalId, serviceName);
    }

    // Sanity: the stack should have produced a meaningful number of Lambda functions
    // with SERVICE_NAME set (regression guard would be vacuous otherwise).
    expect(serviceNamesByLogicalId.size).toBeGreaterThan(5);

    const seen                                                             = new Map<string, string>();
    const collisions: Array<{ serviceName: string; logicalIds: string[] }> = [];

    for (const [logicalId, serviceName] of serviceNamesByLogicalId) {
      const existing = seen.get(serviceName);
      if (existing) {
        collisions.push({ serviceName, logicalIds: [existing, logicalId] });
      } else {
        seen.set(serviceName, logicalId);
      }
    }

    expect(collisions).toEqual([]);
  });
});
