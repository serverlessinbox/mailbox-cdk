import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { AuditEvent }                    from './audit-event';
import type { AuditSink }                     from './audit-sink';

/**
 * Sends each audit event as one message, in JSON, to the audit events queue the audit writer reads. JSON has no
 * bigint, so a bigint in the event is written as a string.
 */
export class SqsAuditSink implements AuditSink {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  public async record(event: AuditEvent): Promise<void> {
    const messageBody = JSON.stringify(event, (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value));

    await this.sqs.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: messageBody }));
  }
}
