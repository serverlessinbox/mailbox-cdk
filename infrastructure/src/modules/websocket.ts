import { Construct } from "constructs";
import { GoLambda } from "../utils/go-lambda";
import { ILambdaCodeProvider } from "../utils/lambda-code-provider";
import { WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { AttributeType, BillingMode, Table, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";

export interface WebSocketPushProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  userPoolIssuer: string;
  jwkCacheTable: ITable;
  capabilityDomain: string;
  authorizerLambda: any; // Lambda function for WebSocket authorization
  codeProvider: ILambdaCodeProvider;
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
    const maxPingInterval = props.maxPingInterval ?? 300;
    const minPingInterval = props.minPingInterval ?? 30;

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
    const connectLambda = new GoLambda(this, 'ConnectHandler', {
      lambdaId: 'websocket-connect',
      codeProvider: props.codeProvider,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        USER_POOL_ISSUER: props.userPoolIssuer,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        MAX_SUBSCRIPTIONS: maxSubscriptions.toString(),
      },
    });

    this.connectionsTable.grantWriteData(connectLambda);
    props.jwkCacheTable.grantReadData(connectLambda);
    props.configTable.grantReadData(connectLambda);

    // Lambda: $disconnect - Cleanup connection
    const disconnectLambda = new GoLambda(this, 'DisconnectHandler', {
      lambdaId: 'websocket-disconnect',
      codeProvider: props.codeProvider,
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
      },
    });

    this.connectionsTable.grantWriteData(disconnectLambda);

    // Lambda: $default - Handle messages (PushSubscribe)
    const messageLambda = new GoLambda(this, 'MessageHandler', {
      lambdaId: 'websocket-message',
      codeProvider: props.codeProvider,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        MAX_SUBSCRIPTIONS: maxSubscriptions.toString(),
      },
    });

    this.connectionsTable.grantReadWriteData(messageLambda);
    props.configTable.grantReadData(messageLambda);

    // Grant API Gateway Management API permissions to send messages
    const stack = Stack.of(this);
    messageLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${webSocketApi.apiId}/*`],
    }));

    // Lambda: broadcast - Send StateChange notifications
    this.broadcastLambda = new GoLambda(this, 'BroadcastHandler', {
      lambdaId: 'websocket-broadcast',
      codeProvider: props.codeProvider,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: `https://${webSocketApi.apiId}.execute-api.${stack.region}.amazonaws.com/${stage.stageName}`,
      },
    });

    this.connectionsTable.grantReadWriteData(this.broadcastLambda);

    // Grant API Gateway Management API permissions
    this.broadcastLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${webSocketApi.apiId}/*`],
    }));

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
