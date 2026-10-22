import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IWebSocketPushApi } from '../../contracts/websocket-push';
import type { IDataTable }        from '../tables/data-tables';
import { IWebSocketTable }        from '../tables/websocket-table';

export interface WebSocketMessageLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable:      IDataTable;
  itemTable:        IDataTable;
  maxSubscriptions: number;
  webSocketPushApi: IWebSocketPushApi;
  artifactResolver: IArtifactResolver;
}

export class WebSocketMessageLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketMessageLambdaProps) {
    super(scope, id, {
      lambdaId:         'websocket-message',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        ITEM_TABLE_NAME:        props.itemTable.tableName,
        MAX_SUBSCRIPTIONS:      props.maxSubscriptions.toString(),
        WEBSOCKET_API_ENDPOINT: props.webSocketPushApi.managementEndpoint,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantRead(this);
    props.itemTable.grantRead(this);

    // Grant API Gateway Management API permissions
    props.webSocketPushApi.grantManageConnections(this);
  }
}
