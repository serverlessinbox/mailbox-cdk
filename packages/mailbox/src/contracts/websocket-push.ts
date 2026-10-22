import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import type { IFunction }  from 'aws-cdk-lib/aws-lambda';

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
  readonly managementEndpoint: string;

  grantManageConnections(grantee: IGrantable): void;
}
