import { toPrincipalId, toTenantId, type Caller }  from '../../caller';
import type { AuditEvent }                         from '../audit-event';
import { AuditRecorder }                           from '../audit-recorder';
import type { AuditSink }                          from '../audit-sink';

/*
 * Pins how an entry of a handler becomes the event the audit writer stores. The tenant, the actor and the action
 * come from the request and never from the handler: taking them from anywhere else attributes a change to the
 * wrong caller. The values of a secret field are redacted before the sink sees them, because what reaches the
 * sink is stored for good.
 */

const CALLER: Caller = {
  tenantId:      toTenantId('tenant-1'),
  principalId:   toPrincipalId('principal-1'),
  principalName: 'jane',
  displayName:   'Jane Doe',
  groups:        ['admin'],
};

const SINK_CAUSE = 'queue is gone';

function sinkDouble(): jest.Mocked<AuditSink> {
  return { record: jest.fn<Promise<void>, [AuditEvent]>().mockResolvedValue(undefined) };
}

function recorderFor(sink: AuditSink): AuditRecorder {
  return new AuditRecorder(sink, CALLER, '203.0.113.7', 'idp-users', 'IdpUsersService/Do');
}

function recordedEvent(sink: jest.Mocked<AuditSink>): AuditEvent {
  expect(sink.record).toHaveBeenCalledTimes(1);
  return sink.record.mock.calls[0][0];
}

describe('AuditRecorder', () => {
  it('completes the entry into the event: the tenant, the entity type, the action and the actor come from the request', async () => {
    const sink  = sinkDouble();
    const entry = { status: 'success', entityId: 'alice', entityName: 'alice@example.com', changes: [{ field: 'email', oldValue: 'a@old', newValue: 'a@new' }] } as const;

    await recorderFor(sink).record(entry);

    expect(recordedEvent(sink)).toEqual({
      tenantId:   'tenant-1',
      entityType: 'idp-users',
      action:     'IdpUsersService/Do',
      actor:      { actorType: 'user', actorId: 'principal-1', username: 'jane', ipAddress: '203.0.113.7' },
      ...entry,
    });
  });

  it('carries the status and the message of a failure', async () => {
    const sink = sinkDouble();

    await recorderFor(sink).record({ status: 'failure', errorMsg: 'no such user' });

    expect(recordedEvent(sink)).toEqual(expect.objectContaining({ status: 'failure', errorMsg: 'no such user' }));
  });

  it('names the entity unknown when the entry has no id', async () => {
    const sink = sinkDouble();

    await recorderFor(sink).record({ status: 'success' });

    expect(recordedEvent(sink)).toEqual(expect.objectContaining({ entityId: 'unknown', entityName: 'unknown' }));
  });

  it('names the entity by its id when the entry has no name', async () => {
    const sink = sinkDouble();

    await recorderFor(sink).record({ status: 'success', entityId: 'alice' });

    expect(recordedEvent(sink)).toEqual(expect.objectContaining({ entityId: 'alice', entityName: 'alice' }));
  });

  it('redacts the values of a secret field in the changes and leaves the other fields as they are', async () => {
    const sink    = sinkDouble();
    const changes = [
      { field: 'initialPassword', newValue: 'hunter2' },
      { field: 'apiKey', oldValue: 'old-key', newValue: 'new-key' },
      { field: 'email', oldValue: 'a@old', newValue: 'a@new' },
    ];

    await recorderFor(sink).record({ status: 'success', changes });

    expect(recordedEvent(sink).changes).toEqual([
      { field: 'initialPassword', newValue: '[REDACTED]' },
      { field: 'apiKey', oldValue: '[REDACTED]', newValue: '[REDACTED]' },
      { field: 'email', oldValue: 'a@old', newValue: 'a@new' },
    ]);
  });

  it('rejects when the sink cannot record the event', async () => {
    const sink = { record: jest.fn<Promise<void>, [AuditEvent]>().mockRejectedValue(new Error(SINK_CAUSE)) };

    await expect(recorderFor(sink).record({ status: 'success' })).rejects.toThrow(SINK_CAUSE);
  });
});
