/// <reference types="jest" />

/**
 * Pins the message the emitter puts on the audit events queue. The audit writer reads that message to record
 * who did what: an event written without its tenant or actor, with a field the writer does not expect, or one
 * that cannot be serialized, is lost from the audit trail.
 */

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { LegacyAuditEvent }         from '@serverlessinbox/mailbox-addon-sdk';
import { toQueueUrl }                    from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                    from 'aws-sdk-client-mock';

import { SqsAuditEmitter }               from '../sqs-audit-emitter';

const QUEUE_URL = toQueueUrl('https://sqs.us-east-1.amazonaws.com/123456789012/audit-events');

const EVENT: LegacyAuditEvent = {
  tenantId:   'tenant-1',
  entityType: 'idp-users',
  entityId:   'alice',
  entityName: 'alice@example.com',
  action:     'IdpUsersService/CreateIdpUser',
  status:     'success',
  actor:      { actorType: 'user', actorId: 'sub-1', username: 'admin' },
  changes:    [{ op: 'create', path: '/user' }],
  metadata:   { requestId: 'req-1' },
};

describe('SqsAuditEmitter', () => {
  const sqsMock = mockClient(SQSClient);
  const emitter = new SqsAuditEmitter(QUEUE_URL, new SQSClient({}));

  function sentMessage(): { QueueUrl?: string; body: unknown } {
    const input = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
    return { QueueUrl: input.QueueUrl, body: JSON.parse(input.MessageBody ?? '') };
  }

  beforeEach(() => {
    sqsMock.reset();
    sqsMock.on(SendMessageCommand).resolves({});
  });

  it('sends the event to the audit events queue with every field the audit writer reads', async () => {
    await emitter.emit(EVENT);

    expect(sentMessage()).toEqual({ QueueUrl: QUEUE_URL, body: EVENT });
  });

  it('attributes an event without a tenant to the tenant unknown, and one without an actor to the system actor', async () => {
    await emitter.emit({ ...EVENT, tenantId: undefined, actor: undefined });

    expect(sentMessage().body).toMatchObject({
      tenantId: 'unknown',
      actor:    { actorType: 'system', actorId: 'admin-api', username: 'admin-api' },
    });
  });

  it('leaves out the protobuf $typeName and writes a bigint as a string', async () => {
    await emitter.emit({ ...EVENT, changes: [{ $typeName: 'idp_users.v1.IdpUser', size: 10n }] });

    expect(sentMessage().body).toMatchObject({ changes: [{ size: '10' }] });
    expect(JSON.stringify(sentMessage().body)).not.toContain('$typeName');
  });
});
