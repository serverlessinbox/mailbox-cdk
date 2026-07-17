import { Stack, App } from 'aws-cdk-lib';
import { PinnedResolver } from '../artifact-engine';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';

describe('PinnedResolver', () => {
  let app: App;
  let stack: Stack;

  beforeEach(() => {
    app = new App();
    stack = new Stack(app, 'test-stack');
  });

  describe('registerPackages', () => {
    it('should register packages successfully', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
        'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'mailbox-artifacts', {});
      resolver.registerPackages(['mailbox-go', 'mailbox-cdk']);

      // Should not throw when resolving registered packages
      expect(() => {
        resolver.resolve('mailbox-go', 'lambdas/handler.zip', 'us-east-1');
      }).not.toThrow();
    });

    it('should throw when resolving unregistered package', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'mailbox-artifacts', {});
      resolver.registerPackages(['mailbox-go']);

      // Should throw when resolving unregistered package
      expect(() => {
        resolver.resolve('mailbox-cdk', 'lambdas/handler.zip', 'us-east-1');
      }).toThrow(/Artifact package "mailbox-cdk" was not registered/);
    });

    it('should allow registering multiple packages in one call', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
        'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
        'mailbox-cognito': { version: '1.0.0', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'mailbox-artifacts', {});
      resolver.registerPackages(['mailbox-go', 'mailbox-cdk', 'mailbox-cognito']);

      // All packages should resolve without throwing
      expect(() => {
        resolver.resolve('mailbox-go', 'lambdas/handler.zip', 'us-east-1');
        resolver.resolve('mailbox-cdk', 'lambdas/handler.zip', 'us-east-1');
        resolver.resolve('mailbox-cognito', 'lambdas/handler.zip', 'us-east-1');
      }).not.toThrow();
    });

    it('should accumulate packages across multiple register calls', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
        'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
        'mailbox-cognito': { version: '1.0.0', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'mailbox-artifacts', {});
      resolver.registerPackages(['mailbox-go']);
      resolver.registerPackages(['mailbox-cdk', 'mailbox-cognito']);

      // All packages registered in both calls should resolve
      expect(() => {
        resolver.resolve('mailbox-go', 'lambdas/handler.zip', 'us-east-1');
        resolver.resolve('mailbox-cdk', 'lambdas/handler.zip', 'us-east-1');
        resolver.resolve('mailbox-cognito', 'lambdas/handler.zip', 'us-east-1');
      }).not.toThrow();
    });
  });

  describe('getVersion', () => {
    it('should return the version of a registered package', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.2.3', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'mailbox-artifacts', {});
      expect(resolver.getVersion('mailbox-go')).toBe('1.2.3');
    });
  });

  describe('getBucketBase', () => {
    it('should return the configured bucket base', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
      };

      const resolver = new PinnedResolver(stack, packages, 'custom-bucket-base', {});
      expect(resolver.getBucketBase()).toBe('custom-bucket-base');
    });
  });
});
