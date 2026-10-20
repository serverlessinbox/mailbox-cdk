/// <reference types="jest" />

/**
 * StackFailureDetectorLambda tests.
 *
 * Pin what the wrapper adds to the Go function: the pinned name, the supplied role, the log group
 * environment variable, timeout and memory; a regression runs the detector under a different role,
 * hands it the wrong log group, or lets CDK attach a policy to its role.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { StackFailureDetectorLambda } from '../stack-failure-detector';

function createDetector(): { stack: cdk.Stack; role: iam.Role } {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  const role = new iam.Role(stack, 'DetectorRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });

  new StackFailureDetectorLambda(stack, 'detector', {
    artifactResolver,
    role,
    functionName: 'pinned-detector-name',
    infraLogGroupName: '/test/infra-log-group',
  });

  return { stack, role };
}

describe('StackFailureDetectorLambda', () => {
  it('runs under the given role with the given name, 2 minute timeout and 256 MB', () => {
    const { stack, role } = createDetector();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pinned-detector-name',
      Role: stack.resolve(role.roleArn),
      Timeout: 120,
      MemorySize: 256,
    });
  });

  it('passes the infra log group name in INFRA_LOG_GROUP_NAME', () => {
    const { stack } = createDetector();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { INFRA_LOG_GROUP_NAME: '/test/infra-log-group' } },
    });
  });

  it('leaves the given role without any CDK-attached policy', () => {
    const { stack } = createDetector();

    Template.fromStack(stack).resourceCountIs('AWS::IAM::Policy', 0);
  });
});
