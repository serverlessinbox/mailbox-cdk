import { Construct } from 'constructs';
import {
  WebSocketConnectLambda,
  WebSocketDisconnectLambda,
  WebSocketMessageLambda,
  WebSocketBroadcastLambda,
} from '../lambdas';
import {
  ApiMapping,
  DomainName,
  EndpointType,
  SecurityPolicy,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy, Aws } from 'aws-cdk-lib';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { StackNamedTable } from '../utils/named-table';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';

export interface IWebSocketBroadcastPublisher {
  readonly functionName: string;
  grantInvoke(grantee: IGrantable): void;
}


class WebSocketBroadcastPublisherImpl implements IWebSocketBroadcastPublisher {
  constructor(private readonly fn: lambda.Function) { }

  public get functionName(): string {
    return this.fn.functionName;
  }

  public grantInvoke(grantee: IGrantable): void {
    this.fn.grantInvoke(grantee);
  }
}

export interface WebSocketPushProps {
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly authKeyStoreTable: ITable;
  readonly authorizerLambda: lambda.IFunction; // Lambda function for WebSocket authorization
  readonly artifactResolver: IArtifactResolver;
  readonly maxSubscriptions?: number;

  /** Optional custom domain name (e.g. ws.example.com). When set, a domain mapping is created. */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  readonly certificate?: acm.ICertificate;
}

export class WebSocketPush extends Construct {
  public readonly webSocketUrl: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  public readonly connectionsTable: Table;
  private readonly broadcastLambda: lambda.Function;
  public readonly broadcaster: IWebSocketBroadcastPublisher;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);

    const maxSubscriptions = props.maxSubscriptions ?? 10;

    // DynamoDB table for WebSocket connections + subscriptions (single-table design)
    this.connectionsTable = new StackNamedTable(this, 'websocket', {
      // IMPORTANT: Uses shared base repository key names so lambdas can use DynamoBaseRepository
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: false,
    });

    // GSI1 for broadcasting by account (subscription items only)
    // Matches shared base repository naming: indexName=gsi1, keys gsi1pk/gsi1sk
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
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

    // Optional custom domain mapping.
    if (props.domainName) {
      if (!props.certificate) {
        throw new Error('WebSocketPush: certificate is required when domainName is provided');
      }

      const domain = new DomainName(this, 'domain', {
        domainName: props.domainName,
        certificate: props.certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      // Be explicit: the domain must be deleted before the certificate.
      domain.node.addDependency(props.certificate);

      // Preserve the existing stage-in-path URL shape.
      new ApiMapping(this, 'mapping', {
        api: webSocketApi,
        domainName: domain,
        stage,
      });

      this.domainTarget = domain.regionalDomainName;
      this.webSocketUrl = `wss://${props.domainName}`;
    } else {
      this.webSocketUrl = stage.url;
    }

    // WebSocket Lambda Authorizer (reuses existing HTTP API authorizer)
    const webSocketAuthorizer = new WebSocketLambdaAuthorizer('WebSocketAuthorizer', props.authorizerLambda, {
      identitySource: [
        'route.request.header.Sec-WebSocket-Protocol',
      ],
    });

    // Lambda: $connect
    const connectLambda = new WebSocketConnectLambda(this, 'connect-handler', {
      connectionsTable: this.connectionsTable,
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      maxSubscriptions: maxSubscriptions,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $disconnect
    const disconnectLambda = new WebSocketDisconnectLambda(this, 'disconnect-handler', {
      connectionsTable: this.connectionsTable,
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $default
    const messageLambda = new WebSocketMessageLambda(this, 'message-handler', {
      connectionsTable: this.connectionsTable,
      configTable: props.configTable,
      itemTable: props.itemTable,
      maxSubscriptions: maxSubscriptions,
      websocketApiId: webSocketApi.apiId,
      websocketStageName: stage.stageName,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: broadcast
    this.broadcastLambda = new WebSocketBroadcastLambda(this, 'broadcast-handler', {
      connectionsTable: this.connectionsTable,
      configTable: props.configTable,
      websocketApiId: webSocketApi.apiId,
      websocketStageName: stage.stageName,
      artifactResolver: props.artifactResolver,
    });

    this.broadcaster = new WebSocketBroadcastPublisherImpl(this.broadcastLambda);

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
