import { Construct } from 'constructs';
import {
  WebSocketConnectLambda,
  WebSocketDisconnectLambda,
  WebSocketMessageLambda,
  WebSocketBroadcastLambda,
} from '../lambdas';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy, Aws } from 'aws-cdk-lib';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { StackNamedTable } from '../utils/named-table';

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
    this.connectionsTable = new StackNamedTable(this, 'ws-connections', {
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: false,
    });

    // GSI for querying by userId
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
    });

    // WebSocket API
    const webSocketApi = new WebSocketApi(this, 'websocket-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} WebSocket Push`,
      description: 'WebSocket API for JMAP Push State notifications',
    });

    const stage = new WebSocketStage(this, 'websocket-stage', {
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

    // Lambda: $connect
    const connectLambda = new WebSocketConnectLambda(this, 'connect-handler', {
      connectionsTable: this.connectionsTable,
      jwkCacheTable: props.jwkCacheTable,
      configTable: props.configTable,
      maxSubscriptions: maxSubscriptions,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $disconnect
    const disconnectLambda = new WebSocketDisconnectLambda(this, 'disconnect-handler', {
      connectionsTable: this.connectionsTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $default
    const messageLambda = new WebSocketMessageLambda(this, 'message-handler', {
      connectionsTable: this.connectionsTable,
      configTable: props.configTable,
      maxSubscriptions: maxSubscriptions,
      websocketApiId: webSocketApi.apiId,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: broadcast
    this.broadcastLambda = new WebSocketBroadcastLambda(this, 'broadcast-handler', {
      connectionsTable: this.connectionsTable,
      websocketApiId: webSocketApi.apiId,
      websocketStageName: stage.stageName,
      artifactResolver: props.artifactResolver,
    });

    // Routes
    webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('connect-integration', connectLambda),
      authorizer: webSocketAuthorizer,
    });

    webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('disconnect-integration', disconnectLambda),
    });

    webSocketApi.addRoute('$default', {
      integration: new WebSocketLambdaIntegration('message-integration', messageLambda),
    });
  }
}
