/// <reference types="jest" />

/**
 * AuditWriterLambda: the audit log table name it hands the Go handler, the grants it requests for
 * itself on the table and the queue, and the queue event it registers for itself. The statement
 * each grant renders and the mapping the event renders are pinned by the table, the queue and the
 * event, not here.
 */

import { Template }                                         from 'aws-cdk-lib/assertions';

import { AuditEventsQueueEvent }                            from '../../events/audit-events-queue-event';
import { AuditWriterLambda }                                from '../audit-writer-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakeQueue }    from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                from './lambda-wrapper-helpers';

jest.mock('../../events/audit-events-queue-event');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const auditLogTable               = fakeDataTable('audit-log-table');
  const auditEventsQueue            = fakeQueue('audit-events');
  const lambda                      = new AuditWriterLambda(stack, 'audit-writer', { auditLogTable, auditEventsQueue, artifactResolver });

  return { lambda, auditLogTable, auditEventsQueue, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('AuditWriterLambda', () => {
  beforeEach(() => {
    jest.mocked(AuditEventsQueueEvent).mockClear();
  });

  it('passes the audit log table name to the handler', () => {
    expect(synthesize().environment).toMatchObject({ AUDIT_LOG_TABLE_NAME: 'audit-log-table' });
  });

  it('requests read-write on the audit log table for itself', () => {
    const { lambda, auditLogTable } = synthesize();

    expectGrantedOnceTo(auditLogTable.grantReadWrite, lambda);
  });

  it('requests consume on the audit-events queue for itself', () => {
    const { lambda, auditEventsQueue } = synthesize();

    expectGrantedOnceTo(auditEventsQueue.grantConsume, lambda);
  });

  it('registers one queue event that delivers the audit-events queue to itself', () => {
    const { lambda, auditEventsQueue } = synthesize();

    expect(AuditEventsQueueEvent).toHaveBeenCalledTimes(1);
    expect(AuditEventsQueueEvent).toHaveBeenCalledWith(lambda, 'audit-events-queue', { target: lambda, queue: auditEventsQueue });
  });
});
