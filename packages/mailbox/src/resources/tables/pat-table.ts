import { StackNamedTable }               from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                     from 'constructs';

import type { DataTableProps }           from './data-table-props';

/**
 * Personal access token storage: a table of its own, so that only the Lambdas granted a token grant can reach
 * token rows. Its two secondary indexes project keys only.
 */
export class PatTable extends StackNamedTable {
  constructor(scope: Construct, props: DataTableProps) {
    super(scope, 'pat-table', {
      partitionKey:                     { name: 'pk', type: AttributeType.STRING },
      sortKey:                          { name: 'sk', type: AttributeType.STRING },
      nameBase:                         props.nameBase,
      encryption:                       props.encryption,
      encryptionKey:                    props.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.pointInTimeRecoveryEnabled },
      timeToLiveAttribute:              'ttl',
    });

    this.addGlobalSecondaryIndex({
      indexName:      'gsi1',
      partitionKey:   { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey:        { name: 'gsi1sk', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    this.addGlobalSecondaryIndex({
      indexName:      'gsi2',
      partitionKey:   { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey:        { name: 'gsi2sk', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });
  }
}
