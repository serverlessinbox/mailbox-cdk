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
import { Template } from 'aws-cdk-lib/assertions';
import { PinnedResolver, CdkArtifactEngine, TypeScriptLambda } from '../index';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '../artifact-engine';

describe('TypeScriptLambda Construct', () => {
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
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
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
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-cdk']);
    const engine = new CdkArtifactEngine(stack, pinnedResolver);
    artifactResolver = engine;
  });

  describe('Service name environment variable', () => {
    it('should set SERVICE_NAME to the lambdaId', () => {
      new TypeScriptLambda(stack, 'test-lambda', {
        lambdaId: 'artifact-updater',
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

    it('should set SERVICE_NAME for different lambdaIds', () => {
      const lambdaIds = ['bucket-auto-empty', 'content-deployer', 'bootstrap-user'];

      for (const lambdaId of lambdaIds) {
        // Create a new app for each lambda to allow multiple synth calls
        const testApp = new App({
          context: {
            artifacts: {
              bucketBase: 'test-artifacts',
              packages: {
                'mailbox-cdk': { kind: 'release', version: '1.0.0' },
              },
            },
          },
        });

        const testStack = new cdk.Stack(testApp, 'TestStack', {
          env: { account: '123456789012', region: 'us-west-2' },
          synthesizer: new BootstraplessSynthesizer(),
        });

        const packages: Record<string, ArtifactVersionsEntry> = {
          'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
        };
        const pinnedResolver = new PinnedResolver(testStack, packages, 'test-artifacts', {});
        pinnedResolver.registerPackages(['mailbox-cdk']);
        const engine = new CdkArtifactEngine(testStack, pinnedResolver);

        new TypeScriptLambda(testStack, 'lambda', {
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
