import { Stack, App } from 'aws-cdk-lib';
import { CdkArtifactEngine, PinnedResolver } from '../artifact-engine';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { RegistryLocation } from '@serverlessinbox/artifact-registry/registry';
import { TEST_REGISTRY_RECORD } from './test-registry-record';

const TEST_LOCATION: RegistryLocation = { bucketBase: 'mailbox-artifacts', project: 'serverlessinbox' };

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

      const resolver = new PinnedResolver(stack, packages, TEST_LOCATION, {});
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

      const resolver = new PinnedResolver(stack, packages, TEST_LOCATION, {});
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

      const resolver = new PinnedResolver(stack, packages, TEST_LOCATION, {});
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

      const resolver = new PinnedResolver(stack, packages, TEST_LOCATION, {});
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

      const resolver = new PinnedResolver(stack, packages, TEST_LOCATION, {});
      expect(resolver.getVersion('mailbox-go')).toBe('1.2.3');
    });
  });

  describe('location', () => {
    it('should return the location the resolver was built with', () => {
      const packages: Record<string, ArtifactVersionsEntry> = {
        'mailbox-go': { version: '1.0.0', zone: 'regional' },
      };
      const location: RegistryLocation = {
        bucketBase: 'custom-bucket-base',
        project: 'custom-project',
        bucketOverrides: { 'eu-west-1': 'custom-eu-bucket' },
      };

      const resolver = new PinnedResolver(stack, packages, location, {});
      expect(resolver.location).toEqual(location);
    });
  });

  describe('loadFromArtifactMetadata', () => {
    const CONTEXT_PACKAGES = { 'mailbox-go': { kind: 'release', version: '1.0.0' } };

    function stackWithContext(context: Record<string, unknown>): Stack {
      return new Stack(new App({ context }), 'context-stack', { env: { account: '123456789012', region: 'eu-west-1' } });
    }

    it('uses the given registry record when the artifacts context is absent', () => {
      const resolver = PinnedResolver.loadFromArtifactMetadata(stackWithContext({}), TEST_REGISTRY_RECORD);

      expect(resolver.location).toEqual({ bucketBase: 'mailbox-artifacts', project: 'serverlessinbox' });
    });

    it('replaces the location fields the artifacts context names and keeps the record for the rest', () => {
      const resolver = PinnedResolver.loadFromArtifactMetadata(
        stackWithContext({
          'serverlessinbox:artifacts': {
            bucketBase: 'override-base',
            bucketOverrides: { 'eu-west-1': 'override-eu-bucket' },
            packages: CONTEXT_PACKAGES,
          },
        }),
        TEST_REGISTRY_RECORD,
      );
      resolver.registerPackages(['mailbox-go']);

      expect(resolver.location).toEqual({
        bucketBase: 'override-base',
        project: 'serverlessinbox',
        bucketOverrides: { 'eu-west-1': 'override-eu-bucket' },
      });
      expect(resolver.resolve('mailbox-go', 'lambdas/handler.zip', 'eu-west-1').bucket).toBe('override-eu-bucket');
    });

    it.each([
      ['a bucketBase that is not a string', { bucketBase: 42 }],
      ['an empty project', { project: '' }],
      ['a package target of unknown kind', { packages: { 'mailbox-go': { kind: 'tag', version: '1.0.0' } } }],
    ])('throws naming the key and the value for %s', (_description, invalid) => {
      const stackWithInvalidContext = stackWithContext({ 'serverlessinbox:artifacts': invalid });

      expect(() => PinnedResolver.loadFromArtifactMetadata(stackWithInvalidContext, TEST_REGISTRY_RECORD)).toThrow(
        `Invalid CDK context value for "serverlessinbox:artifacts": ${JSON.stringify(invalid)}`,
      );
    });

    it('throws naming the key and the value when the artifact versions context is not a string map', () => {
      const stackWithInvalidContext = stackWithContext({ 'serverlessinbox:artifact_versions': { 'lambdas/x.zip': 7 } });

      expect(() => PinnedResolver.loadFromArtifactMetadata(stackWithInvalidContext, TEST_REGISTRY_RECORD)).toThrow(
        'Invalid CDK context value for "serverlessinbox:artifact_versions": {"lambdas/x.zip":7}',
      );
    });
  });
});

/**
 * The engine answers version and location only through the resolver it is given. The CDK context
 * here names a different location and package version than the resolver, so an engine that read
 * the context itself would report the context's values instead of the resolver's.
 */
describe('CdkArtifactEngine', () => {
  const CONFLICTING_CONTEXT = {
    'serverlessinbox:artifacts': {
      bucketBase: 'context-base',
      project: 'context-project',
      packages: { 'mailbox-go': { kind: 'release', version: '9.9.9' } },
    },
  };

  function engineOverResolverWithConflictingContext(): CdkArtifactEngine {
    const stack = new Stack(new App({ context: CONFLICTING_CONTEXT }), 'engine-stack', {
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    const resolver = new PinnedResolver(
      stack,
      { 'mailbox-go': { version: '1.2.3', zone: 'regional' } },
      { bucketBase: 'resolver-base', project: 'resolver-project' },
      {},
    );
    return new CdkArtifactEngine(stack, resolver);
  }

  it('reports the location of the resolver it is given', () => {
    const engine = engineOverResolverWithConflictingContext();

    expect(engine.location).toEqual({ bucketBase: 'resolver-base', project: 'resolver-project' });
  });

  it('reports the package version of the resolver it is given', () => {
    const engine = engineOverResolverWithConflictingContext();

    expect(engine.getVersion('mailbox-go')).toBe('1.2.3');
  });
});
