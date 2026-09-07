/**
 * Shared helpers for artifact updater (env parsing, artifact bucket naming, tagging).
 */

import { LambdaClient, TagResourceCommand, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Environment variables required for artifact updater operations. */
export interface UpdaterEnv {
  readonly project: string;
  readonly distTag: string;
  readonly granularity: string;
  readonly artifactBucketBase: string;
  readonly rootStackTagValue: string;
}

/** Configuration for artifact staleness checking and resolution. Subset of UpdaterEnv. */
export type UpdaterTargetConfig = Pick<
  UpdaterEnv,
  'project' | 'distTag' | 'granularity' | 'artifactBucketBase'
>;

/**
 * Parse and validate all required environment variables into a typed interface.
 * Call once at the top level; pass the result to functions that need it.
 */
export function getUpdaterEnv(): UpdaterEnv {
  return {
    project: env.mustGet('PROJECT'),
    distTag: env.mustGet('DIST_TAG'),
    granularity: env.mustGet('GRANULARITY'),
    artifactBucketBase: env.mustGet('ARTIFACT_BUCKET_BASE'),
    rootStackTagValue: env.mustGet('ROOT_STACK_TAG_VALUE'),
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

/**
 * Poll for Lambda function code update to settle (reach 'Successful' or 'Failed' state).
 * Throws if the update fails or times out.
 * Returns when the update completes successfully.
 *
 * @param client - Lambda client for sending GetFunctionConfiguration
 * @param functionArn - ARN of the function to poll
 * @param sleep - Optional sleep function (defaults to real setTimeout). For testing, pass a function that doesn't sleep.
 */
export async function waitForFunctionCodeUpdateSettled(
  client: LambdaClient,
  functionArn: string,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  const maxPollAttempts = 30; // 60s total at 2s intervals
  const pollIntervalMs = 2000;
  const sleepFn = sleep ?? ((ms: number) => new Promise((resolve) => (globalThis as any).setTimeout(resolve, ms)));
  let updateSettled = false;

  for (let pollAttempt = 0; pollAttempt < maxPollAttempts; pollAttempt++) {
    const cfgResp = await client.send(
      new GetFunctionConfigurationCommand({
        FunctionName: functionArn,
      }),
    );

    const status = cfgResp.LastUpdateStatus;
    if (status === 'Successful') {
      updateSettled = true;
      break;
    }
    if (status === 'Failed') {
      const reason = cfgResp.LastUpdateStatusReason || 'unknown reason';
      throw new Error(
        `Function code update failed for ${functionArn}: ${reason}`,
      );
    }

    if (pollAttempt < maxPollAttempts - 1) {
      await sleepFn(pollIntervalMs);
    }
  }

  if (!updateSettled) {
    throw new Error(
      `Timed out waiting for function code update to settle for ${functionArn}`,
    );
  }
}
