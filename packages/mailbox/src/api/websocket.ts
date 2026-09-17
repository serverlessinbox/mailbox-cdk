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
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnResource } from 'aws-cdk-lib';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import { WebSocketTable, IWebSocketTable } from './websocket-table';
import { WebSocketPushApi, IWebSocketPushApi } from './websocket-push-api';

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
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly authKeyStoreTable: ITable;
  readonly authorizerLambda: lambda.IFunction; // Lambda function for WebSocket authorization
  readonly artifactResolver: ICdkArtifactEngine;
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
  public readonly webSocketTable: IWebSocketTable;
  public readonly webSocketPushApi: IWebSocketPushApi;
  private readonly broadcastLambda: lambda.IFunction;
  public readonly broadcaster: IWebSocketBroadcastPublisher;
  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  private _domainCfnResource?: CfnResource;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);

    const maxSubscriptions = props.maxSubscriptions ?? 10;

    const webSocketTable = new WebSocketTable(this, 'connections-table');
    this.webSocketTable = webSocketTable;
    this.connectionsTable = webSocketTable.table;

    const webSocketPushApi = new WebSocketPushApi(this, 'push-api');
    this.webSocketPushApi = webSocketPushApi;
    const webSocketApi = webSocketPushApi.api;

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

      this._domainCfnResource = domain.node.defaultChild as CfnResource;

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
      configTable: props.configTable,
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

  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public get domainCfnResource(): CfnResource | undefined {
    return this._domainCfnResource;
  }
}
