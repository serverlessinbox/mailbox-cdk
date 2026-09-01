/**
 * Cold-start environment validation for `jmap-oauth-dcr`.
 *
 * Every env var this Lambda needs is read and validated exactly once, at module load (cold
 * start) — before the container serves its first request. Both mandatory CDK-supplied vars have
 * no safe fallback, so a missing *or empty* value throws here rather than being read lazily deep
 * in the request path.
 *
 * This matters beyond tidiness: the per-tenant DCR registration cap counter is incremented on
 * every dedup-miss request and is never decremented (binding decision #5,
 * `.claude/workitems/plans/jmap-oauth-dcr-poc/registration-plan.md`). Previously `USER_POOL_ID`
 * was read (and could throw) *after* that increment, so a misconfigured deployment burned a
 * tenant's 20-per-24h slot on every request and stayed broken for the rest of the period even
 * after the config was fixed. Failing at cold start instead fails the container immediately,
 * before any request — including its cap-counter side effect — is ever processed.
 */

import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

export interface JmapOAuthDcrConfig {
  readonly identityProvisionerFunctionName: string;
  readonly userPoolId: string;
}

export const config: JmapOAuthDcrConfig = {
  identityProvisionerFunctionName: env.mustGet('IDENTITY_PROVISIONER_FUNCTION_NAME'),
  userPoolId: env.mustGet('USER_POOL_ID'),
};
