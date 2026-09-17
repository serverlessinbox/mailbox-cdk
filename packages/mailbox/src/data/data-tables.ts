import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { DynamoDbActions, grantTableActions } from '@serverlessinbox/mailbox-cdk-shared';

/**
 * A handle to one of the data sub-stack's DynamoDB tables (config, item, changelog, audit log, or
 * mail feedback), given to code outside that sub-stack instead of a raw CDK `ITable`. Use it to
 * read the table's identity and to grant a Lambda or role access — never to reach the underlying
 * table for anything else, since none is exposed.
 *
 * The implementation wraps a table owned and created by the data sub-stack; this interface never
 * creates, imports, or configures a table itself. One shape covers all five tables — nothing here
 * distinguishes which table a given `IDataTable` points at, so a construct's props still name the
 * table they expect (`configTable: IDataTable`, `itemTable: IDataTable`, …) for readability, but
 * the type system does not reject a mismatched argument at the call site.
 */
export interface IDataTable {
  /** The table's physical name, as CloudFormation assigns it. */
  readonly tableName: string;
  /** The table's ARN, e.g. for use in a hand-written IAM policy statement that needs it directly. */
  readonly tableArn: string;

  /**
   * Grants `grantee` read-only access to the table and its indexes: `dynamodb:GetItem`,
   * `dynamodb:BatchGetItem`, and `dynamodb:Query`. Does not include `Scan` or PartiQL
   * (`ExecuteStatement`) — nothing in this codebase needs either, so neither is granted.
   */
  grantRead(grantee: IGrantable): void;

  /**
   * Grants `grantee` the {@link grantRead} actions plus write access: `dynamodb:PutItem`,
   * `dynamodb:UpdateItem`, and `dynamodb:DeleteItem`. Use this only when the grantee genuinely
   * mutates the table — prefer {@link grantRead} for anything that only reads.
   */
  grantReadWrite(grantee: IGrantable): void;
}

/**
 * Wraps a table imported (by ARN) from the data sub-stack. Not responsible for creating, importing
 * or populating the table — `MailboxDataStackRef` owns the cross-stack import; this class only
 * narrows what a consumer can do with the resulting reference. A plain class, not a construct: it
 * adds no node of its own to the construct tree and synthesizes nothing — the import itself is
 * already a node, owned by `MailboxDataStackRef`.
 */
export class DataTable implements IDataTable {
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(private readonly table: ITable) {
    this.tableName = table.tableName;
    this.tableArn = table.tableArn;
  }

  public grantRead(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.read);
  }

  public grantReadWrite(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.readWrite);
  }
}
