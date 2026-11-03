import { ITable, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import { IBucket, Bucket }               from 'aws-cdk-lib/aws-s3';
import { Construct }                     from 'constructs';

import { DataBlobStore, IDataBlobStore } from '../../resources/buckets/data-blob-store';
import { DataPatTable, IPatTable }       from '../../resources/tables/data-pat-table';
import { DataTable, IDataTable }         from '../../resources/tables/data-tables';

/**
 * Keys identifying each of the data sub-stack's DynamoDB tables. Drives the mapped type below so
 * `MailboxDataStackRefProps`'s ARN props can't drift from the keys this class imports by —
 * adding a table to this union adds its ARN prop for free.
 */
type DataTableKey = 'config' | 'item' | 'changelog' | 'auditLog' | 'mailFeedback' | 'pat';

/** ARNs for the resources owned by the data sub-stack. */
export type MailboxDataStackRefProps =
  { readonly [K in DataTableKey as `${K}TableArn`]: string }
  & { readonly blobStoreArn: string };

/**
 * Cross-stack reference to the DynamoDB tables and S3 bucket owned by the data sub-stack, resolved
 * from their ARNs (via `MailboxDataOverrideResolver`, either the sub-stack's real outputs or an
 * operator-supplied override). Internal only (not reachable from `src/index.ts`) — every table is
 * imported once as a CDK `ITable` and wrapped in `IDataTable`, except the token table, wrapped in
 * `IPatTable`; the raw `ITable` never leaves this class, and a consumer sees only `tableName`/`tableArn`
 * and the grant methods of its wrapper. The blob store's raw `IBucket` is the one deliberate exception: `blobStoreBucket` hands
 * it out unwrapped, alongside the grant-only `blobStore` handle, because two consumers genuinely
 * need the bucket object itself (see `blobStoreBucket`'s own comment).
 */
export class MailboxDataStackRef extends Construct {
  public readonly configTable: IDataTable;
  public readonly itemTable: IDataTable;
  public readonly changelogTable: IDataTable;
  public readonly auditLogTable: IDataTable;
  public readonly mailFeedbackTable: IDataTable;
  public readonly patTable: IPatTable;

  /** Grant-scoped handle to `blobStoreBucket`, for every consumer that only needs least-privilege object actions. */
  public readonly blobStore: IDataBlobStore;

  /**
   * The raw imported bucket, exposed only because two consumers write a bucket *resource policy*
   * rather than an identity grant and so cannot go through `IDataBlobStore`'s method-only surface:
   * `core/ui/cdn-construct.ts` (`S3BucketOrigin.withOriginAccessControl` needs the bucket
   * object) and `core/email/ses-rules.ts` (`aws-ses-actions.S3`'s `bucket:` prop). Do not use
   * this for a grant — use `blobStore` instead.
   */
  public readonly blobStoreBucket: IBucket;

  constructor(scope: Construct, id: string, props: MailboxDataStackRefProps) {
    super(scope, id);
    this.configTable       = new DataTable(this.importTable('config-table',       props.configTableArn));
    this.itemTable         = new DataTable(this.importTable('item-table',         props.itemTableArn));
    this.changelogTable    = new DataTable(this.importTable('changelog-table',    props.changelogTableArn));
    this.auditLogTable     = new DataTable(this.importTable('audit-log-table',    props.auditLogTableArn));
    this.mailFeedbackTable = new DataTable(this.importTable('mailfeedback-table', props.mailFeedbackTableArn));
    this.patTable          = new DataPatTable(this.importTable('pat-table',       props.patTableArn));
    this.blobStoreBucket   = Bucket.fromBucketArn(this, 'blob-store', props.blobStoreArn);
    this.blobStore         = new DataBlobStore(this.blobStoreBucket);
  }

  /**
   * Imports one table by ARN under the given construct id. The single place `Table.fromTableAttributes`
   * is called for the data sub-stack's tables; each wrapper (`DataTable`, `DataPatTable`) is applied by
   * the caller, so adding a table is one call in the constructor plus one field above.
   */
  private importTable(constructId: string, tableArn: string): ITable {
    return Table.fromTableAttributes(this, constructId, { tableArn, grantIndexPermissions: true });
  }
}
