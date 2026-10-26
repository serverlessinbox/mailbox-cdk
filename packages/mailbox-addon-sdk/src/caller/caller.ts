import type { PrincipalId } from './principal-id';
import type { TenantId }    from './tenant-id';

/**
 * Who a request comes from, as the lookup authorizer resolved it. Every request a service serves has a caller:
 * a request without a tenant or a principal is refused before any handler runs. `displayName` is empty when
 * the principal has none.
 */
export interface Caller {
  readonly tenantId:      TenantId;
  readonly principalId:   PrincipalId;
  readonly principalName: string;
  readonly displayName:   string;
  readonly groups:        readonly string[];
}
