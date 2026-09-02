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
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { GoLambda } from '../utils/go-lambda';

describe('GoLambda Construct', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;

  beforeEach(() => {
    // Set up app with artifact context
    app = new App({
      context: {
        artifacts: {
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
    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-go']);
    const engine = new CdkArtifactEngine(stack, pinnedResolver);
    artifactResolver = engine;
  });

  describe('Service name environment variable', () => {
    it('should set SERVICE_NAME to the lambdaId', () => {
      new GoLambda(stack, 'test-lambda', {
        lambdaId: 'email-processor',
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
        lambdaId: 'support-access-api',
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
            SERVICE_NAME: 'support-access-api',
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
            artifacts: {
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

        const packages: Record<string, ArtifactVersionsEntry> = {
          'mailbox-go': { version: '1.0.0', zone: 'regional' },
        };
        const pinnedResolver = new PinnedResolver(testStack, packages, 'test-artifacts', {});
        pinnedResolver.registerPackages(['mailbox-go']);
        const engine = new CdkArtifactEngine(testStack, pinnedResolver);

        new GoLambda(testStack, 'lambda', {
          lambdaId,
          artifactResolver: engine,
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
