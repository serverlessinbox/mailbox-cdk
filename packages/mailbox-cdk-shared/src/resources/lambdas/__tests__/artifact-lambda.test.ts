/// <reference types="jest" />

/**
 * Pins what every artifact-backed Lambda gets from ArtifactLambda, whichever wrapper builds it: the code
 * comes from the published artifact of the named package, `SERVICE_NAME` is the name every log line is
 * attributed to and cannot be overridden through the environment, and the function logs to the shared log
 * group of its pipeline. A wrong artifact key deploys the wrong code; a wrong `SERVICE_NAME` misattributes
 * the logs of every function sharing a bundle.
 */

import { ArtifactZone, PinnedArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { Runtime }                               from 'aws-cdk-lib/aws-lambda';
import { LogGroup }                              from 'aws-cdk-lib/aws-logs';
import { App, BootstraplessSynthesizer, Stack }  from 'aws-cdk-lib';

import { ArtifactLambda }                        from '../artifact-lambda';
import type { ArtifactLambdaProps }              from '../artifact-lambda';
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
    packages: { 'test-package': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

/** Concrete stand-in for the abstract ArtifactLambda, so the suite can construct the base behaviour. */
class TestArtifactLambda extends ArtifactLambda {}

function newLambda(fixture: LambdaFixture, overrides: Partial<ArtifactLambdaProps> = {}): ArtifactLambda {
  return new TestArtifactLambda(fixture.stack, 'lambda', {
    lambdaId: 'stack-deployer',
    packageName: 'test-package',
    pipeline: 'infra',
    artifactResolver: fixture.artifactResolver,
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    ...overrides,
  });
}

describe('ArtifactLambda', () => {
  it('fails at synth naming the package when the resolver holds no pin for it', () => {
    const fixture = newFixture();

    expect(() => newLambda(fixture, { packageName: 'not-pinned' })).toThrow("No resolved data for package 'not-pinned'");
  });

  it('loads its code from lambdas/<lambdaId>.zip of the named package and runs on ARM64', () => {
    const fixture = newFixture();

    newLambda(fixture);

    Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('test-package.*lambdas/stack-deployer\\.zip') },
      Architectures: ['arm64'],
    });
  });

  describe('service name', () => {
    it('defaults SERVICE_NAME to the lambdaId, which also names the artifact tag', () => {
      const fixture = newFixture();

      newLambda(fixture);

      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer' } },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' }]),
      });
    });

    it('uses serviceName for SERVICE_NAME when given, while the artifact key and tag stay on the lambdaId', () => {
      const fixture = newFixture();

      newLambda(fixture, { serviceName: 'stack-deployer-data-starter' });

      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer-data-starter' } },
        Code: { S3Key: Match.stringLikeRegexp('lambdas/stack-deployer\\.zip') },
        Tags: Match.arrayWith([{ Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' }]),
      });
    });

    it('keeps the caller’s environment variables and overrides a caller-supplied SERVICE_NAME', () => {
      const fixture = newFixture();

      newLambda(fixture, { environment: { SERVICE_NAME: 'wrong-value', CUSTOM_VAR: 'custom-value' } });

      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { SERVICE_NAME: 'stack-deployer', CUSTOM_VAR: 'custom-value' } },
      });
    });
  });

  describe('description', () => {
    it('names the lambdaId and the stack by default', () => {
      const fixture = newFixture();

      newLambda(fixture);

      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: { 'Fn::Join': ['', ['Serverless Inbox Mailbox: stack-deployer (', { Ref: 'AWS::StackName' }, ')']] },
      });
    });

    it('is the caller’s description when given', () => {
      const fixture = newFixture();

      newLambda(fixture, { description: 'Starts the deployer workflow' });

      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        Description: 'Starts the deployer workflow',
      });
    });
  });

  describe('logging', () => {
    it('logs to the shared log group of its pipeline', () => {
      const fixture = newFixture();

      newLambda(fixture);

      const pipelineLogGroup: unknown = fixture.stack.resolve(PipelineLogGroup.getOrCreate(fixture.stack, 'infra').logGroupName);
      Template.fromStack(fixture.stack).hasResourceProperties('AWS::Lambda::Function', {
        LoggingConfig: { LogGroup: pipelineLogGroup },
      });
    });

    it('logs to the caller’s log group instead of the pipeline’s when given', () => {
      const fixture     = newFixture();
      const ownLogGroup = new LogGroup(fixture.stack, 'own-logs');

      newLambda(fixture, { logGroup: ownLogGroup });

      const ownLogGroupName: unknown = fixture.stack.resolve(ownLogGroup.logGroupName);
      const template                 = Template.fromStack(fixture.stack);
      template.hasResourceProperties('AWS::Lambda::Function', { LoggingConfig: { LogGroup: ownLogGroupName } });
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });
  });
});
