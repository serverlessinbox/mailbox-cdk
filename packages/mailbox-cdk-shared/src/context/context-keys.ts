/**
 * Centralized CDK context keys. Absence must fall back to the documented default (never throw);
 * a present-but-invalid value must throw naming the key and value.
 *
 * `serverlessinbox:` (no hyphen) is deliberately distinct from the hyphenated `serverless-inbox:`
 * IAM tag prefix — two separate conventions, not an inconsistency.
 */

/** Artifact bucket/package metadata (`{ bucketBase?, packages? }`) — see `MailboxArtifactResolverFactory.fromContext`. */
export const ARTIFACTS_CONTEXT_KEY = 'serverlessinbox:artifacts';

/** S3 object-version map for pinned artifact resolution — see `MailboxArtifactResolverFactory.fromContext`. */
export const ARTIFACT_VERSIONS_CONTEXT_KEY = 'serverlessinbox:artifact_versions';

/** Deployment mechanism ('cdk' | 'cfn' | 'marketplace') — read by `Mailbox`. */
export const DEPLOYER_TYPE_CONTEXT_KEY = 'serverlessinbox:deployer_type';

/** Development-mode flag — see `isDevelopmentMode`. */
export const DEVELOPMENT_CONTEXT_KEY = 'serverlessinbox:development';

/** Vendor AWS account IDs permitted to assume the support hop role — see `resolveVendorAccountIds`. */
export const VENDOR_ACCOUNT_IDS_CONTEXT_KEY = 'serverlessinbox:vendor_account_ids';
