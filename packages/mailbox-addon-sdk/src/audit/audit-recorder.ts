import type { Caller }                   from '../caller/caller';

import type { AuditChange, AuditEntry }  from './audit-event';
import type { AuditSink }                from './audit-sink';

const UNKNOWN_ENTITY_ID = 'unknown';
const REDACTED_VALUE    = '[REDACTED]';
const SECRET_FIELD      = /password|secret|token|credential|api[-_]?key|private[-_]?key/i;

/**
 * Records the audit entries of one request. An entry says how the request ended and what it touched; the tenant
 * and the actor come from the caller and the source address of the request, and the entity type and action from
 * the endpoint it reached, so a handler cannot attribute a change to anyone else. The values of a secret field
 * never reach the sink: only the fact that the field changed is recorded. A sink failure rejects the call.
 */
export class AuditRecorder {
  constructor(
    private readonly auditSink: AuditSink,
    private readonly caller: Caller,
    private readonly ipAddress: string,
    private readonly entityType: string,
    private readonly action: string,
  ) {}

  public async record(entry: AuditEntry): Promise<void> {
    const entityId = entry.entityId ?? UNKNOWN_ENTITY_ID;

    await this.auditSink.record({
      tenantId:   this.caller.tenantId,
      entityType: this.entityType,
      entityId,
      entityName: entry.entityName ?? entityId,
      action:     this.action,
      status:     entry.status,
      errorMsg:   entry.errorMsg,
      actor:      { actorType: 'user', actorId: this.caller.principalId, username: this.caller.principalName, ipAddress: this.ipAddress },
      changes:    entry.changes?.map((change) => this.redacted(change)),
    });
  }

  private redacted(change: AuditChange): AuditChange {
    if (!SECRET_FIELD.test(change.field)) {
      return change;
    }
    return {
      field:    change.field,
      oldValue: change.oldValue === undefined ? undefined : REDACTED_VALUE,
      newValue: change.newValue === undefined ? undefined : REDACTED_VALUE,
    };
  }
}
