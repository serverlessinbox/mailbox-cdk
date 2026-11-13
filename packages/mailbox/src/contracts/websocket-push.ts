import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * Lets a holder grant a caller permission to push messages to connected WebSocket clients
 * (`grantManageConnections`) and read the ApiGatewayManagementApi endpoint
 * (`managementEndpoint`) — without exposing the underlying API Gateway WebSocket API construct.
 */
export interface IWebSocketPushApi {
  readonly managementEndpoint: string;

  grantManageConnections(grantee: IGrantable): void;
}

/** A Lambda that advertises the WebSocket API's URL to its callers; it needs no fan-out. */
export interface IWebSocketCapabilityAdvertiser {
  enableWebSocketCapability(webSocketUrl: string): void;
}
