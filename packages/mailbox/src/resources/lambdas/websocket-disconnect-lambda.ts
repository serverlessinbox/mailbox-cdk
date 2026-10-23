import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IDataTable }        from '../tables/data-tables';
import { IWebSocketTable }        from '../tables/websocket-table';

/**
 * The connections table the disconnect handler writes and the config table it reads. The caller creates
 * both.
 */
export interface WebSocketDisconnectLambdaProps {
  readonly connectionsTable: IWebSocketTable;
  readonly configTable:      IDataTable;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda that removes a WebSocket connection when it closes. */
export class WebSocketDisconnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketDisconnectLambdaProps) {
    super(scope, id, {
      lambdaId:         'websocket-disconnect',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(10),
      memorySize:       128,
      environment:      {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
      },
    });

    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantRead(this);
  }
}
