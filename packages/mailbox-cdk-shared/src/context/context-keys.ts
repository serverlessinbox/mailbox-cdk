/** Artifact bucket and package metadata: `{ bucketBase?, packages? }`. */
export const ARTIFACTS_CONTEXT_KEY = 'serverlessinbox:artifacts';

/** S3 object-version map for pinned artifact resolution. */
export const ARTIFACT_VERSIONS_CONTEXT_KEY = 'serverlessinbox:artifact_versions';

/** Deployment mechanism: 'cdk' | 'cfn' | 'marketplace'. */
export const DEPLOYER_TYPE_CONTEXT_KEY = 'serverlessinbox:deployer_type';

/** Development-mode flag. */
export const DEVELOPMENT_CONTEXT_KEY = 'serverlessinbox:development';

/** Vendor AWS account IDs that replace the built-in vendor account. */
export const VENDOR_ACCOUNT_IDS_CONTEXT_KEY = 'serverlessinbox:vendor_account_ids';
