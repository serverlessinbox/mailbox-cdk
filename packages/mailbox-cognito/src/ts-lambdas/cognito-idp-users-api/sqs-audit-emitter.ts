import { SendMessageCommand, type SQSClient }       from '@aws-sdk/client-sqs';
import type { LegacyAuditEvent }                    from '@serverlessinbox/mailbox-addon-sdk';
import { toTenantId, type QueueUrl, type TenantId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** The message the audit writer reads from the audit events queue: an audit event that always names its tenant and actor. */
type AuditWriterMessage = Omit<LegacyAuditEvent,'tenantId' | 'actor'> & {
  readonly tenantId: TenantId;
  readonly actor:    unknown;
};

const UNKNOWN_TENANT = toTenantId('unknown');
const SYSTEM_ACTOR   = { actorType: 'system', actorId: 'admin-api', username: 'admin-api' };

/** Sends the audit events of admin API requests to the audit events queue. */
export class SqsAuditEmitter {
  constructor(
    private readonly queueUrl: QueueUrl,
    private readonly sqs: SQSClient,
  ) {}

  /** An event without a tenant is attributed to the tenant `unknown`, and one without an actor to the system actor. */
  public async emit(event: LegacyAuditEvent): Promise<void> {
    const messageBody = this.serialize(this.toAuditWriterMessage(event));

    await this.sqs.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: messageBody }));
  }

  private toAuditWriterMessage(event: LegacyAuditEvent): AuditWriterMessage {
    return {
      tenantId:   event.tenantId === undefined ? UNKNOWN_TENANT : toTenantId(event.tenantId),
      entityType: event.entityType,
      entityId:   event.entityId,
      entityName: event.entityName,
      action:     event.action,
      status:     event.status,
      errorMsg:   event.errorMsg,
      actor:      event.actor ?? SYSTEM_ACTOR,
      changes:    event.changes,
      metadata:   event.metadata,
    };
  }

  // Omits the protobuf `$typeName` and writes a bigint as a string, because JSON.stringify throws on a bigint.
  private serialize(message: AuditWriterMessage): string {
    return JSON.stringify(message, (key: string, value: unknown): unknown => {
      if (key === '$typeName') {
        return undefined;
      }
      return typeof value === 'bigint' ? value.toString() : value;
    });
  }
}
