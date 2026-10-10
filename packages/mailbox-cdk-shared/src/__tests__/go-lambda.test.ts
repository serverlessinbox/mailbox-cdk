/// <reference types="jest" />

/**
 * GoLambda Construct Tests
 *
 * Tests for the GoLambda construct, which wraps Lambda Functions for Go runtimes:
 * - Environment variable merging: SERVICE_NAME is set to lambdaId
 * - Environment variable merging: caller-supplied env vars are preserved
 * - Caller's own SERVICE_NAME (if supplied) is overridden by construct
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda } from '../go-lambda';

describe('GoLambda Construct', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;

  beforeEach(() => {
    // Set up app with artifact context
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

    // Create a pinned resolver with required packages
    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
  });

  describe('Service name environment variable', () => {
    it('should set SERVICE_NAME to the lambdaId', () => {
      new GoLambda(stack, 'test-lambda', {
        lambdaId: 'email-processor',
        pipeline: 'mail-in',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'email-processor',
          },
        },
      });
    });

    it('should preserve caller-supplied environment variables', () => {
      new GoLambda(stack, 'test-lambda-env', {
        lambdaId: 'support-api',
        pipeline: 'admin',
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
            SERVICE_NAME: 'support-api',
            CUSTOM_VAR: 'custom-value',
            ANOTHER_VAR: 'another-value',
          },
        },
      });
    });

    it('should override caller-supplied SERVICE_NAME with lambdaId', () => {
      // Even if a caller mistakenly provides their own SERVICE_NAME,
      // the construct should enforce its own value based on lambdaId
      new GoLambda(stack, 'test-lambda-override', {
        lambdaId: 'authorizer',
        pipeline: 'jmap',
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
            SERVICE_NAME: 'authorizer',
            OTHER_VAR: 'should-be-preserved',
          },
        },
      });
    });

    it('should use serviceName for SERVICE_NAME when provided, while artifact key and tag stay on lambdaId', () => {
      new GoLambda(stack, 'test-lambda-service-name', {
        lambdaId: 'authorizer',
        pipeline: 'admin',
        serviceName: 'authorizer-admin-api',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'authorizer-admin-api',
          },
        },
        Code: {
          S3Key: Match.stringLikeRegexp('lambdas/authorizer\\.zip'),
        },
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:artifact-name', Value: 'authorizer' },
        ]),
      });
    });

    it('should default SERVICE_NAME to lambdaId when serviceName is not provided, with the same artifact key and tag', () => {
      new GoLambda(stack, 'test-lambda-no-service-name', {
        lambdaId: 'authorizer',
        pipeline: 'jmap',
        artifactResolver,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            SERVICE_NAME: 'authorizer',
          },
        },
        Code: {
          S3Key: Match.stringLikeRegexp('lambdas/authorizer\\.zip'),
        },
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:artifact-name', Value: 'authorizer' },
        ]),
      });
    });

    it('should set SERVICE_NAME for different lambdaIds', () => {
      const lambdaIds = ['email-sender', 'websocket-broadcast', 'stack-deployer'];

      for (const lambdaId of lambdaIds) {
        // Create a new app for each lambda to allow multiple synth calls
        const testApp = new App({
          context: {
            'serverlessinbox:artifacts': {
              bucketBase: 'test-artifacts',
              packages: {
                'mailbox-go': { kind: 'release', version: '1.0.0' },
              },
            },
          },
        });

        const testStack = new cdk.Stack(testApp, 'TestStack', {
          env: { account: '123456789012', region: 'us-west-2' },
          synthesizer: new BootstraplessSynthesizer(),
        });

        const packages: Record<string, ArtifactPin> = {
          'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        };
        const resolver = new PinnedArtifactResolver({
          packages,
          location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
          deploymentRegion: testStack.region,
        });

        new GoLambda(testStack, 'lambda', {
          lambdaId,
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
