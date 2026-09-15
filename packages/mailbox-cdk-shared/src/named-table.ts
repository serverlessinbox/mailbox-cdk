import { ITable, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, IResolvable } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseTable } from './base-table';

export interface INamedTable extends ITable {
  readonly explicitTableName: string;
}

export interface StackNamedTableProps extends TableProps {
  /** Optional name base for table naming (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;
}

export class StackNamedTable extends BaseTable implements INamedTable {
  readonly explicitTableName: string;

  constructor(scope: Construct, tableName: string, props: StackNamedTableProps) {
    // Use provided nameBase, or fall back to Aws.STACK_NAME
    const nameBase = (props?.nameBase && props.nameBase !== '') ? props.nameBase : Aws.STACK_NAME;
    const fullTableName = `${Aws.ACCOUNT_ID}-${nameBase}-${tableName}`;
    super(scope, tableName, {
      ...props,
      tableName: fullTableName,
    });

    this.explicitTableName = fullTableName;
  }
}
