import { Construct } from 'constructs';
import { ITable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket, Bucket } from 'aws-cdk-lib/aws-s3';

export interface MailboxDataStackRefProps {
  readonly configTableArn: string;
  readonly itemTableArn: string;
  readonly changelogTableArn: string;
  readonly auditLogTableArn: string;
  readonly mailFeedbackTableArn: string;
  readonly blobStoreArn: string;
}

export class MailboxDataStackRef extends Construct {
  public readonly configTable: ITable;
  public readonly itemTable: ITable;
  public readonly changelogTable: ITable;
  public readonly auditLogTable: ITable;
  public readonly mailFeedbackTable: ITable;
  public readonly blobStore: IBucket;

  constructor(scope: Construct, id: string, props: MailboxDataStackRefProps) {
    super(scope, id);
    this.configTable       = Table.fromTableAttributes(this, 'config-table',       { tableArn: props.configTableArn,       grantIndexPermissions: true });
    this.itemTable         = Table.fromTableAttributes(this, 'item-table',         { tableArn: props.itemTableArn,         grantIndexPermissions: true });
    this.changelogTable    = Table.fromTableAttributes(this, 'changelog-table',    { tableArn: props.changelogTableArn,    grantIndexPermissions: true });
    this.auditLogTable     = Table.fromTableAttributes(this, 'audit-log-table',    { tableArn: props.auditLogTableArn,     grantIndexPermissions: true });
    this.mailFeedbackTable = Table.fromTableAttributes(this, 'mailfeedback-table', { tableArn: props.mailFeedbackTableArn, grantIndexPermissions: true });
    this.blobStore         = Bucket.fromBucketArn(this, 'blob-store', props.blobStoreArn);
  }
}
