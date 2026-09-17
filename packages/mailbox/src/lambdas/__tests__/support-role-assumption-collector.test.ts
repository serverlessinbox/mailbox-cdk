/// <reference types="jest" />

/**
 * SupportRoleAssumptionCollectorLambda tag-key env var tests.
 *
 * The Go handler resolves both tier tag keys (diag and config-read) to build the recomputed
 * tag set for the hop role, so both must be present — even though the ses-identity-ownership
 * plan's table only lists SUPPORT_CONFIG_READ_TAG_KEY for this construct; verified against
 * modules/lambdas/support-role-assumption-collector/main.go, which reads both.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { SupportRoleAssumptionCollectorLambda } from '../support-role-assumption-collector';
import { SUPPORT_DIAG_TAG_KEY, SUPPORT_CONFIG_READ_TAG_KEY, getSupportTierTagKeys } from '../../addons/support/support-roles-infra';

describe('SupportRoleAssumptionCollectorLambda tag-key env vars', () => {
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

    new SupportRoleAssumptionCollectorLambda(stack, 'support-role-assumption-collector', {
      supportHopRoleArn: 'arn:aws:iam::123456789012:role/support-hop',
      tierRoleArns: {
        'support-diag': 'arn:aws:iam::123456789012:role/support-diag',
        'support-config-read': 'arn:aws:iam::123456789012:role/support-config-read',
      },
      configTable,
      artifactResolver,
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
