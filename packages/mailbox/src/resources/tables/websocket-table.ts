import { StackNamedTable }              from '@serverlessinbox/mailbox-cdk-shared';
import { AttributeType, BillingMode }   from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }            from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy }                from 'aws-cdk-lib';
import { Construct }                    from 'constructs';

/**
 * Access to the WebSocket connections table without exposing the underlying DynamoDB table. A
 * holder can look up the table name and request one of three scoped grants, each named for what
 * the grantee does: `grantStoreConnection` (connect, message), `grantRemoveConnection` (disconnect)
 * and `grantBroadcast` (broadcast). It cannot reach the raw CDK table construct through this
 * interface.
 */
export interface IWebSocketTable {
  readonly tableName: string;

  grantStoreConnection(grantee: IGrantable): void;

  grantRemoveConnection(grantee: IGrantable): void;

  grantBroadcast(grantee: IGrantable): void;
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
 * Each grant exposes only the DynamoDB actions its caller performs (no `Scan`, `UpdateItem` or PartiQL).
 *
 * Not responsible for the WebSocket API, its Lambdas, or broadcast logic.
 */
export class WebSocketTable extends StackNamedTable implements IWebSocketTable {
  constructor(scope: Construct, id: string) {
    // Single-table design: uses shared base repository key names so lambdas can use DynamoBaseRepository.
    super(scope, id, {
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
    this.addGlobalSecondaryIndex({
      indexName:    'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey:      { name: 'gsi1sk', type: AttributeType.STRING },
    });
  }

  public grantStoreConnection(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
      ],
      resourceArns: [this.tableArn],
    });
  }

  public grantRemoveConnection(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      [
        'dynamodb:Query',
        'dynamodb:DeleteItem',
      ],
      resourceArns: [this.tableArn],
    });
  }

  public grantBroadcast(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      [
        'dynamodb:Query',
      ],
      resourceArns: [this.tableArn, `${this.tableArn}/index/*`],
    });
  }
}
