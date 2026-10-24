import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IDataTable }        from '../tables/data-tables';
import { IWebSocketTable }        from '../tables/websocket-table';

/**
 * The connections table the connect handler writes and the config table it reads. The caller creates
 * both.
 */
export interface WebSocketConnectLambdaProps {
  readonly connectionsTable: IWebSocketTable;
  readonly configTable:      IDataTable;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda that records a WebSocket connection when it opens. */
export class WebSocketConnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketConnectLambdaProps) {
    super(scope, id, {
      lambdaId:         'websocket-connect',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
      },
    });

    props.connectionsTable.grantStoreConnection(this);
    props.configTable.grantRead(this);
  }
}
