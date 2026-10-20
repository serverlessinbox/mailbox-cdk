/** One audit record for a mutating request, handed to the audit sink after the request ran. */
export type AuditEvent = {
  tenantId?: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  action: string;
  status: 'success' | 'failure';
  errorMsg?: string;
  actor?: unknown;
  changes?: unknown[];
  metadata?: Record<string, string>;
};

/**
 * The audit facts a service handler fills in while it runs: what it changed and which entity it touched.
 * The pipeline turns them into an `AuditEvent`.
 */
export type AuditContext = {
  entityType: string;
  entityId?: string;
  entityName?: string;
  changes?: unknown[];
  metadata?: Record<string, string>;
  action: string;
};
