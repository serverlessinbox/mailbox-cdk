import { StackNamedTable }                             from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType, BillingMode, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }                           from 'aws-cdk-lib/aws-iam';
import type * as kms                                   from 'aws-cdk-lib/aws-kms';
import { RemovalPolicy }                               from 'aws-cdk-lib';
import { Construct }                                   from 'constructs';

/**
 * Grants on the auth key store. Each grant method names one item type (`pk`) and the access one kind of
 * caller needs on it. The interface does not expose the table construct.
 */
export interface IAuthKeyStoreTable {
  readonly tableName: string;
  readonly tableArn:  string;

  /** Read the JWKS of each issuer. */
  grantReadJwks(grantee: IGrantable): void;

  /** Read the blob-URL signing key. */
  grantReadHmac(grantee: IGrantable): void;

  /** Read and write the blob-URL signing key. */
  grantManageHmac(grantee: IGrantable): void;

  /** Read and write the JWKS of each issuer. */
  grantManageJwks(grantee: IGrantable): void;

  /** Read and write the connection key pair items. */
  grantManageConnectionKeys(grantee: IGrantable): void;

  /** Read the active connection public key. */
  grantReadConnectionPublicKey(grantee: IGrantable): void;

  /** Read one connection private key by its key id. */
  grantReadConnectionPrivateKey(grantee: IGrantable): void;
}

/**
 * DynamoDB table holding the blob-URL signing key, the per-issuer JWKS and the connection key pair. Each
 * item type is in `pk` (`hmac`, `jwks`, `connection-key-public`, `connection-key-private`), so every grant
 * is limited to one value of `dynamodb:LeadingKeys`.
 *
 * Pay-per-request billing, removed along with the stack. Physical table name is stack-derived and unique
 * per position and install (`StackNamedTable`). The table is encrypted with the customer key when the
 * caller passes one, and that key's statements are added to each grant method.
 *
 * Not responsible for populating or refreshing its own contents.
 */
export class AuthKeyStoreTable extends StackNamedTable implements IAuthKeyStoreTable {
  constructor(scope: Construct, id: string, encryptionKey?: kms.IKey) {
    super(scope, id, {
      uniquePerPosition: true,
      removalPolicy:     RemovalPolicy.DESTROY,
      partitionKey:      {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey:           {
        name: 'sk',
        type: AttributeType.STRING,
      },
      billingMode:       BillingMode.PAY_PER_REQUEST,
      ...(encryptionKey && { encryption: TableEncryption.CUSTOMER_MANAGED, encryptionKey }),
    });
  }

  public grantReadJwks(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['jwks'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantReadHmac(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['hmac'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantManageHmac(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:PutItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['hmac'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantManageJwks(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:PutItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['jwks'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantManageConnectionKeys(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:PutItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-public'] } },
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-private'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantReadConnectionPublicKey(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-public'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantReadConnectionPrivateKey(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
      conditions:   { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-private'] } },
    });
    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }
}
