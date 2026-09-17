import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { IWebSocketTable } from '../api/websocket/websocket-table';
import { IWebSocketPushApi } from '../api/websocket/websocket';

export interface WebSocketMessageLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: ITable;
  itemTable: ITable;
  maxSubscriptions: number;
  webSocketPushApi: IWebSocketPushApi;
  artifactResolver: ICdkArtifactEngine;
}

export class WebSocketMessageLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketMessageLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-message',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        MAX_SUBSCRIPTIONS: props.maxSubscriptions.toString(),
        WEBSOCKET_API_ENDPOINT: props.webSocketPushApi.managementEndpoint,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantReadData(this);
    props.itemTable.grantReadData(this);

    // Grant API Gateway Management API permissions
    props.webSocketPushApi.grantManageConnections(this);
  }
}
