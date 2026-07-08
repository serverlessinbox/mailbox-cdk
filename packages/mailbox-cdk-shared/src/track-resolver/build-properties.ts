/**
 * CDK-wiring helper for the TrackResolver custom resource (plan-a, stack-self-update).
 *
 * Pure data -- zero `aws-cdk-lib`/construct imports. `TrackResolverProvider` calls this to build
 * the exact `ResourceProperties` object a `CfnCustomResource` should pass to the handler in
 * `handler.ts`; the handler and this function are the only two places that need to agree on the
 * property shape (`{ Package, DistTag, Region }`).
 *
 * `project` is NOT part of this shape: it is base config, constant for every lookup in a stack, so
 * it is set once as the resolver Lambda's `PROJECT` env var (read directly by the handler) rather
 * than passed per-`CfnCustomResource`.
 *
 * Relocated from `@serverlessinbox/artifact-registry` (stack-self-update, phase A cleanup): that
 * package must stay pure (no CDK/CFN knowledge). `deriveTrack` (pure version→track math) stays
 * there; this CFN-specific builder moved here. `DEFAULT_DIST_TAG` is not re-exported from
 * artifact-registry's top-level barrel (only from its `utils/artifact-key` submodule), so it's
 * imported via that deep path below.
 */

import { DEFAULT_DIST_TAG } from '@serverlessinbox/artifact-registry/dist/utils/artifact-key';

export interface TrackResolverPropertiesInput {
  /** Single package name to resolve, e.g. `mailbox-go`. Required -- one resolver per package. */
  package: string;
  /** Defaults to `stable`. */
  distTag?: string;
  /** AWS region of the artifact bucket for this package — `us-east-1` for edge-zone artifacts, the deployment region otherwise. Required. */
  region: string;
}

/**
 * Build the `CfnCustomResource` ResourceProperties object the TrackResolver handler expects.
 * Does not include `Project` -- that is base config, supplied to the handler via the `PROJECT` env var instead.
 */
export function buildTrackResolverProperties(
  input: TrackResolverPropertiesInput,
): Record<string, string> {
  return {
    Package: input.package,
    DistTag: input.distTag ?? DEFAULT_DIST_TAG,
    Region: input.region,
  };
}
