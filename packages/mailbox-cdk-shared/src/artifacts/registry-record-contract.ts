/**
 * A registry record: the configuration where artifacts are published (bucketBase, project,
 * regions, optional bucket overrides) plus the schema version and the AWS account ID that owns
 * the buckets. Declared with plain types and no imports so the packed declarations of a
 * publishable package do not reach the registry package's validator types.
 */
export interface RegistryRecord {
  readonly schemaVersion:    1;
  readonly ownerAccountId:   string;
  readonly regions:          string[];
  readonly bucketBase:       string;
  readonly project:          string;
  readonly bucketOverrides?: Record<string, string> | undefined;
}
