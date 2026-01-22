import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import type { AuditEvent } from '@sipkg/mailbox-admin-api';

export function createSqsAuditEmitter(queueUrl: string) {
  const sqs = new SQSClient({});

  return async (evt: AuditEvent): Promise<void> => {
    // Keep the body compatible with the existing audit-writer input (AuditLogCreate JSON).
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          tenantId: evt.tenantId ?? 'unknown',
          entityType: evt.entityType,
          entityId: evt.entityId,
          entityName: evt.entityName,
          action: evt.action,
          status: evt.status,
          errorMsg: evt.errorMsg,
          actor: evt.actor ?? { actorType: 'system', actorId: 'admin-api', username: 'admin-api' },
          changes: evt.changes,
          metadata: evt.metadata,
        }, (key, value) => {
          if (key === '$typeName') return undefined;
          return typeof value === 'bigint' ? value.toString() : value;
        }),
      })
    );
  };
}
