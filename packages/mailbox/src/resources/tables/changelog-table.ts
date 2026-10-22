import { StackNamedTable }     from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType }       from 'aws-cdk-lib/aws-dynamodb';
import { Construct }           from 'constructs';

import type { DataTableProps } from './data-table-props';

/**
 * Change tracking and optimistic concurrency control for versioned items.
 *
 * Stores immutable changelog entries and state version counters for emails, threads, and other versioned objects. Entries expire automatically based on TTL.
 */
export class ChangelogTable extends StackNamedTable {
  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'changelog-table', {
      partitionKey:                     { name: 'pk', type: AttributeType.STRING },
      sortKey:                          { name: 'sk', type: AttributeType.NUMBER },
      timeToLiveAttribute:              'x',
      nameBase:                         props.nameBase,
      encryption:                       props.encryption,
      encryptionKey:                    props.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.pointInTimeRecoveryEnabled },
    });
  }
}
