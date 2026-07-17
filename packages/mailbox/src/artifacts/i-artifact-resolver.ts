/**
 * Resolved S3 artifact location (jsii-exported from mailbox, D2).
 * Structurally identical to mailbox-cdk-shared's own ResolvedArtifact — structural typing
 * makes them interoperable without a cast (the fix for the round-1 crash).
 */
export interface ResolvedArtifact {
  readonly bucket: string;
  readonly key: string;
  readonly versionId?: string;
}

/**
 * Artifact resolution strategy interface (jsii-exported from mailbox, D2).
 * Implements two methods: resolve(pkg, objectPath, region) → ResolvedArtifact, and
 * registerPackages(names: string[]) → void (mandatory, new in subplan #10).
 * Structurally identical to mailbox-cdk-shared's own IArtifactResolver — structural typing,
 * no cast, no adapter needed.
 * Implemented by: PinnedResolver (mailbox-cdk-shared), ChannelResolver (infrastructure),
 * AutoUpdater (mailbox, jsii-exported).
 */
export interface IArtifactResolver {
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact;
  registerPackages(names: string[]): void;
}
