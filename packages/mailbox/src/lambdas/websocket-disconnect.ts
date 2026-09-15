import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface WebSocketDisconnectLambdaProps {
  connectionsTable: ITable;
  configTable: ITable;
  artifactResolver: ICdkArtifactEngine;
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
    props.connectionsTable.grantReadWriteData(this);
    props.configTable.grantReadData(this);
  }
}
