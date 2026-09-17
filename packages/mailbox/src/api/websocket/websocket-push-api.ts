import { Aws, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Effect, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { WebSocketApi } from 'aws-cdk-lib/aws-apigatewayv2';

/**
 * Lets a holder grant a caller permission to push messages to connected WebSocket clients
 * (`grantManageConnections`) without exposing the underlying API Gateway WebSocket API construct.
 */
export interface IWebSocketPushApi {
  grantManageConnections(grantee: IGrantable): void;
}

/**
 * The bare API Gateway WebSocket API resource used for JMAP Push State notifications. Exposes only
 * the `WebSocketApi` itself and the ability to grant `execute-api:ManageConnections` on it.
 *
 * Not responsible for stages, routes, integrations or the custom-domain mapping — `WebSocketPush`
 * creates and wires those around this API.
 */
export class WebSocketPushApi extends Construct implements IWebSocketPushApi {
  public readonly api: WebSocketApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.api = new WebSocketApi(this, 'websocket-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} WebSocket Push`,
      description: 'WebSocket API for JMAP Push State notifications',
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
