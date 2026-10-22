/// <reference types="jest" />

/**
 * Pins what TypeScriptLambda adds to a Lambda function: the code comes from the published artifact of the
 * named package, `SERVICE_NAME` is the name every log line is attributed to and cannot be overridden through
 * the environment, and the function logs to the shared log group of its pipeline. A wrong artifact key
 * deploys the wrong code; a wrong `SERVICE_NAME` misattributes the logs of every function sharing a bundle.
 */

import { ArtifactZone, PinnedArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { LogGroup }                              from 'aws-cdk-lib/aws-logs';
import { App, BootstraplessSynthesizer, Stack }  from 'aws-cdk-lib';

import { PipelineLogGroup }                      from '../pipeline-log-groups';
import { TypeScriptLambda }                      from '../ts-lambda';

interface LambdaFixture {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

function newFixture(): LambdaFixture {
  const stack            = new Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

describe('TypeScriptLambda', () => {
  it('fails at synth naming the package when the resolver holds no pin for it', () => {
    const { stack, artifactResolver } = newFixture();

    expect(
      () => new TypeScriptLambda(stack, 'unpinned-lambda', {
        lambdaId: 'artifact-updater',
        packageName: 'not-pinned',
        pipeline: 'infra',
        artifactResolver,
      }),
    ).toThrow("No resolved data for package 'not-pinned'");
  });

  describe('service name', () => {
    it('defaults SERVICE_NAME to the lambdaId, which also names the artifact key and tag', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', { lambdaId: 'stack-deployer', packageName: 'mailbox-cdk', pipeline: 'infra', artifactResolver });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer' } },
        Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-deployer\\.zip') },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' }]),
      });
    });

    it('uses serviceName for SERVICE_NAME when given, while the artifact key and tag stay on the lambdaId', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        serviceName: 'stack-deployer-data-starter',
        artifactResolver,
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer-data-starter' } },
        Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-deployer\\.zip') },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' }]),
      });
    });

    it('keeps the caller’s environment variables and overrides a caller-supplied SERVICE_NAME', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
        environment: { SERVICE_NAME: 'wrong-value', CUSTOM_VAR: 'custom-value' },
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer', CUSTOM_VAR: 'custom-value' } },
      });
    });
  });

  describe('description', () => {
    it('names the lambdaId and the stack by default', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', { lambdaId: 'stack-deployer', packageName: 'mailbox-cdk', pipeline: 'infra', artifactResolver });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: { 'Fn::Join': ['', ['Serverless Inbox Mailbox: stack-deployer (', { Ref: 'AWS::StackName' }, ')']] },
      });
    });

    it('is the caller’s description when given', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
        description: 'Starts the deployer workflow',
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: 'Starts the deployer workflow',
      });
    });
  });

  describe('logging', () => {
    it('logs to the shared log group of its pipeline', () => {
      const { stack, artifactResolver } = newFixture();

      new TypeScriptLambda(stack, 'lambda', { lambdaId: 'stack-deployer', packageName: 'mailbox-cdk', pipeline: 'infra', artifactResolver });

      const pipelineLogGroup: unknown = stack.resolve(PipelineLogGroup.getOrCreate(stack, 'infra').logGroupName);
      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        LoggingConfig: { LogGroup: pipelineLogGroup },
      });
    });

    it('logs to the caller’s log group instead of the pipeline’s when given', () => {
      const { stack, artifactResolver } = newFixture();
      const ownLogGroup                 = new LogGroup(stack, 'own-logs');

      new TypeScriptLambda(stack, 'lambda', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
        logGroup: ownLogGroup,
      });

      const ownLogGroupName: unknown = stack.resolve(ownLogGroup.logGroupName);
      const template                 = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', { LoggingConfig: { LogGroup: ownLogGroupName } });
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });
  });
});
