import { Aws, CfnResource, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  WebSocketConnectLambda,
  WebSocketDisconnectLambda,
  WebSocketMessageLambda,
  WebSocketBroadcastLambda,
} from '../../lambdas';
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
import type { IDataTable } from '../../data/data-tables';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Effect, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { WebSocketTable, IWebSocketTable } from './websocket-table';

export interface IWebSocketBroadcastPublisher {
  readonly functionName: string;
  grantInvoke(grantee: IGrantable): void;
}

/** WebSocket push capability for lambdas that send WebSocket broadcasts (basic signature). */
export interface IWebSocketPushTarget extends IFunction {
  enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void;
}

/** WebSocket push capability for lambdas that need both a WebSocket URL and broadcast capability (e.g. JMAP API). */
export interface IWebSocketPushTargetWithUrl extends IFunction {
  enableWebSocketPush(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void;
}

/**
 * Lets a holder grant a caller permission to push messages to connected WebSocket clients
 * (`grantManageConnections`) and read the ApiGatewayManagementApi endpoint
 * (`managementEndpoint`) — without exposing the underlying API Gateway WebSocket API construct.
 */
export interface IWebSocketPushApi {
  grantManageConnections(grantee: IGrantable): void;

  readonly managementEndpoint: string;
}

class WebSocketBroadcastPublisherImpl implements IWebSocketBroadcastPublisher {
  constructor(private readonly fn: lambda.IFunction) { }

  public get functionName(): string {
    return this.fn.functionName;
  }

  public grantInvoke(grantee: IGrantable): void {
    this.fn.grantInvoke(grantee);
  }
}

export interface WebSocketPushProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly authorizerLambda: lambda.IFunction; // Lambda function for WebSocket authorization
  readonly artifactResolver: IArtifactResolver;
  readonly maxSubscriptions?: number;

  /** Optional custom domain name (e.g. ws.example.com). When set, a domain mapping is created. */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  readonly certificate?: acm.ICertificate;
}

/**
 * The WebSocket API used for JMAP Push State notifications: the `WebSocketApi` itself, its
 * single `prod` stage, the `$connect`/`$disconnect`/`$default` routes and Lambda authorizer, the
 * connections table, the route-handler/broadcast Lambdas, and the optional custom-domain mapping.
 * The underlying `WebSocketApi`/`WebSocketStage` never leave this construct — callers that need
 * to push messages or read the management endpoint go through `IWebSocketPushApi`.
 */
export class WebSocketPush extends Construct implements IWebSocketPushApi {
  /** The single WebSocket stage this API is ever deployed to. */
  public static readonly STAGE_NAME = 'prod';

  private readonly api: WebSocketApi;
  private readonly stage: WebSocketStage;
  public readonly managementEndpoint: string;
  public readonly webSocketUrl: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  public readonly webSocketTable: IWebSocketTable;
  private readonly broadcastLambda: lambda.IFunction;
  public readonly broadcaster: IWebSocketBroadcastPublisher;
  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public readonly domainCfnResource?: CfnResource;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);

    const maxSubscriptions = props.maxSubscriptions ?? 10;

    const webSocketTable = new WebSocketTable(this, 'connections-table');
    this.webSocketTable = webSocketTable;

    this.api = new WebSocketApi(this, 'websocket-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} WebSocket Push`,
      description: 'WebSocket API for JMAP Push State notifications',
    });

    this.stage = new WebSocketStage(this, 'websocket-stage', {
      webSocketApi: this.api,
      stageName: WebSocketPush.STAGE_NAME,
      autoDeploy: true,
    });

    const stack = Stack.of(this);
    this.managementEndpoint = `https://${this.api.apiId}.execute-api.${stack.region}.amazonaws.com/${WebSocketPush.STAGE_NAME}`;

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

      this.domainCfnResource = domain.node.defaultChild as CfnResource;

      // Preserve the existing stage-in-path URL shape.
      new ApiMapping(this, 'mapping', {
        api: this.api,
        domainName: domain,
        stage: this.stage,
      });

      this.domainTarget = domain.regionalDomainName;
      this.webSocketUrl = `wss://${props.domainName}`;
    } else {
      this.webSocketUrl = this.stage.url;
    }

    // Lambda: $connect
    const connectLambda = new WebSocketConnectLambda(this, 'connect-handler', {
      connectionsTable: this.webSocketTable,
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $disconnect
    const disconnectLambda = new WebSocketDisconnectLambda(this, 'disconnect-handler', {
      connectionsTable: this.webSocketTable,
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $default
    const messageLambda = new WebSocketMessageLambda(this, 'message-handler', {
      connectionsTable: this.webSocketTable,
      configTable: props.configTable,
      itemTable: props.itemTable,
      maxSubscriptions: maxSubscriptions,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: broadcast
    this.broadcastLambda = new WebSocketBroadcastLambda(this, 'broadcast-handler', {
      connectionsTable: this.webSocketTable,
      configTable: props.configTable,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    this.broadcaster = new WebSocketBroadcastPublisherImpl(this.broadcastLambda);

    const authorizer = new WebSocketLambdaAuthorizer('WebSocketAuthorizer', props.authorizerLambda, {
      identitySource: [
        'route.request.header.Sec-WebSocket-Protocol',
      ],
    });

    this.api.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('connect-integration', connectLambda),
      authorizer,
    });

    this.api.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('disconnect-integration', disconnectLambda),
    });

    this.api.addRoute('$default', {
      integration: new WebSocketLambdaIntegration('message-integration', messageLambda),
    });
  }

  // Not CDK's WebSocketApi.grantManageConnections: it synthesizes a different resource ARN.
  // This deliberately reproduces the ARN (`<apiId>/*`) the WebSocket Lambdas are granted today,
  // so the grant stays permission-identical.
  public grantManageConnections(grantee: IGrantable): void {
    const stack = Stack.of(this);
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${this.api.apiId}/*`],
    }));
  }
}
