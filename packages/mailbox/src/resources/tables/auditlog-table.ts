import { StackNamedTable }     from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }       from 'aws-cdk-lib/aws-dynamodb';
import { Construct }           from 'constructs';

import type { DataTableProps } from './data-table-props';

/**
 * Audit event logging for compliance and forensics.
 *
 * Stores immutable audit log entries recording system actions, actors, and entity changes across tenants and time ranges.
 */
export class AuditLogTable extends StackNamedTable {
  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'auditlog-table', {
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
