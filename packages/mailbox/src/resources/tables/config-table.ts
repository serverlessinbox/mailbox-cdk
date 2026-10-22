import { StackNamedTable }     from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }       from 'aws-cdk-lib/aws-dynamodb';
import { Construct }           from 'constructs';

import type { DataTableProps } from './data-table-props';

/**
 * Tenant and system configuration storage.
 *
 * Stores accounts, identities, domains, principals, licensing, and authentication settings, for tenant-scoped queries and administrative provisioning.
 */
export class ConfigTable extends StackNamedTable {
  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'config-table', {
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
