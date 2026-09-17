/// <reference types="jest" />

/**
 * SupportApiLambda tag-key env var tests.
 *
 * Verifies SUPPORT_DIAG_TAG_KEY and SUPPORT_CONFIG_READ_TAG_KEY are set from the support-tier
 * registry (support-roles-infra.ts) rather than a Go-side literal.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { SupportApiLambda } from '../support-api';
import { SUPPORT_DIAG_TAG_KEY, SUPPORT_CONFIG_READ_TAG_KEY, getSupportTierTagKeys } from '../../addons/support/support-roles-infra';
import { VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';

describe('SupportApiLambda tag-key env vars', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-go']);
    artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);

    const configTable = new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const auditEventsQueue = new Queue(stack, 'audit-events-queue');

    new SupportApiLambda(stack, 'support-api', {
      supportHopRoleArn: 'arn:aws:iam::123456789012:role/support-hop',
      tierRoleArns: {
        'support-diag': 'arn:aws:iam::123456789012:role/support-diag',
        'support-config-read': 'arn:aws:iam::123456789012:role/support-config-read',
      },
      configTable,
      auditEventsQueue,
      artifactResolver,
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
      supportDiagTagKey: SUPPORT_DIAG_TAG_KEY,
      supportConfigReadTagKey: SUPPORT_CONFIG_READ_TAG_KEY,
      supportTierTagKeys: getSupportTierTagKeys(),
    });
  });

  it('sets SUPPORT_DIAG_TAG_KEY and SUPPORT_CONFIG_READ_TAG_KEY from the tier registry', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          SUPPORT_DIAG_TAG_KEY: SUPPORT_DIAG_TAG_KEY,
          SUPPORT_CONFIG_READ_TAG_KEY: SUPPORT_CONFIG_READ_TAG_KEY,
        }),
      },
    });
  });
});
