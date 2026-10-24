import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IWebSocketPushApi } from '../../contracts/websocket-push';
import type { IDataTable }        from '../tables/data-tables';
import { IWebSocketTable }        from '../tables/websocket-table';

/**
 * The connections table it queries and prunes, the config table it reads, the WebSocket push API it posts to and the
 * artifact resolver for its code. The caller creates the tables and the push API.
 */
export interface WebSocketBroadcastLambdaProps {
  readonly connectionsTable: IWebSocketTable;
  readonly configTable:      IDataTable;
  readonly webSocketPushApi: IWebSocketPushApi;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda that pushes messages to subscribed WebSocket connections. */
export class WebSocketBroadcastLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketBroadcastLambdaProps) {
    super(scope, id, {
      lambdaId:         'websocket-broadcast',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(60),
      memorySize:       512,
      environment:      {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        WEBSOCKET_API_ENDPOINT: props.webSocketPushApi.managementEndpoint,
      },
    });

    props.connectionsTable.grantBroadcast(this);
    props.connectionsTable.grantRemoveConnection(this);
    props.configTable.grantRead(this);

    props.webSocketPushApi.grantManageConnections(this);
  }
}
