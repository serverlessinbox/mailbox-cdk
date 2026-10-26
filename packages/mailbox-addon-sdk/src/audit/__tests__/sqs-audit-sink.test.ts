import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient }                    from 'aws-sdk-client-mock';

import { toPrincipalId, toTenantId }     from '../../caller';
import type { AuditEvent }               from '../audit-event';
import { SqsAuditSink }                  from '../sqs-audit-sink';

/*
 * Pins the message the sink puts on the audit events queue: one message per event, whose body is the event as
 * JSON, sent to the queue the entry point names. The audit writer reads that body; a message that is split,
 * sent to another queue or not valid JSON is lost from the audit trail, and a bigint in a change must be written
 * as a string because JSON.stringify throws on it.
 */

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-events';

const EVENT: AuditEvent = {
  tenantId:   toTenantId('tenant-1'),
  entityType: 'idp-users',
  entityId:   'alice',
  entityName: 'alice@example.com',
  action:     'IdpUsersService/CreateIdpUser',
  status:     'success',
  actor:      { actorType: 'user', actorId: toPrincipalId('principal-1'), username: 'jane', ipAddress: '203.0.113.7' },
  changes:    [{ field: 'email', newValue: 'alice@example.com' }],
};

describe('SqsAuditSink', () => {
  const sqsMock = mockClient(SQSClient);
  const sink    = new SqsAuditSink(new SQSClient({ region: 'us-east-1' }), QUEUE_URL);

  function sentMessage(): { QueueUrl?: string; body: unknown } {
    const input = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
    return { QueueUrl: input.QueueUrl, body: JSON.parse(input.MessageBody ?? '') };
  }

  beforeEach(() => {
    sqsMock.reset();
    sqsMock.on(SendMessageCommand).resolves({});
  });

  it('sends one message with the event as its JSON body to the queue it was given', async () => {
    await sink.record(EVENT);

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(sentMessage()).toEqual({ QueueUrl: QUEUE_URL, body: EVENT });
  });

  it('writes a bigint in the changes as a string', async () => {
    await sink.record({ ...EVENT, changes: [{ field: 'quota', oldValue: 10n, newValue: 9007199254740993n }] });

    expect(sentMessage().body).toEqual(expect.objectContaining({ changes: [{ field: 'quota', oldValue: '10', newValue: '9007199254740993' }] }));
  });
});
