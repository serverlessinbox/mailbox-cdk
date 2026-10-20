import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { IWebSocketTable }        from '../api/websocket/websocket-table';
import { IWebSocketPushApi }      from '../api/websocket/websocket';
import type { IDataTable }        from '../data/data-tables';

export interface WebSocketBroadcastLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: IDataTable;
  webSocketPushApi: IWebSocketPushApi;
  artifactResolver: IArtifactResolver;
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
    props.configTable.grantRead(this);

    // Grant API Gateway Management API permissions
    props.webSocketPushApi.grantManageConnections(this);
  }
}
