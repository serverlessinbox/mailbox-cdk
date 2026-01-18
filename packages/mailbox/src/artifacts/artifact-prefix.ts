/**
 * Utilities for artifact path naming based on S3 structure in artifacts.md
 */

import type { PublishTarget } from './artifact-resolver';

export type { PublishTarget };

export interface ArtifactReference {
  /** Artifact path relative to the publish target prefix, e.g. "template.json" or "lambdas/blob-authorizer.zip" */
  readonly key: string;

  /** Optional S3 object version ID */
  readonly s3VersionId?: string;
}

/**
 * Builds the artifact prefix for a package following the S3 naming convention.
 *
 * - Release: `packages/{packageName}/v{version}`
 * - Channel: `packages/{packageName}/channels/{channel}`
 */
export function getArtifactPrefix(target: PublishTarget, packageName: string = 'mailbox-cdk'): string {
  if (target.kind === 'release') {
    if (!target.version || target.version.trim() === '') {
      throw new Error('version is required when kind=release');
    }
    return `packages/${packageName}/v${target.version}`;
  }

  const channel = target.channel.trim();
  if (!channel) {
    throw new Error('channel is required when kind=channel');
  }
  return `packages/${packageName}/channels/${channel}`;
}

/**
 * Builds the artifact prefix for edge resources (mailbox-cdk-edge package).
 * Edge resources are always deployed to us-east-1.
 *
 * - Release: `packages/mailbox-cdk-edge/v{version}`
 * - Channel: `packages/mailbox-cdk-edge/channels/{channel}`
 */
export function getEdgeArtifactPrefix(target: PublishTarget): string {
  return getArtifactPrefix(target, 'mailbox-cdk-edge');
}

/**
 * Builds a full S3 HTTPS URL for an artifact.
 *
 * @param bucket S3 bucket name (without region suffix)
 * @param target Publish target (release or channel)
 * @param reference Artifact reference with key and optional version ID
 * @param packageName Package name (defaults to mailbox-cdk)
 * @returns Full HTTPS URL, optionally with ?versionId query param
 */
export function getArtifactUrl(
  bucket: string,
  target: PublishTarget,
  reference: ArtifactReference,
  packageName: string = 'mailbox-cdk',
): string {
  const prefix = getArtifactPrefix(target, packageName);
  const fullKey = `${prefix}/${reference.key}`;
  let url = `https://${bucket}.s3.amazonaws.com/${fullKey}`;
  if (reference.s3VersionId) {
    url += `?versionId=${reference.s3VersionId}`;
  }
  return url;
}

/**
 * Builds a full S3 HTTPS URL for an edge artifact.
 *
 * @param bucket S3 bucket name (without region suffix)
 * @param target Publish target (release or channel)
 * @param reference Artifact reference with key and optional version ID
 * @returns Full HTTPS URL, optionally with ?versionId query param
 */
export function getEdgeArtifactUrl(
  bucket: string,
  target: PublishTarget,
  reference: ArtifactReference,
): string {
  return getArtifactUrl(bucket, target, reference, 'mailbox-cdk-edge');
}
