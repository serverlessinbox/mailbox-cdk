/**
 * Minimal CloudFormation custom resource handler for TrackResolver (plan-a, stack-self-update).
 *
 * Reads one track-scoped pointer file from S3 and returns its version.
 * CDK constructs the artifact keys using the returned version token.
 *
 * Create and Update: resolve pointer → return version.
 * Delete: no-op SUCCESS.
 *
 * CloudFormation custom-resource response wrapper using global `fetch`.
 * Build: esbuild bundles to `src/track-resolver/generated/track-resolver-handler-source.ts` (minified string).
 *
 * Relocated from `@serverlessinbox/artifact-registry` (stack-self-update, phase A cleanup): that
 * package must stay pure (no CDK/CFN knowledge). Only the pure schema helpers below
 * (`buildReleasePointerKey`, `DEFAULT_PROJECT`, `LatestStablePointer`) still come from
 * artifact-registry -- imported from the PUBLISHED package, since this handler is bundled from
 * mailbox-cdk-shared's own local source, not artifact-registry's.
 *
 * IMPORTANT: imported via the DEEP submodule paths (`dist/utils/...`), never the top-level
 * `@serverlessinbox/artifact-registry` barrel. The published barrel is a single CommonJS module
 * that `require()`s every submodule (S3ArtifactPlugin, the CLI, etc.) up front -- CJS re-exports
 * can't be tree-shaken, so importing from the barrel pulls the ENTIRE package into this bundle
 * (verified: ~97KB, blowing the 4096-byte `Code.fromInline` gate). The deep paths pull in only
 * the small pure module actually needed, matching the original handler's behavior of importing
 * from a narrow relative path (`../utils/artifact-key`) rather than a barrel.
 */

import { DEFAULT_PROJECT } from '@serverlessinbox/artifact-registry/dist/utils/artifact-key';
import { readReleasePointer } from '@serverlessinbox/artifact-registry/dist/utils/read-release-pointer';
import { TRACK_RESOLVER_VERSION_ATTR } from './attr';

/** Static PhysicalResourceId: guarantees every Update is in-place, never a replacement. */
const PHYSICAL_RESOURCE_ID = 'TrackResolver';


const BUCKET_BASE = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';
const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const PROJECT = process.env.PROJECT ?? DEFAULT_PROJECT;

interface HandlerResponse {
  PhysicalResourceId: string;
  Data?: Record<string, string>;
}

/**
 * Resolve the one package: read its track-scoped pointer and extract version.
 * Delete is a zero-AWS-call no-op. Create/Update both resolve the pointer.
 */
export async function handleRequest(event: any): Promise<HandlerResponse> {
  const rt = event.RequestType;
  const { Package, DistTag, Region } = event.ResourceProperties;

  if (rt === 'Delete') {
    return { PhysicalResourceId: PHYSICAL_RESOURCE_ID };
  }

  const region = Region ?? REGION;

  try {
    // Use readReleasePointer to fetch the track-scoped pointer.
    const pointer = await readReleasePointer(Package, DistTag, region, {
      bucketBase: BUCKET_BASE,
      project: PROJECT,
    });

    if (!pointer || !pointer.version) {
      throw new Error(`TrackResolver: pointer missing or has no version for ${Package} (distTag=${DistTag})`);
    }

    console.log('resolved', { Package, DistTag, version: pointer.version });
    return {
      PhysicalResourceId: PHYSICAL_RESOURCE_ID,
      Data: { [TRACK_RESOLVER_VERSION_ATTR]: pointer.version },
    };
  } catch (err: any) {
    // Operational failure: re-throw so handler sends CFN FAILED.
    console.error('S3 error resolving package', { Package, DistTag, error: err.message });
    throw err;
  }
}

/**
 * CloudFormation custom-resource response wrapper.
 * Calls handleRequest, captures the result, and sends an HTTPS response to the presigned S3 URL.
 * On error, sends a FAILED response with the error message and a CloudWatch hint.
 */
export async function handler(event: any, context: any): Promise<void> {
  let result: HandlerResponse | undefined;
  let error: any;

  try {
    result = await handleRequest(event);
  } catch (err: any) {
    error = err;
  }

  const responseData: Record<string, any> = {
    Status: error ? 'FAILED' : 'SUCCESS',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  };

  if (error) {
    const reason = error && error.message ? String(error.message) : String(error);
    const logStream = (context && context.logStreamName) || event.RequestId;
    responseData.Reason = `${reason}. See CloudWatch log stream: ${logStream}`;
    responseData.PhysicalResourceId = event.PhysicalResourceId || PHYSICAL_RESOURCE_ID;
  } else {
    responseData.PhysicalResourceId = result!.PhysicalResourceId;
    if (result!.Data) {
      responseData.Data = result!.Data;
    }
  }

  const body = JSON.stringify(responseData);

  try {
    await fetch(event.ResponseURL, { method: 'PUT', body });
  } catch (err: any) {
    console.error('fetch response PUT failed', err);
  }
}
