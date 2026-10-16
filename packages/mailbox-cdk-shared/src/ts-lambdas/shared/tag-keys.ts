/** The keys of the tags Serverless Inbox puts on its resources. It imports nothing, so it loads without CDK. */

const TAG_PREFIX = 'serverless-inbox:' as const;

export const ServerlessInboxTagKeys = {
  product: `${TAG_PREFIX}product`,
  /** The AWS-conventional resource name tag. Unprefixed, unlike the other keys. */
  name: 'Name',
  /** Main (root) stack name — shared across all stacks in a deployment for cross-stack correlation. */
  rootStack: `${TAG_PREFIX}root-stack`,
  /** This stack's own name (AWS::StackName). */
  stack: `${TAG_PREFIX}stack`,
  component: `${TAG_PREFIX}component`,
  description: `${TAG_PREFIX}description`,
  /** Construct/CDK suite version (generic — every deployment has one). */
  version: `${TAG_PREFIX}version`,
  /**
   * Published *template* version — present ONLY on template-based deployments (e.g. the standard app),
   * stamped by that app's release pipeline. This is the axis the human-gated ChangeSet self-update
   * compares against; distinct from `version` (the construct version).
   */
  templateVersion: `${TAG_PREFIX}template-version`,
  deployerType: `${TAG_PREFIX}deployer_type`,

  edge: `${TAG_PREFIX}edge`,
  rootRegion: `${TAG_PREFIX}root-region`,

  artifactName: `${TAG_PREFIX}artifact-name`,
  artifactPackage: `${TAG_PREFIX}artifact-package`,
  artifactVersion: `${TAG_PREFIX}artifact-version`,
  autoUpdateType: `${TAG_PREFIX}auto-update-type`,
  bucketName: `${TAG_PREFIX}bucket-name`,
} as const;
