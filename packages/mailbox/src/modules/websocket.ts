import { Construct } from "constructs";
import {
  WebSocketConnectLambda,
  WebSocketDisconnectLambda,
  WebSocketMessageLambda,
  WebSocketBroadcastLambda,
} from "../lambdas";
import { WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { RemovalPolicy } from "aws-cdk-lib";
import { IArtifactResolver } from "../utils/artifact-resolver";

export interface WebSocketPushProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  authorizerLambda: any; // Lambda function for WebSocket authorization
  artifactResolver: IArtifactResolver;
  maxSubscriptions?: number;
  maxPingInterval?: number;
  minPingInterval?: number;
}

export class WebSocketPush extends Construct {
  public readonly webSocketUrl: string;
  public readonly connectionsTable: Table;
  public readonly broadcastLambda: any;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);

    const maxSubscriptions = props.maxSubscriptions ?? 10;

    // DynamoDB table for WebSocket connections
    this.connectionsTable = new Table(this, 'ConnectionsTable', {
      tableName: 'jmap-websocket-connections',
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Development mode - destroy on stack delete
      timeToLiveAttribute: 'ttl', // Auto-cleanup stale connections
      pointInTimeRecovery: false, // No need for PITR in dev
    });

    // GSI for querying by userId
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
    });

    // WebSocket API
    const webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
      apiName: 'JMAP WebSocket Push',
      description: 'WebSocket API for JMAP Push State notifications',
    });

    const stage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    this.webSocketUrl = stage.url;

    // WebSocket Lambda Authorizer (reuses existing HTTP API authorizer)
    const webSocketAuthorizer = new WebSocketLambdaAuthorizer('WebSocketAuthorizer', props.authorizerLambda, {
      identitySource: [
        'route.request.querystring.token',
        'route.request.header.Authorization',
        'route.request.header.Sec-WebSocket-Protocol',
      ],
    });

    // Lambda: $connect - Store connection (auth already done by authorizer)
    const connectLambda = new WebSocketConnectLambda(this, 'ConnectHandler', {
      connectionsTable: this.connectionsTable,
      jwkCacheTable: props.jwkCacheTable,
      configTable: props.configTable,
      maxSubscriptions: maxSubscriptions,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $disconnect - Cleanup connection
    const disconnectLambda = new WebSocketDisconnectLambda(this, 'DisconnectHandler', {
      connectionsTable: this.connectionsTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $default - Handle messages (PushSubscribe)
    const messageLambda = new WebSocketMessageLambda(this, 'MessageHandler', {
      connectionsTable: this.connectionsTable,
      configTable: props.configTable,
      maxSubscriptions: maxSubscriptions,
      websocketApiId: webSocketApi.apiId,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: broadcast - Send StateChange notifications
    this.broadcastLambda = new WebSocketBroadcastLambda(this, 'BroadcastHandler', {
      connectionsTable: this.connectionsTable,
      websocketApiId: webSocketApi.apiId,
      websocketStageName: stage.stageName,
      artifactResolver: props.artifactResolver,
    });

    // Add routes to WebSocket API
    webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', connectLambda),
      authorizer: webSocketAuthorizer,
    });

    webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectLambda),
    });

    webSocketApi.addRoute('$default', {
      integration: new WebSocketLambdaIntegration('MessageIntegration', messageLambda),
    });
  }
}
