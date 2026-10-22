import { StackNamedTable }                    from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType, BillingMode, ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }                  from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy }                      from 'aws-cdk-lib';
import { Construct }                          from 'constructs';

/**
 * Write or read-write access to the WebSocket connections table without exposing the underlying
 * DynamoDB table. A holder can look up the table name and request a scoped grant (`grantWrite`,
 * `grantReadWrite`); it cannot reach the raw CDK table construct through this interface.
 */
export interface IWebSocketTable {
  readonly tableName: string;

  grantWrite(grantee: IGrantable): void;

  grantReadWrite(grantee: IGrantable): void;
}

/**
 * Single DynamoDB table storing WebSocket connections and their per-account push subscriptions,
 * used to route JMAP Push State notifications to connected clients. Connection and subscription
 * items are keyed by `pk`/`sk`; GSI1 (`gsi1pk`/`gsi1sk`) indexes subscription items by account so
 * a broadcast can find every connection subscribed to an account without scanning the table.
 * DynamoDB TTL is enabled on the `ttl` attribute, so items that set it expire and are removed
 * automatically.
 *
 * Pay-per-request billing, removed along with the stack, point-in-time recovery disabled.
 * Physical table name is stack-derived and unique per position and install (`StackNamedTable`).
 * `grantWrite`/`grantReadWrite` expose only the specific DynamoDB actions each kind of caller
 * needs (no `Scan` or PartiQL).
 *
 * Not responsible for the WebSocket API, its Lambdas, or broadcast logic.
 */
export class WebSocketTable extends Construct implements IWebSocketTable {
  public readonly tableName: string;
  private readonly table: ITable;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Single-table design: uses shared base repository key names so lambdas can use DynamoBaseRepository.
    const table = new StackNamedTable(this, 'websocket', {
      uniquePerPosition:                true,
      partitionKey:                     { name: 'pk', type: AttributeType.STRING },
      sortKey:                          { name: 'sk', type: AttributeType.STRING },
      billingMode:                      BillingMode.PAY_PER_REQUEST,
      removalPolicy:                    RemovalPolicy.DESTROY,
      timeToLiveAttribute:              'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    // GSI1 for broadcasting by account (subscription items only).
    // Matches shared base repository naming: indexName=gsi1, keys gsi1pk/gsi1sk.
    table.addGlobalSecondaryIndex({
      indexName:    'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey:      { name: 'gsi1sk', type: AttributeType.STRING },
    });

    this.table     = table;
    this.tableName = this.table.tableName;
  }

  public grantWrite(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
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
    return [this.table.tableArn, `${this.table.tableArn}/index/*`];
  }
}
