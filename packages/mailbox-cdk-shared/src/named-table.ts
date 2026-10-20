import { ITable, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, IResolvable }   from 'aws-cdk-lib';
import { Construct }          from 'constructs';

import { BaseTable }          from './base-table';
import { PositionHash }       from './naming/position-hash';
import { StackIdentity }      from './naming/stack-identity';

/** A table whose explicit physical name is known at synth time, so a holder can reuse the name without a `Ref`. */
export interface INamedTable extends ITable {
  readonly explicitTableName: string;
}

/** Props for {@link StackNamedTable}: the DynamoDB table props plus an optional replacement for the stack name in the table name. */
export interface StackNamedTableProps extends TableProps {
  /** Name base used in the table name instead of the stack name; an empty string counts as absent. */
  readonly nameBase?: string | IResolvable;

  /**
   * Appends the table's position hash and the install's guid prefix to the name, so a table that
   * moves to another parent, or a second install in the account, gets a different name. Absent or
   * false keeps the name stable for tables whose name must not change.
   */
  readonly uniquePerPosition?: boolean;
}

/**
 * A {@link BaseTable} with an explicit physical name `<account>-<nameBase or stack name>-<id>`, followed
 * by `-<position hash>-<guid prefix>` when `uniquePerPosition` is set.
 *
 * Not responsible for choosing the name base; the caller passes `nameBase` or accepts the stack name.
 */
export class StackNamedTable extends BaseTable implements INamedTable {
  readonly explicitTableName: string;

  constructor(scope: Construct, tableName: string, props: StackNamedTableProps) {
    const nameBase      = props.nameBase || Aws.STACK_NAME;
    const stableName    = `${Aws.ACCOUNT_ID}-${nameBase}-${tableName}`;
    const fullTableName = props.uniquePerPosition
      ? `${stableName}-${PositionHash.ofChild(scope, tableName)}-${StackIdentity.guidPrefix}`
      : stableName;
    super(scope, tableName, {
      ...props,
      tableName: fullTableName,
    });

    this.explicitTableName = fullTableName;
  }
}
