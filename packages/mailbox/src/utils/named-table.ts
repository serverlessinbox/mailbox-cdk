import { ITable, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseTable } from './base-table';


export interface INamedTable extends ITable {
  readonly explicitTableName: string;
}

export class StackNamedTable extends BaseTable implements INamedTable {
  readonly explicitTableName: string;

  constructor(scope: Construct, tableName: string, props: TableProps) {
    const stack = Stack.of(scope);
    const fullTableName = `${stack.account}-${stack.stackName}-${tableName}`;
    super(scope, fullTableName, {
      ...props,
      tableName: fullTableName,
    });

    this.explicitTableName = fullTableName;
  }
}
