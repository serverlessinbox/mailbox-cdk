import { AttributeType, BillingMode, ITable } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { DynamoDbActions, grantTableActions, StackNamedTable } from '@serverlessinbox/mailbox-cdk-shared';

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
 * Physical table name is stack-derived (`StackNamedTable`).
 * `grantWrite`/`grantReadWrite` expose only the specific DynamoDB actions each kind of caller
 * needs (no `Scan` or PartiQL).
 *
 * Not responsible for the WebSocket API, its Lambdas, or broadcast logic.
 */
export class WebSocketTable extends Construct implements IWebSocketTable {
  private readonly table: ITable;
  public readonly tableName: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Single-table design: uses shared base repository key names so lambdas can use DynamoBaseRepository.
    const table = new StackNamedTable(this, 'websocket', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: false,
    });

    // GSI1 for broadcasting by account (subscription items only).
    // Matches shared base repository naming: indexName=gsi1, keys gsi1pk/gsi1sk.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
    });

    this.table = table;
    this.tableName = this.table.tableName;
  }

  public grantWrite(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.write);
  }

  public grantReadWrite(grantee: IGrantable): void {
    grantTableActions(grantee, this.table, DynamoDbActions.readWrite);
  }
}
