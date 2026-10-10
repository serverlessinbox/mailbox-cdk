/// <reference types="jest" />

/**
 * TypeScriptLambda Construct Tests
 *
 * Tests for the TypeScriptLambda construct:
 * - Environment variable merging: SERVICE_NAME is set to lambdaId
 * - Environment variable merging: caller-supplied env vars are preserved
 * - Caller's own SERVICE_NAME (if supplied) is overridden by construct
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda } from '../index';

describe('TypeScriptLambda Construct', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;

  beforeEach(() => {
    app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create a pinned resolver with required packages
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
  });

  describe('Unpinned package', () => {
    it('fails at synth naming the package when the resolver holds no pin for it', () => {
      expect(
        () =>
          new TypeScriptLambda(stack, 'unpinned-lambda', {
            lambdaId: 'artifact-updater',
            packageName: 'not-pinned',
            pipeline: 'infra',
            artifactResolver,
          }),
      ).toThrow("No resolved data for package 'not-pinned'");
    });
  });

  describe('Service name environment variable', () => {
    it('should set SERVICE_NAME to the lambdaId', () => {
      new TypeScriptLambda(stack, 'test-lambda', {
        lambdaId: 'artifact-updater',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'artifact-updater',
          },
        },
      });
    });

    it('should preserve caller-supplied environment variables', () => {
      new TypeScriptLambda(stack, 'test-lambda-env', {
        lambdaId: 'resource-sweeper',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
        environment: {
          CUSTOM_VAR: 'custom-value',
          ANOTHER_VAR: 'another-value',
        },
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'resource-sweeper',
            CUSTOM_VAR: 'custom-value',
            ANOTHER_VAR: 'another-value',
          },
        },
      });
    });

    it('should override caller-supplied SERVICE_NAME with lambdaId', () => {
      // Even if a caller mistakenly provides their own SERVICE_NAME,
      // the construct should enforce its own value based on lambdaId
      new TypeScriptLambda(stack, 'test-lambda-override', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
        environment: {
          SERVICE_NAME: 'wrong-value',
          OTHER_VAR: 'should-be-preserved',
        },
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'stack-deployer',
            OTHER_VAR: 'should-be-preserved',
          },
        },
      });
    });

    it('should use serviceName for SERVICE_NAME when provided, while artifact key and tag stay on lambdaId', () => {
      new TypeScriptLambda(stack, 'test-lambda-service-name', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        serviceName: 'stack-deployer-data-starter',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'stack-deployer-data-starter',
          },
        },
        Code: {
          S3Key: Match.stringLikeRegexp('lambdas/stack-deployer\\.zip'),
        },
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' },
        ]),
      });
    });

    it('should default SERVICE_NAME to lambdaId when serviceName is not provided, with the same artifact key and tag', () => {
      new TypeScriptLambda(stack, 'test-lambda-no-service-name', {
        lambdaId: 'stack-deployer',
        packageName: 'mailbox-cdk',
        pipeline: 'infra',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'stack-deployer',
          },
        },
        Code: {
          S3Key: Match.stringLikeRegexp('lambdas/stack-deployer\\.zip'),
        },
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:artifact-name', Value: 'stack-deployer' },
        ]),
      });
    });

    it('should set SERVICE_NAME for different lambdaIds', () => {
      const lambdaIds = ['bucket-auto-empty', 'content-deployer', 'bootstrap-user'];

      for (const lambdaId of lambdaIds) {
        // Create a new app for each lambda to allow multiple synth calls
        const testApp = new App();

        const testStack = new cdk.Stack(testApp, 'TestStack', {
          env: { account: '123456789012', region: 'us-west-2' },
          synthesizer: new BootstraplessSynthesizer(),
        });

        const packages: Record<string, ArtifactPin> = {
          'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        };
        const resolver = new PinnedArtifactResolver({
          packages,
          location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
          deploymentRegion: testStack.region,
        });

        new TypeScriptLambda(testStack, 'lambda', {
          lambdaId,
          packageName: 'mailbox-cdk',
          pipeline: 'infra',
          artifactResolver: resolver,
        });

        const template = Template.fromStack(testStack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              SERVICE_NAME: lambdaId,
            },
          },
        });
      }
    });
  });
});
