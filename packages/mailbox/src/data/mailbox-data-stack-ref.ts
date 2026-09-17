import { Construct } from 'constructs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket, Bucket } from 'aws-cdk-lib/aws-s3';
import { DataTable, IDataTable } from './data-tables';

/**
 * Keys identifying each of the data sub-stack's DynamoDB tables. Drives the mapped type below so
 * `MailboxDataStackRefProps`'s five ARN props can't drift from the keys this class imports by —
 * adding a table to this union adds its ARN prop for free.
 */
type DataTableKey = 'config' | 'item' | 'changelog' | 'auditLog' | 'mailFeedback';

/** ARNs for the six resources owned by the data sub-stack. */
export type MailboxDataStackRefProps =
  { readonly [K in DataTableKey as `${K}TableArn`]: string }
  & { readonly blobStoreArn: string };

/**
 * Cross-stack reference to the DynamoDB tables and S3 bucket owned by the data sub-stack, resolved
 * from their ARNs (via `MailboxDataOverrideResolver`, either the sub-stack's real outputs or an
 * operator-supplied override). Internal only (not reachable from `src/index.ts`) — every table is
 * imported once as a CDK `ITable` and wrapped in `IDataTable`; the raw `ITable` never leaves this
 * class. A consumer sees only `tableName`/`tableArn` and the `grantRead`/`grantReadWrite` methods.
 */
export class MailboxDataStackRef extends Construct {
  public readonly configTable: IDataTable;
  public readonly itemTable: IDataTable;
  public readonly changelogTable: IDataTable;
  public readonly auditLogTable: IDataTable;
  public readonly mailFeedbackTable: IDataTable;
  public readonly blobStore: IBucket;

  constructor(scope: Construct, id: string, props: MailboxDataStackRefProps) {
    super(scope, id);
    this.configTable       = this.importTable('config-table',       props.configTableArn);
    this.itemTable         = this.importTable('item-table',         props.itemTableArn);
    this.changelogTable    = this.importTable('changelog-table',    props.changelogTableArn);
    this.auditLogTable     = this.importTable('audit-log-table',    props.auditLogTableArn);
    this.mailFeedbackTable = this.importTable('mailfeedback-table', props.mailFeedbackTableArn);
    this.blobStore         = Bucket.fromBucketArn(this, 'blob-store', props.blobStoreArn);
  }

  /**
   * Imports one table by ARN under the given construct id and wraps it as a `DataTable`. The single
   * place `Table.fromTableAttributes` is called for the data sub-stack's tables, so adding a sixth
   * table is one call here plus one field above — never a repeated import+wrap block.
   */
  private importTable(constructId: string, tableArn: string): IDataTable {
    return new DataTable(Table.fromTableAttributes(this, constructId, { tableArn, grantIndexPermissions: true }));
  }
}
