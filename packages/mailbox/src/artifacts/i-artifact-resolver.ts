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
 * Supplies artifact S3 locations and manages package registration for dynamic resolution.
 */
export interface IArtifactResolver {
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact;
  registerPackages(names: string[]): void;
}
