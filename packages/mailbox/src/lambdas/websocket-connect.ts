import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface WebSocketConnectLambdaProps {
  connectionsTable: ITable;
  jwkCacheTable: ITable;
  configTable: ITable;
  maxSubscriptions: number;
  artifactResolver: IArtifactResolver;
}

export class WebSocketConnectLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketConnectLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-connect',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        MAX_SUBSCRIPTIONS: props.maxSubscriptions.toString(),
      },
    });

    // Grant permissions
    props.connectionsTable.grantWriteData(this);
    props.jwkCacheTable.grantReadData(this);
    props.configTable.grantReadData(this);
  }
}
