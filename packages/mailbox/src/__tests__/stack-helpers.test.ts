/// <reference types="jest" />

/**
 * StackHelpers Construct Tests
 *
 * Tests for the singleton StackHelpers construct:
 * - Singleton behavior: multiple getOrCreate calls return the same instance
 * - Custom resource attachment: each resolver call creates its own CR under the caller's scope
 * - Regression guard: artifact resolver can register unrelated packages without throwing
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { StackHelpers } from '../utils/stack-helpers';

describe('StackHelpers Construct', () => {
  let app: App;
  let stack: cdk.Stack;
  let resolver: any; // PinnedResolver - passed directly to StackHelpers

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
    resolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    resolver.registerPackages(['mailbox-cdk']);
  });

  /**
   * Singleton behavior: getOrCreate returns the same instance for multiple calls
   * on the same Stack, placed under Stack → shared → stack-helpers hierarchy.
   */
  describe('Singleton getOrCreate', () => {
    it('returns the same StackHelpers instance for multiple getOrCreate calls on same stack', () => {
      // First call
      const helpers1 = StackHelpers.getOrCreate(stack, resolver);

      // Second call on same stack
      const helpers2 = StackHelpers.getOrCreate(stack, resolver);

      // Both should be the same instance
      expect(helpers1).toBe(helpers2);
    });

    it('places the singleton under Stack → shared → stack-helpers construct hierarchy', () => {
      const helpers = StackHelpers.getOrCreate(stack, resolver);

      // Check the construct path
      expect(helpers.node.path).toBe('TestStack/shared/stack-helpers');
    });

    it('synthesizes to exactly one Lambda in the template regardless of call count', () => {
      // Multiple getOrCreate calls
      StackHelpers.getOrCreate(stack, resolver);
      StackHelpers.getOrCreate(stack, resolver);
      StackHelpers.getOrCreate(stack, resolver);

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, any> | undefined;

      // Count Lambda functions
      const lambdas = Object.values(resources || {}).filter(
        (r: any) => r.Type === 'AWS::Lambda::Function'
      );

      // Exactly one Lambda for the shared stack-helpers
      expect(lambdas).toHaveLength(1);
    });
  });

  /**
   * Custom resource attachment: each resolver call creates its own CfnCustomResource
   * under the caller's scope, while sharing the single Lambda.
   */
  describe('Custom resource attachment', () => {
    it('creates separate custom resources for resolveMailboxData and resolveCognitoDomainPrefix', () => {
      const helpers = StackHelpers.getOrCreate(stack, resolver);

      // Create a scope for caller resources
      const callerScope = new Construct(stack, 'CallerScope');

      // First resolver call: resolveMailboxData
      helpers.resolveMailboxData(callerScope, 'stack-helpers-v2', {
        hostedZoneId: 'Z123',
        dataStackName: 'my-data-stack',
      });

      // Second resolver call: resolveCognitoDomainPrefix
      helpers.resolveCognitoDomainPrefix(callerScope, 'domain-prefix-v2', 'Z456');

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, any> | undefined;

      // Count custom resources
      const customResources = Object.values(resources || {}).filter(
        (r: any) => r.Type === 'Custom::StackHelpers'
      );

      // Should have exactly 2 custom resources (one per resolver call)
      expect(customResources).toHaveLength(2);

      // Should still have exactly 1 Lambda
      const lambdas = Object.values(resources || {}).filter(
        (r: any) => r.Type === 'AWS::Lambda::Function'
      );
      expect(lambdas).toHaveLength(1);
    });
  });

  /**
   * Regression guard: artifact resolver can register additional unrelated packages
   * without throwing at synth time (idempotent registerPackages call).
   */
  describe('Regression guard', () => {
    it('does not throw when creating StackHelpers with artifact resolver', () => {
      // Should not throw - StackHelpers internally calls registerPackages(['mailbox-cdk'])
      expect(() => {
        StackHelpers.getOrCreate(stack, resolver);
        app.synth();
      }).not.toThrow();
    });

    it('idempotent registerPackages: multiple StackHelpers creations succeed', () => {
      // Multiple attempts to create/get the singleton
      const helpers1 = StackHelpers.getOrCreate(stack, resolver);
      const helpers2 = StackHelpers.getOrCreate(stack, resolver);

      // Should return the same instance
      expect(helpers1).toBe(helpers2);

      // Should synth successfully
      expect(() => app.synth()).not.toThrow();
    });
  });
});
