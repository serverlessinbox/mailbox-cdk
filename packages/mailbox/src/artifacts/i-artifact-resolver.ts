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
 * Where the artifact registry publishes its artifacts: everything needed to name a registry
 * bucket and the key prefix of its objects. A resolver reports this so the constructs that
 * deploy from the registry (stack updaters, UI deployers, the artifact updater) read and
 * write the same buckets the resolver resolves code from.
 *
 * It does not list regions: which regions to use is decided by whoever holds the location.
 */
export interface RegistryLocation {
  /**
   * The prefix shared by every region's registry bucket. The bucket of a region is
   * `{bucketBase}-{region}` unless `bucketOverrides` names one for that region.
   *
   * Pass the value your registry was created with; a wrong value points deployments at
   * buckets that do not exist.
   */
  readonly bucketBase: string;

  /**
   * The project name that leads every object key in the registry. Several projects can share
   * one set of buckets because each keeps its objects under its own project prefix.
   *
   * Pass the project name the artifacts were published under.
   */
  readonly project: string;

  /**
   * Bucket names that replace the `{bucketBase}-{region}` convention name, keyed by region.
   * Use it when a registry bucket in some region does not follow the naming convention.
   *
   * @default - every region uses its convention name `{bucketBase}-{region}`
   */
  readonly bucketOverrides?: { [region: string]: string };
}

/**
 * Artifact resolution strategy interface (jsii-exported from mailbox, D2).
 * Supplies artifact S3 locations, the version each package resolves to and the registry
 * location, and manages package registration for dynamic resolution.
 */
export interface IArtifactResolver {
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact;
  registerPackages(names: string[]): void;

  /**
   * The version the given package resolves to. Throws when the package is unknown to the resolver.
   */
  getVersion(packageName: string): string;

  /**
   * The registry location this resolver resolves artifacts from.
   */
  readonly location: RegistryLocation;
}
