/**
 * Shared helpers for artifact updater (env parsing, artifact bucket naming, tagging).
 */

import { LambdaClient, TagResourceCommand } from '@aws-sdk/client-lambda';

/** Environment variables required for artifact updater operations. */
export interface UpdaterEnv {
  PROJECT: string;
  DIST_TAG: string;
  GRANULARITY: string;
  ARTIFACT_BUCKET_BASE: string;
  ROOT_STACK_TAG_VALUE: string;
  REGISTERED_PACKAGES: string;
}

/**
 * Read a required environment variable.
 * Throws if the variable is not set.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Parse and validate all required environment variables into a typed interface.
 * Call once at the top level; pass the result to functions that need it.
 */
export function getUpdaterEnv(): UpdaterEnv {
  return {
    PROJECT: requireEnv('PROJECT'),
    DIST_TAG: requireEnv('DIST_TAG'),
    GRANULARITY: requireEnv('GRANULARITY'),
    ARTIFACT_BUCKET_BASE: process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts',
    ROOT_STACK_TAG_VALUE: requireEnv('ROOT_STACK_TAG_VALUE'),
    REGISTERED_PACKAGES: requireEnv('REGISTERED_PACKAGES'),
  };
}

/**
 * Convert ResourceGroupsTaggingAPI Tags array to a record for easier access.
 */
export function tagMapFrom(tags: Array<{ Key?: string; Value?: string }> | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!tags) return map;
  for (const tag of tags) {
    if (tag.Key && tag.Value) {
      map[tag.Key] = tag.Value;
    }
  }
  return map;
}

/**
 * Construct the artifact bucket name from base and region.
 */
export function artifactBucketName(bucketBase: string, region: string): string {
  return `${bucketBase}-${region}`;
}

/**
 * Tag a Lambda function with a new artifact-version.
 */
export async function bumpArtifactVersionTag(
  client: LambdaClient,
  resourceArn: string,
  version: string,
): Promise<void> {
  await client.send(
    new TagResourceCommand({
      Resource: resourceArn,
      Tags: { 'serverless-inbox:artifact-version': version },
    }),
  );
}
