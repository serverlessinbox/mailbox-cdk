import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface WebSocketDisconnectLambdaProps {
  connectionsTable: ITable;
  artifactResolver: IArtifactResolver;
}

export class WebSocketDisconnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketDisconnectLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-disconnect',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
      },
    });

    // Grant permissions
    props.connectionsTable.grantWriteData(this);
  }
}
