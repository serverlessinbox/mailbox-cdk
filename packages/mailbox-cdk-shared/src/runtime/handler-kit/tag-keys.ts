const TAG_PREFIX = 'serverless-inbox:' as const;

/**
 * The keys of the tags Serverless Inbox puts on its resources. Use these constants wherever a tag key is written,
 * read or constrained (a tag condition in an IAM policy, a resource-group query, a filter over tagged resources),
 * so that the tagging side and the reading side cannot drift apart. The file imports nothing, so it loads without
 * CDK.
 */
export const ServerlessInboxTagKeys = {
  /** The product a resource belongs to. */
  product: `${TAG_PREFIX}product`,
  /** The AWS-conventional resource name tag. Unprefixed, unlike the other keys. */
  name: 'Name',
  /** Main (root) stack name — shared across all stacks in a deployment for cross-stack correlation. */
  rootStack: `${TAG_PREFIX}root-stack`,
  /**
   * The root stack's unique id (the guid at the end of its stack id ARN). Unlike the root stack's
   * name, it is never reused by a later stack, so it identifies which stack owns a resource.
   */
  rootStackId: `${TAG_PREFIX}root-stack-id`,
  /** This stack's own name (AWS::StackName). */
  stack: `${TAG_PREFIX}stack`,
  /** The component of the product a resource is part of. */
  component: `${TAG_PREFIX}component`,
  /** A sentence describing the resource. */
  description: `${TAG_PREFIX}description`,
  /** The construct suite version. */
  version: `${TAG_PREFIX}version`,
  /** The published template version, which is distinct from the construct suite version. */
  templateVersion: `${TAG_PREFIX}template-version`,
  /** The deployer type of the deployment, resolved from CDK context. Written with an underscore, unlike the other keys. */
  deployerType: `${TAG_PREFIX}deployer_type`,

  /** Marks a resource of the edge stack, with the value `true`. */
  edge: `${TAG_PREFIX}edge`,
  /** The region where the root stack is deployed. */
  rootRegion: `${TAG_PREFIX}root-region`,

  /** The artifact name; for a Lambda function its lambda identifier. */
  artifactName: `${TAG_PREFIX}artifact-name`,
  /** The name of the package the artifact belongs to. */
  artifactPackage: `${TAG_PREFIX}artifact-package`,
  /** The version of the artifact. */
  artifactVersion: `${TAG_PREFIX}artifact-version`,
  /** How the resource is kept current with new artifact versions: `code`, `ui`, `edge`, or `none` to leave it out of auto-update. */
  autoUpdateType: `${TAG_PREFIX}auto-update-type`,
  /** The name of the bucket associated with the tagged resource. */
  bucketName: `${TAG_PREFIX}bucket-name`,
} as const;
