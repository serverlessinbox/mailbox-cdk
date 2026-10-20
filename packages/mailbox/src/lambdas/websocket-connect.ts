import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { IWebSocketTable }        from '../api/websocket/websocket-table';
import type { IDataTable }        from '../data/data-tables';

export interface WebSocketConnectLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: IDataTable;
  artifactResolver: IArtifactResolver;
}

export class WebSocketConnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketConnectLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-connect',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWrite(this);
    props.configTable.grantRead(this);
  }
}
