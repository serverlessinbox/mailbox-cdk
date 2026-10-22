import { StackNamedTable }                from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }                  from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                      from 'constructs';

import { DataTableProps, dataTableProps } from './data-table-props';

/**
 * Audit event logging for compliance and forensics.
 *
 * Stores immutable audit log entries recording system actions, actors, and entity changes. Supports compliance queries, forensic investigation, and audit trail analysis across tenants and time ranges.
 *
 * **Access**
 * - Writes: audit writer Lambda
 * - Reads only: admin API
 *
 * **Keys**
 *
 * | Index | Partition key | Sort key |
 * |-------|---------------|----------|
 * | table | `pk` (String) | `sk` (String) |
 * | `gsi1` | `gsi1pk` (String) | `gsi1sk` (String) |
 * | `gsi2` | `gsi2pk` (String) | `gsi2sk` (String) |
 * | `gsi3` | `gsi3pk` (String) | `gsi3sk` (String) |
 *
 * **Encryption**
 * - AWS-managed key by default; customer-managed KMS key when `encryptionKey` is provided.
 *
 * **Retention**
 * - Point-in-time recovery enabled outside development mode.
 * - Removal policy `RetainExceptOnCreate`.
 */
export class AuditLogTable extends StackNamedTable {

  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'auditlog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey:      { name: 'sk', type: AttributeType.STRING },
      ...dataTableProps(scope, props),
    });

    this.addGlobalSecondaryIndex({
      indexName:    'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey:      { name: 'gsi1sk', type: AttributeType.STRING },
    });

    this.addGlobalSecondaryIndex({
      indexName:    'gsi2',
      partitionKey: { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey:      { name: 'gsi2sk', type: AttributeType.STRING },
    });

    this.addGlobalSecondaryIndex({
      indexName:    'gsi3',
      partitionKey: { name: 'gsi3pk', type: AttributeType.STRING },
      sortKey:      { name: 'gsi3sk', type: AttributeType.STRING },
    });
  }
}
