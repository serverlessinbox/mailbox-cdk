import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { IWebSocketTable } from '../api/websocket/websocket-table';
import { IWebSocketPushApi } from '../api/websocket/websocket';

export interface WebSocketBroadcastLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: ITable;
  webSocketPushApi: IWebSocketPushApi;
  artifactResolver: ICdkArtifactEngine;
}

export class WebSocketBroadcastLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketBroadcastLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-broadcast',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        WEBSOCKET_API_ENDPOINT: props.webSocketPushApi.managementEndpoint,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantReadData(this);

    // Grant API Gateway Management API permissions
    props.webSocketPushApi.grantManageConnections(this);
  }
}
