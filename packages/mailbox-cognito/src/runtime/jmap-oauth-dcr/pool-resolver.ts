import type { TenantId }   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { UserPoolId } from '../shared/cognito-identifiers';

/**
 * Resolves the Cognito user pool in which the dynamically registered clients of a tenant are created. The
 * tenant is the key a per-tenant pool mapping would use; the deployment has one pool, so every tenant resolves to it.
 */
export class PoolResolver {
  constructor(private readonly userPoolId: UserPoolId) {}

  public resolve(_tenantId: TenantId): UserPoolId {
    return this.userPoolId;
  }
}
