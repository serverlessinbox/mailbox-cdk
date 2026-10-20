import { ITable, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, IResolvable } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseTable } from './base-table';

/** A table whose explicit physical name is known at synth time, so a holder can reuse the name without a `Ref`. */
export interface INamedTable extends ITable {
  readonly explicitTableName: string;
}

/** Props for {@link StackNamedTable}: the DynamoDB table props plus an optional replacement for the stack name in the table name. */
export interface StackNamedTableProps extends TableProps {
  /** Name base used in the table name instead of the stack name; an empty string counts as absent. */
  readonly nameBase?: string | IResolvable;
}

/**
 * A {@link BaseTable} with an explicit physical name `<account>-<nameBase or stack name>-<id>`.
 *
 * Not responsible for choosing the name base; the caller passes `nameBase` or accepts the stack name.
 */
export class StackNamedTable extends BaseTable implements INamedTable {
  readonly explicitTableName: string;

  constructor(scope: Construct, tableName: string, props: StackNamedTableProps) {
    const nameBase = props.nameBase || Aws.STACK_NAME;
    const fullTableName = `${Aws.ACCOUNT_ID}-${nameBase}-${tableName}`;
    super(scope, tableName, {
      ...props,
      tableName: fullTableName,
    });

    this.explicitTableName = fullTableName;
  }
}
