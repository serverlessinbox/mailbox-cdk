import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IWebSocketPushApi } from '../../contracts/websocket-push';
import type { IDataTable }        from '../tables/data-tables';
import { IWebSocketTable }        from '../tables/websocket-table';

/**
 * The connections, config and item tables it reads or writes, the per-connection subscription limit and
 * the WebSocket push API it posts to. The caller creates the tables and the push API.
 */
export interface WebSocketMessageLambdaProps {
  readonly connectionsTable: IWebSocketTable;
  readonly configTable:      IDataTable;
  readonly itemTable:        IDataTable;
  readonly maxSubscriptions: number;
  readonly webSocketPushApi: IWebSocketPushApi;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda that handles messages from WebSocket clients, including subscriptions. */
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

    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantRead(this);
    props.itemTable.grantRead(this);

    props.webSocketPushApi.grantManageConnections(this);
  }
}
