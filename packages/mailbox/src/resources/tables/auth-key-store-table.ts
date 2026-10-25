import { StackNamedTable }              from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType, BillingMode }   from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }            from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy }                from 'aws-cdk-lib';
import { Construct }                    from 'constructs';

/**
 * Read or read-write access to the auth-key-store table without exposing the underlying DynamoDB
 * table. A holder can look up the table name/ARN and request a scoped grant (`grantGetItem`, `grantRead`,
 * `grantReadWrite`); it cannot reach the raw CDK table construct through this interface.
 * `tableArn` is for a holder that can only take a plain ARN, not a construct (a separate stack);
 * every other caller uses the grant methods.
 */
export interface IAuthKeyStoreTable {
  readonly tableName: string;
  readonly tableArn:  string;

  grantGetItem(grantee: IGrantable): void;

  grantRead(grantee: IGrantable): void;

  grantReadWrite(grantee: IGrantable): void;
}

/**
 * DynamoDB table caching the HMAC signing key and per-issuer JWKS used to verify blob-URL and JWT
 * tokens. The current (and previous, during rotation) HMAC key is stored under `pk="hmac"`,
 * `sk="blob-url-signing"`, and each issuer's JWKS under `pk="jwks"`, `sk=<issuer>`.
 *
 * Keyed by `pk`/`sk` (item type in `pk`: `"hmac"` or `"jwks"`), pay-per-request billing, removed
 * along with the stack. Physical table name is stack-derived and unique per position and install (`StackNamedTable`).
 * `grantGetItem`, `grantRead` and `grantReadWrite` expose only the specific DynamoDB actions each kind
 * of caller needs (no `Scan` or PartiQL).
 *
 * Not responsible for populating or refreshing its own contents.
 */
export class AuthKeyStoreTable extends StackNamedTable implements IAuthKeyStoreTable {
  constructor(scope: Construct, id: string) {
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
    });
  }

  public grantGetItem(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem'],
      resourceArns: [this.tableArn],
    });
  }

  public grantRead(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'],
      resourceArns: this.tableAndIndexArns(),
    });
  }

  public grantReadWrite(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      [
        'dynamodb:GetItem',
        'dynamodb:BatchGetItem',
        'dynamodb:Query',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
      ],
      resourceArns: this.tableAndIndexArns(),
    });
  }

  private tableAndIndexArns(): string[] {
    return [this.tableArn, `${this.tableArn}/index/*`];
  }
}
