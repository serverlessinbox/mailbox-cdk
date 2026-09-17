import { AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { DynamoDbActions, grantTableActions, INamedTable, StackNamedTable } from '@serverlessinbox/mailbox-cdk-shared';

/**
 * Read or read-write access to the auth-key-store table without exposing the underlying DynamoDB
 * table. A holder can look up the table name/ARN and request a scoped grant (`grantRead`,
 * `grantReadWrite`); it cannot reach the raw CDK table construct through this interface.
 * `tableArn` exists only for the Lambda@Edge composition (the edge sub-stack takes a plain ARN,
 * never a construct) — every other caller uses the grant methods.
 */
export interface IAuthKeyStoreTable {
  readonly tableName: string;
  readonly tableArn: string;

  grantRead(grantee: IGrantable): void;

  grantReadWrite(grantee: IGrantable): void;
}

/**
 * DynamoDB table caching the HMAC signing key and per-issuer JWKS used to verify blob-URL and JWT
 * tokens. `AuthKeyStoreUpdaterLambda` writes the current (and previous, during rotation) HMAC key
 * under `pk="hmac"`, `sk="blob-url-signing"`, and each issuer's JWKS under `pk="jwks"`,
 * `sk=<issuer>`; the authorizer and other Lambdas read those items to validate incoming tokens.
 *
 * Keyed by `pk`/`sk` (item type in `pk`: `"hmac"` or `"jwks"`), pay-per-request billing, removed
 * along with the stack. Physical table name is stack-derived (`StackNamedTable`).
 * `grantRead`/`grantReadWrite` expose only the specific DynamoDB actions each kind of caller
 * needs (no `Scan` or PartiQL).
 *
 * Not responsible for populating or refreshing its own contents — the `AuthKeyStore` feature
 * construct schedules the updater Lambda that keeps this table current.
 */
export class AuthKeyStoreTable extends Construct implements IAuthKeyStoreTable {
  private readonly table: INamedTable;
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new StackNamedTable(this, 'auth-key-store-v2', {
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });
    this.tableName = this.table.tableName;
    this.tableArn = this.table.tableArn;
  }

  public grantRead(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.read);
  }

  public grantReadWrite(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.readWrite);
  }
}
