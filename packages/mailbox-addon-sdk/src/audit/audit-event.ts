import type { PrincipalId } from '../caller/principal-id';
import type { TenantId }    from '../caller/tenant-id';

/** How an audited request ended. */
export type AuditStatus = 'success' | 'failure';

/** One field a request changed. A value is left out when the field did not exist before or does not exist after. */
export interface AuditChange {
  readonly field:     string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/** The caller of an audited request, as the audit writer records its actor. */
export interface AuditActor {
  readonly actorType: 'user';
  readonly actorId:   PrincipalId;
  readonly username:  string;
  readonly ipAddress: string;
}

/**
 * What a service handler tells the audit about the request it served: how it ended, which entity it touched
 * and what it changed. An entity without an id is recorded as `unknown`, and one without a name is named by
 * its id. Everything else on the audit event comes from the request, so a handler cannot write it.
 */
export interface AuditEntry {
  readonly status:      AuditStatus;
  readonly entityId?:   string;
  readonly entityName?: string;
  readonly changes?:    readonly AuditChange[];
  readonly errorMsg?:   string;
}

/**
 * The record of one request a handler audited, handed to the {@link AuditSink}. `entityType` is the service's
 * base path and `action` is `<service>/<method>`.
 */
export interface AuditEvent {
  readonly tenantId:   TenantId;
  readonly entityType: string;
  readonly entityId:   string;
  readonly entityName: string;
  readonly action:     string;
  readonly status:     AuditStatus;
  readonly errorMsg?:  string;
  readonly actor:      AuditActor;
  readonly changes?:   readonly AuditChange[];
}
