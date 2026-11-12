import type { IGrantable }         from 'aws-cdk-lib/aws-iam';
import type { IFunction }          from 'aws-cdk-lib/aws-lambda';

import type { IStateChangeFanout } from './state-change-fanout';

/** A Lambda that can be pointed at the state-change fan-out; it needs no WebSocket URL. */
export interface IWebSocketPushTarget extends IFunction {
  enableWebSocketPush(stateChangeFanout: IStateChangeFanout): void;
}

/** A Lambda that can be pointed at the state-change fan-out and also needs the WebSocket URL. */
export interface IWebSocketPushTargetWithUrl extends IFunction {
  enableWebSocketPush(webSocketUrl: string, stateChangeFanout: IStateChangeFanout): void;
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
