import { IConstruct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { CdkArtifactResolver, type TrackGranularity } from '@serverlessinbox/mailbox-cdk-shared';
import { readArtifactVersions } from '@serverlessinbox/artifact-registry';
import type { ArtifactVersionsEntry, ArtifactZone, ParsedArtifactVersions } from '@serverlessinbox/artifact-registry';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';

const ARTIFACT_CONTEXT_KEYS = {
  config: 'artifacts',
  versionMap: 'artifactVersions',
} as const;

export interface CreateArtifactResolverOptions {
  /** Optional track mode configuration. */
  readonly track?: {
    readonly granularity: TrackGranularity;
    readonly distTag: string;
  };
}

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
export function createArtifactResolverFromContext(
  scope: IConstruct,
  options?: CreateArtifactResolverOptions,
): CdkArtifactResolver {
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
  const pkgJsonPath = path.join(pkgRoot, 'package.json');

  // JSON file provides zone info and fallback versions for external artifacts.
  // Baked-in versions exist only in a published construct (or after resolve-artifacts
  // runs); when consuming from source the file is absent and we rely entirely on the
  // track-version / context-supplied packages below.
  const jsonVersions: ParsedArtifactVersions = existsSync(versionsPath)
    ? readArtifactVersions(versionsPath)
    : { packages: {}, bucketBase: undefined };
  const packages: Record<string, ArtifactVersionsEntry> = { ...jsonVersions.packages };

  // Self-owned artifacts: inject from package.json when not provided by context
  const selfVersion: string = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version;
  const selfOwned: Array<[string, ArtifactZone]> = [
    ['mailbox-cdk', 'regional'],
    ['mailbox-cdk-edge', 'edge'],
  ];
  for (const [name, zone] of selfOwned) {
    if (!(name in packages)) {
      packages[name] = { version: selfVersion, zone };
    }
  }

  // Context-first: context.artifacts.packages overrides everything including self-owned
  const contextPackages = contextValue?.packages;
  if (contextPackages && typeof contextPackages === 'object') {
    for (const [name, target] of Object.entries(contextPackages as Record<string, unknown>)) {
      const t = target as Record<string, unknown>;
      const existingZone: ArtifactZone = packages[name]?.zone ?? 'regional';
      if (t?.kind === 'channel' && typeof t.channel === 'string') {
        packages[name] = { version: t.channel, zone: existingZone, channel: t.channel};
      } else if (t?.kind === 'release' && typeof t.version === 'string') {
        packages[name] = { version: t.version, zone: existingZone };
      }
    }
  }

  const versionMap = scope.node.tryGetContext(ARTIFACT_CONTEXT_KEYS.versionMap) as Record<string, string> | undefined;

  return new CdkArtifactResolver({
    versions: { bucketBase: jsonVersions.bucketBase, packages },
    bucketBaseOverride,
    deploymentRegion: stack.region,
    s3VersionMap: versionMap,
  }, scope, options?.track ? { track: options.track } : undefined);
}
