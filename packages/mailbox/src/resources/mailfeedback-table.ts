import { StackNamedTable }                from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }                  from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                      from 'constructs';

import { DataTableProps, dataTableProps } from './data-table-props';

/**
 * Email delivery feedback and status tracking.
 *
 * Stores SES delivery notifications including bounces, complaints, and delivery receipts for outbound mail. Supports queries by sending identity, recipient, and time range for delivery analytics and bounce handling.
 *
 * **Access**
 * - Writes: SES event processor
 * - Reads only: admin API
 *
 * **Keys**
 *
 * | Index | Partition key | Sort key |
 * |-------|---------------|----------|
 * | table | `pk` (String) | `sk` (String) |
 * | `gsi1` | `gsi1pk` (String) | `gsi1sk` (String) |
 * | `gsi2` | `gsi2pk` (String) | `gsi2sk` (String) |
 *
 * **Encryption**
 * - AWS-managed key by default; customer-managed KMS key when `encryptionKey` is provided.
 *
 * **Retention**
 * - Point-in-time recovery enabled outside development mode.
 * - Removal policy `RetainExceptOnCreate`.
 */
export class MailFeedbackTable extends StackNamedTable {

  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'mailfeedback-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      ...dataTableProps(scope, props),
    });

    this.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
    });

    this.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: AttributeType.STRING },
    });
  }
}
