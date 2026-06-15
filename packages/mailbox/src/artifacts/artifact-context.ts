import { IConstruct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { CdkArtifactResolver } from './cdk-artifact-resolver';
import { readArtifactVersions } from '@serverlessinbox/artifact-tools';
import * as path from 'path';

const ARTIFACT_CONTEXT_KEYS = {
  config: 'artifacts',
  versionMap: 'artifactVersions',
} as const;

/**
 * Creates an ArtifactResolver from CDK context values.
 *
 * Context key: `artifacts` (optional override)
 *
 * Structure:
 * ```json
 * {
 *   "bucketBase": "mailbox-artifacts"
 * }
 * ```
 *
 * If context is not provided, reads the default artifact-versions.json file.
 * bucketBase in context (if present) overrides the versions file value.
 */
export function createArtifactResolverFromContext(scope: IConstruct): CdkArtifactResolver {
  const stack = Stack.of(scope);
  const contextValue = scope.node.tryGetContext(ARTIFACT_CONTEXT_KEYS.config);
  let bucketBaseOverride: string | undefined;

  if (contextValue) {
    if (typeof contextValue !== 'object') {
      throw new Error(
        `Invalid context value for '${ARTIFACT_CONTEXT_KEYS.config}': ` +
          'Expected an object.',
      );
    }
    bucketBaseOverride = contextValue.bucketBase;
  }

  const pkgRoot = path.join(__dirname, '../..');
  const versionsPath = path.join(pkgRoot, 'artifact-versions.json');

  // Read and parse versions file using artifact-tools
  const parsedVersions = readArtifactVersions(versionsPath);

  // Use the factory to produce pre-computed artifact data
  return new CdkArtifactResolver({
    versions: parsedVersions,
    bucketBaseOverride,
    deploymentRegion: stack.region,
  }, scope);
}
