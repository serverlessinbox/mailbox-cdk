import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../data/data-tables';
import { Construct } from 'constructs';
import { IWebSocketTable } from '../api/websocket/websocket-table';

export interface WebSocketConnectLambdaProps {
  connectionsTable: IWebSocketTable;
  configTable: IDataTable;
  artifactResolver: ICdkArtifactEngine;
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
