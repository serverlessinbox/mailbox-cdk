import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IDataTable } from '../data/data-tables';
import { Construct } from 'constructs';
import { IWebSocketTable } from '../api/websocket/websocket-table';

export interface WebSocketDisconnectLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: IDataTable;
  artifactResolver: IArtifactResolver;
}

export class WebSocketDisconnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketDisconnectLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-disconnect',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(10),
      memorySize: 128,
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
