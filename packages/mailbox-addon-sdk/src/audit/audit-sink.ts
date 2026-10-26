import type { AuditEvent } from './audit-event';

/** Where the audit events of served requests go. */
export interface AuditSink {
  /** Resolves once the event is durably recorded; rejects when it cannot be, which fails the request. */
  record(event: AuditEvent): Promise<void>;
}
