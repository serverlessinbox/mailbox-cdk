/// <reference types="jest" />

/**
 * SupportRoleAssumptionCollectorLambda tag-key env var tests.
 *
 * The Go handler resolves both tier tag keys (diag and config-read) to build the recomputed
 * tag set for the hop role, so both must be present — even though the ses-identity-ownership
 * plan's table only lists SUPPORT_CONFIG_READ_TAG_KEY for this construct; verified against
 * modules/lambdas/support-role-assumption-collector/main.go, which reads both.
 */

import { ArtifactZone, PinnedArtifactResolver }                                     from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }                                      from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                                          from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                                     from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                                                     from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                                            from 'aws-cdk-lib';

import { SUPPORT_DIAG_TAG_KEY, SUPPORT_CONFIG_READ_TAG_KEY, getSupportTierTagKeys } from '../../../platform/support/support-roles-infra';
import { DataTable }                                                                from '../../tables/data-tables';
import { SupportRoleAssumptionCollectorLambda }                                     from '../support-role-assumption-collector-lambda';

describe('SupportRoleAssumptionCollectorLambda tag-key env vars', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;

  beforeEach(() => {
    app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver                            = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const configTable = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));

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
