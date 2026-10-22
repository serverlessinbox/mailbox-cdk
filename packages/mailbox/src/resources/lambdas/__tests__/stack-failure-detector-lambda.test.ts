/// <reference types="jest" />

/**
 * StackFailureDetectorLambda tests.
 *
 * Pin what the wrapper adds to the Go function: the pinned name, the supplied role, the log group
 * environment variable, timeout and memory; a regression runs the detector under a different role,
 * hands it the wrong log group, or lets CDK attach a policy to its role.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as iam                                 from 'aws-cdk-lib/aws-iam';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { StackFailureDetectorLambda }           from '../stack-failure-detector-lambda';

function createDetector(): { stack: cdk.Stack; role: iam.Role; detector: StackFailureDetectorLambda } {
  const stack            = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  const role             = new iam.Role(stack, 'DetectorRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });

  const detector = new StackFailureDetectorLambda(stack, 'detector', {
    artifactResolver,
    role,
    functionName:      'pinned-detector-name',
    infraLogGroupName: '/test/infra-log-group',
  });

  return { stack, role, detector };
}

describe('StackFailureDetectorLambda', () => {
  it('runs under the given role with the given name, 2 minute timeout and 256 MB', () => {
    const { stack, role } = createDetector();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'pinned-detector-name',
      Role:         stack.resolve(role.roleArn),
      Timeout:      120,
      MemorySize:   256,
    });
  });

  it('passes the infra log group name in INFRA_LOG_GROUP_NAME', () => {
    const { stack } = createDetector();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { INFRA_LOG_GROUP_NAME: '/test/infra-log-group' } },
    });
  });

  it('creates the stack-failed rule under itself, targeting itself, and exposes it', () => {
    const { stack, detector } = createDetector();
    const template            = Template.fromStack(stack);
    const [ruleId]            = Object.keys(template.findResources('AWS::Events::Rule'));

    expect(ruleId).toMatch(/^detectorstackfailed/);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Id: detector.stackFailedEvent.ruleTargetId, Arn: stack.resolve(detector.functionArn) }],
    });
    expect(stack.resolve(detector.stackFailedEvent.ruleArn)).toEqual({ 'Fn::GetAtt': [ruleId, 'Arn'] });
  });

  it('leaves the given role without any CDK-attached policy', () => {
    const { stack } = createDetector();

    Template.fromStack(stack).resourceCountIs('AWS::IAM::Policy', 0);
  });
});
