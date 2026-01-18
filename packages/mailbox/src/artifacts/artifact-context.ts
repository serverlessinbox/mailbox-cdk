import { IConstruct } from 'constructs';
import { ArtifactResolver, ArtifactResolverConfig } from './artifact-resolver';

const ARTIFACT_CONTEXT_KEYS = {
  config: 'artifacts',
  versionMap: 'artifactVersions',
} as const;

/**
 * Creates an ArtifactResolver from CDK context values.
 *
 * Context key: `artifacts` (required)
 *
 * Structure:
 * ```json
 * {
 *   "bucketBase": "mailbox-artifacts",
 *   "packages": {
 *     "mailbox-cdk": { "kind": "release", "version": "1.2.3" },
 *     "mailbox-go": { "kind": "channel", "channel": "dev" }
 *   }
 * }
 * ```
 *
 * Optional context key: `artifactVersions` (for versioned URLs in channels)
 * Map of S3 keys to version IDs: `{ "packages/mailbox-go/channels/dev/lambdas/handler.zip": "abc123" }`
 */
export function createArtifactResolverFromContext(scope: IConstruct): ArtifactResolver {
  const contextValue = scope.node.tryGetContext(ARTIFACT_CONTEXT_KEYS.config);

  if (!contextValue) {
    throw new Error(
      `Missing context value '${ARTIFACT_CONTEXT_KEYS.config}'. ` +
        'Provide artifact configuration via cdk.json or CLI -c flag.',
    );
  }

  if (typeof contextValue !== 'object' || !contextValue.packages) {
    throw new Error(
      `Invalid context value for '${ARTIFACT_CONTEXT_KEYS.config}': ` +
        'Expected an object with a "packages" field.',
    );
  }

  const versionMap = scope.node.tryGetContext(ARTIFACT_CONTEXT_KEYS.versionMap) ?? {};

  const config: ArtifactResolverConfig = {
    ...contextValue,
    versionMap,
  };

  return new ArtifactResolver(scope, config);
}
