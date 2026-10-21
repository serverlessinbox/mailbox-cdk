import { StackNamedTable }                from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }                  from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                      from 'constructs';

import { DataTableProps, dataTableProps } from './data-table-props';

/**
 * Change tracking and optimistic concurrency control for versioned items.
 *
 * Stores immutable changelog entries and state version counters for emails, threads, and other versioned objects. Entries expire automatically based on TTL, supporting both queryChanges requests and optimistic locking.
 *
 * **Access**
 * - Writes: JMAP API, admin API, email processor, email sender, SES event processor, identity provisioner
 * - Reads only: search indexer
 *
 * **Keys**
 *
 * | Index | Partition key | Sort key |
 * |-------|---------------|----------|
 * | table | `pk` (String) | `sk` (Number) |
 *
 * TTL attribute: `x`
 *
 * **Encryption**
 * - AWS-managed key by default; customer-managed KMS key when `encryptionKey` is provided.
 *
 * **Retention**
 * - Point-in-time recovery enabled outside development mode.
 * - Removal policy `RetainExceptOnCreate`.
 */
export class ChangelogTable extends StackNamedTable {

  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'changelog-table', {
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.NUMBER,
      },
      timeToLiveAttribute: 'x', // TTL on 'x' (expiresAt) field
      ...dataTableProps(scope, props),
    });
  }
}
