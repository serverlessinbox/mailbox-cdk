/// <reference types="jest" />

/**
 * Pins what GoLambda adds to a Lambda function: the code comes from the published artifact of the Go
 * package, `SERVICE_NAME` is the name every log line is attributed to and cannot be overridden through the
 * environment, and the function logs to the shared log group of its pipeline. A wrong artifact key deploys
 * the wrong code; a wrong `SERVICE_NAME` misattributes the logs of every function sharing a bundle.
 */

import { ArtifactZone, PinnedArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { LogGroup }                              from 'aws-cdk-lib/aws-logs';
import { App, BootstraplessSynthesizer, Stack }  from 'aws-cdk-lib';

import { GoLambda }                              from '../go-lambda';
import { PipelineLogGroup }                      from '../pipeline-log-groups';

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
    packages: { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

describe('GoLambda', () => {
  describe('service name', () => {
    it('defaults SERVICE_NAME to the lambdaId, which also names the artifact key and tag', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'authorizer' } },
        Code: { S3Key: Match.stringLikeRegexp('lambdas/authorizer\\.zip') },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'authorizer' }]),
      });
    });

    it('uses serviceName for SERVICE_NAME when given, while the artifact key and tag stay on the lambdaId', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', {
        lambdaId: 'authorizer',
        pipeline: 'admin',
        serviceName: 'authorizer-admin-api',
        artifactResolver,
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'authorizer-admin-api' } },
        Code: { S3Key: Match.stringLikeRegexp('lambdas/authorizer\\.zip') },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'authorizer' }]),
      });
    });

    it('keeps the caller’s environment variables and overrides a caller-supplied SERVICE_NAME', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', {
        lambdaId: 'authorizer',
        pipeline: 'jmap',
        artifactResolver,
        environment: { SERVICE_NAME: 'wrong-value', CUSTOM_VAR: 'custom-value' },
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'authorizer', CUSTOM_VAR: 'custom-value' } },
      });
    });
  });

  describe('description', () => {
    it('names the lambdaId and the stack by default', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: { 'Fn::Join': ['', ['Serverless Inbox Mailbox: authorizer (', { Ref: 'AWS::StackName' }, ')']] },
      });
    });

    it('is the caller’s description when given', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver, description: 'Authorizes JMAP requests' });

      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: 'Authorizes JMAP requests',
      });
    });
  });

  describe('logging', () => {
    it('logs to the shared log group of its pipeline', () => {
      const { stack, artifactResolver } = newFixture();

      new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver });

      const pipelineLogGroup: unknown = stack.resolve(PipelineLogGroup.getOrCreate(stack, 'jmap').logGroupName);
      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        LoggingConfig: { LogGroup: pipelineLogGroup },
      });
    });

    it('logs to the caller’s log group instead of the pipeline’s when given', () => {
      const { stack, artifactResolver } = newFixture();
      const ownLogGroup                 = new LogGroup(stack, 'own-logs');

      new GoLambda(stack, 'lambda', { lambdaId: 'authorizer', pipeline: 'jmap', artifactResolver, logGroup: ownLogGroup });

      const ownLogGroupName: unknown = stack.resolve(ownLogGroup.logGroupName);
      const template                 = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', { LoggingConfig: { LogGroup: ownLogGroupName } });
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });
  });
});
