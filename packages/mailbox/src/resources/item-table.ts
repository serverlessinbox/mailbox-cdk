import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { StackNamedTable } from "@serverlessinbox/mailbox-cdk-shared";
import { DataTableProps, dataTableProps } from './data-table-props';

/**
 * Email and JMAP item storage.
 *
 * Stores emails, mailboxes, threads, addressbooks, contact cards, and object grants. Designed for queries by account, mailbox, thread, and time range for item discovery and state lookup.
 *
 * **Access**
 * - Writes: JMAP API, admin API, email processor, email sender, SES event processor, identity provisioner
 * - Reads only: search indexer, websocket message handler
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
export class ItemTable extends StackNamedTable {

  constructor(scope: Construct, props: DataTableProps) {
    super(scope, `item-table`, {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      ...dataTableProps(scope, props),
      // billing mode inherited from BaseTable (on-demand by default)
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
    this.addGlobalSecondaryIndex({
      indexName: 'gsi3',
      partitionKey: { name: 'gsi3pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi3sk', type: AttributeType.STRING },
    });
  }
}