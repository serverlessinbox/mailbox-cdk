import { StackNamedTable }                from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }                  from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                      from 'constructs';

import { DataTableProps, dataTableProps } from './data-table-props';

/**
 * Tenant and system configuration storage.
 *
 * Stores accounts, identities, domains, principals, licensing, and authentication settings. Designed for tenant-scoped queries and administrative provisioning across the system.
 *
 * **Access**
 * - Writes: admin API, bootstrap flows, email processor, SES event processor, identity provisioner, license refresh, support API, support role-assumption collector
 * - Reads only: JMAP API, API authorizer, IdP token exchange, email sender, stack-update API, search indexer, websocket handlers
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
export class ConfigTable extends StackNamedTable {

  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey:      { name: 'sk', type: AttributeType.STRING },
      ...dataTableProps(scope, props),
      // billing mode inherited from BaseTable (on-demand by default)
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