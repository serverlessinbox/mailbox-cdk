import type { AuditEntry } from '../audit/index';

import type { Caller }     from './caller';

/** What a service handler is called with besides the validated request. */
export interface HandlerContext {
  readonly caller:    Caller;
  readonly requestId: string;

  /**
   * Records an audit event for the request: the entry says how it ended and what it touched, and the tenant,
   * the action and the actor come from the request. Resolves once the event is recorded; rejects when it cannot
   * be, and what a failed audit means for the request is the handler's to decide.
   */
  recordAudit(entry: AuditEntry): Promise<void>;
}
