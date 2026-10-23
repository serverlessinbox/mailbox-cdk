import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }       from '@serverlessinbox/mailbox-cdk-shared';
import { WebSocketLambdaAuthorizer }  from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { Effect, IGrantable, PolicyStatement }                  from 'aws-cdk-lib/aws-iam';
import type { IFunction }                                       from 'aws-cdk-lib/aws-lambda';
import { Aws }                                                  from 'aws-cdk-lib';
import { Construct }                                            from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushApi } from '../../contracts/websocket-push';
import { WebSocketBroadcastLambda }                             from '../../resources/lambdas/websocket-broadcast-lambda';
import { WebSocketConnectLambda }                               from '../../resources/lambdas/websocket-connect-lambda';
import { WebSocketDisconnectLambda }                            from '../../resources/lambdas/websocket-disconnect-lambda';
import { WebSocketMessageLambda }                               from '../../resources/lambdas/websocket-message-lambda';
import type { IDataTable }                                      from '../../resources/tables/data-tables';
import { WebSocketTable, IWebSocketTable }                      from '../../resources/tables/websocket-table';

import { ApiCustomDomain }                                      from './api-custom-domain';
import type { ApiCustomDomainProps, ILogicalIdPin }             from './api-custom-domain';

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

  /** Optional custom domain (e.g. ws.example.com) to serve this API on. When set, a domain mapping is created. */
  readonly customDomain?: ApiCustomDomainProps;
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
  /** Fixes the logical id of the custom domain name. Present only when a custom domain is set. */
  public readonly domainLogicalIdPin?: ILogicalIdPin;
  public readonly webSocketTable: IWebSocketTable;
  public readonly broadcaster: IWebSocketBroadcastPublisher;
  private readonly api: WebSocketApi;

  constructor(scope: Construct, id: string, props: WebSocketPushProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'WebSocket push service delivering real-time JMAP state changes to connected clients.');

    this.webSocketTable = new WebSocketTable(this, 'websocket');

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

    if (props.customDomain) {
      const domain = this.addCustomDomain(stage, props.customDomain);

      this.domainTarget       = domain.regionalDomainName;
      this.domainLogicalIdPin = domain.logicalIdPin;
      this.webSocketUrl       = `wss://${props.customDomain.domainName}`;
    } else {
      this.webSocketUrl = stage.url;
    }

    this.broadcaster = this.addRouteHandlers(props);
  }

  /** Allows `execute-api:ManageConnections` on every connection of this API (`<apiId>/*`). */
  public grantManageConnections(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect:    Effect.ALLOW,
      actions:   ['execute-api:ManageConnections'],
      resources: [`arn:${Aws.PARTITION}:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${this.api.apiId}/*`],
    }));
  }

  private addCustomDomain(stage: WebSocketStage, customDomain: ApiCustomDomainProps): ApiCustomDomain {
    const domain = new ApiCustomDomain(this, 'domain', customDomain);

    new ApiMapping(this, 'mapping', {
      api:        this.api,
      domainName: domain,
      stage,
    });

    return domain;
  }

  private addRouteHandlers(props: WebSocketPushProps): IWebSocketBroadcastPublisher {
    const connectLambda = new WebSocketConnectLambda(this, 'connect-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      artifactResolver: props.artifactResolver,
    });

    const disconnectLambda = new WebSocketDisconnectLambda(this, 'disconnect-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      artifactResolver: props.artifactResolver,
    });

    const messageLambda = new WebSocketMessageLambda(this, 'message-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      itemTable:        props.itemTable,
      maxSubscriptions: props.maxSubscriptions ?? 10,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    const broadcastLambda = new WebSocketBroadcastLambda(this, 'broadcast-handler', {
      connectionsTable: this.webSocketTable,
      configTable:      props.configTable,
      webSocketPushApi: this,
      artifactResolver: props.artifactResolver,
    });

    const authorizer = new WebSocketLambdaAuthorizer('websocket-authorizer', props.authorizerLambda, {
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

    return {
      functionName: broadcastLambda.functionName,
      grantInvoke:  (grantee) => {
        broadcastLambda.grantInvoke(grantee);
      },
    };
  }
}
