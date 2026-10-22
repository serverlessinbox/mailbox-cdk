import { StackNamedTable }     from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }       from 'aws-cdk-lib/aws-dynamodb';
import { Construct }           from 'constructs';

import type { DataTableProps } from './data-table-props';

/**
 * Email and JMAP item storage.
 *
 * Stores emails, mailboxes, threads, addressbooks, contact cards, and object grants, for queries by account, mailbox, thread, and time range.
 */
export class ItemTable extends StackNamedTable {
  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'item-table', {
      partitionKey:                     { name: 'pk', type: AttributeType.STRING },
      sortKey:                          { name: 'sk', type: AttributeType.STRING },
      nameBase:                         props.nameBase,
      encryption:                       props.encryption,
      encryptionKey:                    props.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.pointInTimeRecoveryEnabled },
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
