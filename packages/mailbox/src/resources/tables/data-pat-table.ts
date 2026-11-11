import { ITable }            from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * A handle to the personal access token table, given to the code that reads or writes token rows instead of a raw
 * CDK `ITable`. Each grant method gives one kind of caller the access it needs and no more. The interface does not
 * expose the table construct.
 */
export interface IPatTable {
  /** The table's physical name, as CloudFormation assigns it. */
  readonly tableName: string;
  /** The table's ARN. */
  readonly tableArn: string;

  /** Reads a token row by its key, and updates only its `lastUsedAt` attribute on it. */
  grantPatLookup(grantee: IGrantable): void;

  /** Reads a token row by its key for the blob download edge function: `GetItem` only, on `PAT#` keys, and only the attributes the verdict reads. */
  grantPatEdgeLookup(grantee: IGrantable): void;

  /** Reads and writes token rows, and queries the gsi1 index. */
  grantPatManage(grantee: IGrantable): void;

  /** Queries the gsi1 index, and reads (single and batch) and updates token rows. */
  grantPatRevokeForPrincipal(grantee: IGrantable): void;

  /** Queries the gsi2 index, and reads (single and batch) and updates owner rows under the tenant key prefix. */
  grantPatExpiryNotify(grantee: IGrantable): void;

  /** Reads an owner row under the tenant key prefix by its key: `GetItem` only. */
  grantPatOwnerRead(grantee: IGrantable): void;
}

/**
 * Wraps the token table imported (by ARN) from the data sub-stack. Not responsible for creating, importing or
 * populating the table. A plain class, not a construct: it adds no node of its own to the construct tree.
 */
export class DataPatTable implements IPatTable {
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(table: ITable) {
    this.tableName = table.tableName;
    this.tableArn  = table.tableArn;
  }

  public grantPatLookup(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PAT#*'] } },
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:UpdateItem'],
      resourceArns: [this.tableArn],
      conditions:   {
        'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['PAT#*'] },
        'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'lastUsedAt'] },
      },
    });
  }

  public grantPatEdgeLookup(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   {
        'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['PAT#*'] },
        'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'tenantId', 'tokenId', 'expiresAt', 'revokedAt'] },
      },
    });
  }

  public grantPatManage(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resourceArns: [this.tableArn],
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:Query'],
      resourceArns: [this.tableArn, `${this.tableArn}/index/gsi1`],
    });
  }

  public grantPatRevokeForPrincipal(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:Query'],
      resourceArns: [this.tableArn, `${this.tableArn}/index/gsi1`],
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:UpdateItem'],
      resourceArns: [this.tableArn],
    });
  }

  public grantPatExpiryNotify(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:Query'],
      resourceArns: [`${this.tableArn}/index/gsi2`],
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:UpdateItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*PAT_OWNER#*'] } },
    });
  }

  public grantPatOwnerRead(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*PAT_OWNER#*'] } },
    });
  }
}
