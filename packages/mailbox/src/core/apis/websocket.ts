import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }       from '@serverlessinbox/mailbox-cdk-shared';
import { WebSocketLambdaAuthorizer }  from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  DomainName,
  EndpointType,
  SecurityPolicy,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                from 'aws-cdk-lib/aws-certificatemanager';
import { Effect, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IFunction }                      from 'aws-cdk-lib/aws-lambda';
import { Aws, CfnResource }                    from 'aws-cdk-lib';
import { Construct }                           from 'constructs';

import { WebSocketBroadcastLambda }            from '../../resources/lambdas/websocket-broadcast-lambda';
import { WebSocketConnectLambda }              from '../../resources/lambdas/websocket-connect-lambda';
import { WebSocketDisconnectLambda }           from '../../resources/lambdas/websocket-disconnect-lambda';
import { WebSocketMessageLambda }              from '../../resources/lambdas/websocket-message-lambda';
import type { IDataTable }                     from '../../resources/tables/data-tables';
import { WebSocketTable, IWebSocketTable }     from '../../resources/tables/websocket-table';

/** The capability to invoke the WebSocket broadcast function, without exposing the function itself. */
export interface IWebSocketBroadcastPublisher {
  readonly functionName: string;
  grantInvoke(grantee: IGrantable): void;
}

/** A Lambda that can be pointed at a WebSocket broadcaster; it needs no WebSocket URL. */
export interface IWebSocketPushTarget extends IFunction {
  enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void;
}

/** A Lambda that can be pointed at a WebSocket broadcaster and also needs the WebSocket URL. */
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

/** Inputs of {@link WebSocketPush}: the tables and authorizer its route handlers use, and the optional custom domain. */
export interface WebSocketPushProps {
  readonly configTable:    IDataTable;
  readonly itemTable:      IDataTable;
  readonly changelogTable: IDataTable;
  /** Authorizer Lambda for the `$connect` route. */
  readonly authorizerLambda: IFunction;
  readonly artifactResolver: IArtifactResolver;
  /** Maximum subscriptions per connection, handed to the message handler. Default: 10. */
  readonly maxSubscriptions?: number;

  /** Optional custom domain name (e.g. ws.example.com). When set, a domain mapping is created. */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). Required when domainName is set. */
  readonly certificate?: acm.ICertificate;
}

/**
 * The WebSocket API used for JMAP Push State notifications: the `WebSocketApi` itself, its
 * single `prod` stage, the `$connect`/`$disconnect`/`$default` routes and Lambda authorizer, the
 * connections table, the route-handler/broadcast Lambdas, and the optional custom-domain mapping.
 * The underlying `WebSocketApi`/`WebSocketStage` never leave this construct — callers that need
 * to push messages or read the management endpoint go through `IWebSocketPushApi`.
 *
 * It does not create the DNS record for the custom domain (it exposes `domainTarget` for that).
 */
export class WebSocketPush extends Construct implements IWebSocketPushApi {
  /** The single WebSocket stage this API is ever deployed to. */
  public static readonly STAGE_NAME = 'prod';

  public readonly managementEndpoint: string;
  public readonly webSocketUrl: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  public readonly webSocketTable: IWebSocketTable;
  public readonly broadcaster: IWebSocketBroadcastPublisher;
  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public readonly domainCfnResource?: CfnResource;
  private readonly api: WebSocketApi;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'WebSocket push service delivering real-time JMAP state changes to connected clients.');

    const maxSubscriptions = props.maxSubscriptions ?? 10;

    this.webSocketTable = new WebSocketTable(this, 'connections-table');

    this.api = new WebSocketApi(this, 'websocket-api', {
      apiName:     `Mailbox ${Aws.STACK_NAME} WebSocket Push`,
      description: 'WebSocket API for JMAP Push State notifications',
    });

    const stage = new WebSocketStage(this, 'websocket-stage', {
      webSocketApi: this.api,
      stageName:    WebSocketPush.STAGE_NAME,
      autoDeploy:   true,
    });

    this.managementEndpoint = `https://${this.api.apiId}.execute-api.${Aws.REGION}.amazonaws.com/${WebSocketPush.STAGE_NAME}`;

    if (props.domainName) {
      if (!props.certificate) {
        throw new Error('WebSocketPush: certificate is required when domainName is provided');
      }

      const domain = new DomainName(this, 'domain', {
        domainName:     props.domainName,
        certificate:    props.certificate,
        endpointType:   EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      // Be explicit: the domain must be deleted before the certificate.
      domain.node.addDependency(props.certificate);

      this.domainCfnResource = domain.node.defaultChild as CfnResource;

      new ApiMapping(this, 'mapping', {
        api:        this.api,
        domainName: domain,
        stage,
      });

      this.domainTarget = domain.regionalDomainName;
      this.webSocketUrl = `wss://${props.domainName}`;
    } else {
      this.webSocketUrl = stage.url;
    }

    // Lambda: $connect
    const connectLambda = new WebSocketConnectLambda(this, 'connect-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $disconnect
    const disconnectLambda = new WebSocketDisconnectLambda(this, 'disconnect-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: $default
    const messageLambda = new WebSocketMessageLambda(this, 'message-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      itemTable:        props.itemTable,
      maxSubscriptions: maxSubscriptions,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    // Lambda: broadcast
    const broadcastLambda = new WebSocketBroadcastLambda(this, 'broadcast-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    this.broadcaster = {
      functionName: broadcastLambda.functionName,
      grantInvoke:  (grantee) => {
        broadcastLambda.grantInvoke(grantee);
      },
    };

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

  /** Allows `execute-api:ManageConnections` on every connection of this API (`<apiId>/*`). */
  public grantManageConnections(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect:    Effect.ALLOW,
      actions:   ['execute-api:ManageConnections'],
      resources: [`arn:${Aws.PARTITION}:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${this.api.apiId}/*`],
    }));
  }
}
