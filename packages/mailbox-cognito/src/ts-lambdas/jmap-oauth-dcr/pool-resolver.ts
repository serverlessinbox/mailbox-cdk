import { config } from './config';

/**
 * Resolves the Cognito user pool a dynamically-registered client is created against.
 *
 * White-label hedge (binding decision #12): the pool is resolved through this seam rather than
 * read inline from the environment everywhere it's needed, so a future per-tenant pool mapping
 * only changes this one function. Today's deployment has exactly one pool, injected by the CDK
 * construct (`JmapOAuthDcrLambda`) as `USER_POOL_ID` (validated once at cold start by
 * `config.ts`) — `tenantId` is accepted but not yet used.
 */
export function resolvePoolId(_tenantId: string): string {
  return config.userPoolId;
}
