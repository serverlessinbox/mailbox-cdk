import type { TenantId } from './tenant-id';

/**
 * Who a request comes from, as the authorizer decided. Every request a service serves has a caller: a request
 * without a tenant or a subject is refused before any handler runs.
 */
export interface Caller {
  readonly tenantId:  TenantId;
  readonly subject:   string;
  readonly username?: string;
  readonly groups:    readonly string[];
}
