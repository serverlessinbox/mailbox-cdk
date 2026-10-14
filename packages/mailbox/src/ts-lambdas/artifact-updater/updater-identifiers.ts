import { parseArn, type Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifiers and names the artifact updater passes between its units, each a string of its own kind so
 * that one kind cannot be passed where another is expected. The brand exists in the type only. Every kind has
 * exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The ARN of a Lambda function the updater manages. */
export type LambdaFunctionArn = Branded<'LambdaFunctionArn'>;

/** The ARN of a CloudFront distribution that serves a UI bucket the updater manages. */
export type DistributionArn = Branded<'DistributionArn'>;

/** The bucket a UI bundle is unpacked into. */
export type ContentBucketName = Branded<'ContentBucketName'>;

/** The bucket a release artifact is read from. */
export type ArtifactBucketName = Branded<'ArtifactBucketName'>;

/** The name of the package a release artifact is published under. */
export type ArtifactPackageName = Branded<'ArtifactPackageName'>;

/** The name of a release artifact within its package. */
export type ArtifactName = Branded<'ArtifactName'>;

/** The version of a release artifact; it is not necessarily a valid semantic version. */
export type ArtifactVersion = Branded<'ArtifactVersion'>;

/** Throws when the string is not a Lambda function ARN. */
export function toLambdaFunctionArn(raw: string): LambdaFunctionArn {
  requireArn(raw, 'lambda', 'function');
  return raw as LambdaFunctionArn;
}

/** Throws when the string is not a CloudFront distribution ARN. */
export function toDistributionArn(raw: string): DistributionArn {
  requireArn(raw, 'cloudfront', 'distribution');
  return raw as DistributionArn;
}

export function toContentBucketName(raw: string): ContentBucketName {
  return raw as ContentBucketName;
}

export function toArtifactBucketName(raw: string): ArtifactBucketName {
  return raw as ArtifactBucketName;
}

export function toArtifactPackageName(raw: string): ArtifactPackageName {
  return raw as ArtifactPackageName;
}

export function toArtifactName(raw: string): ArtifactName {
  return raw as ArtifactName;
}

export function toArtifactVersion(raw: string): ArtifactVersion {
  return raw as ArtifactVersion;
}

function requireArn(raw: string, service: string, resourceType: string): void {
  const parsed = parseArn(raw);
  if (parsed.service !== service || parsed.resourceType !== resourceType) {
    throw new Error(`Invalid ARN "${raw}": expected a ${service} ${resourceType}`);
  }
}
