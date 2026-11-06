import { ITable }                from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }     from 'aws-cdk-lib/aws-iam';

import { DataTable, IDataTable } from './data-tables';

/**
 * The config table's handle: the shared {@link IDataTable} grants plus the grants only the config table needs.
 */
export interface IConfigTable extends IDataTable {
  /**
   * Grants `grantee` `dynamodb:UpdateItem` on account items only, to set or clear the `activeSieveScriptId` pointer.
   * The item key must match the account key shape; the only attributes that may be written are the key attributes
   * and the pointer; `ReturnValues` must be `NONE`. No read, put or delete is granted here.
   */
  grantActiveSieveScriptUpdate(grantee: IGrantable): void;
}

/**
 * Wraps the config table imported (by ARN) from the data sub-stack. Adds the config-only grant to the shared
 * {@link DataTable} grants. A plain class, not a construct: it adds no node of its own to the construct tree.
 */
export class DataConfigTable extends DataTable implements IConfigTable {
  constructor(table: ITable) {
    super(table);
  }

  public grantActiveSieveScriptUpdate(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:UpdateItem'],
      resourceArns: [this.tableArn],
      conditions:   {
        'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['TENANT#*#ACCOUNT#*'] },
        'ForAllValues:StringEquals': {
          'dynamodb:Attributes':   ['pk', 'sk', 'activeSieveScriptId'],
          'dynamodb:ReturnValues': ['NONE'],
        },
      },
    });
  }
}
