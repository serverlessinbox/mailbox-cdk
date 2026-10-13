/// <reference types="jest" />

/**
 * ResourceSweeperStarterLambda IAM tests.
 *
 * The starter decides whether a Delete may sweep by reading its parent stack's status. These tests
 * pin that this read is granted on the stack's own id and nothing wider: a broader resource lets the
 * starter read any stack in the account, and a missing grant makes every lookup fail, which the
 * starter treats as "stack not being deleted" and silently skips the sweep on a real stack delete.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin } from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, allPolicyStatements } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ResourceSweeperStarterLambda } from '../resource-sweeper-starter';

describe('ResourceSweeperStarterLambda IAM', () => {
  let template: Template;

  beforeEach(() => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    new ResourceSweeperStarterLambda(stack, 'starter', {
      artifactResolver: new PinnedArtifactResolver({
        packages,
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      stateMachineArn: 'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper',
    });
    template = Template.fromStack(stack);
  });

  it('grants cloudformation:DescribeStacks on the stack id and no other CloudFormation action', () => {
    const cloudFormationStatements = allPolicyStatements(template).filter((statement) =>
      actionsOf(statement).some((action) => action.startsWith('cloudformation:')),
    );

    expect(cloudFormationStatements).toEqual([
      { Action: 'cloudformation:DescribeStacks', Effect: 'Allow', Resource: { Ref: 'AWS::StackId' } },
    ]);
  });
});
