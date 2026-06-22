import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { StackNamedTable } from "../utils/named-table";
import type { TableProps } from 'aws-cdk-lib/aws-dynamodb';

export class ItemTable extends StackNamedTable {

  constructor(scope: Construct, props: Partial<TableProps> = {}) {
    super(scope, `item-table`, {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      // billing mode inherited from BaseTable (on-demand by default)
      ...props,
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