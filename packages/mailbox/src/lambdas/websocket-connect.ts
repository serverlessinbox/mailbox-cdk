import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface WebSocketConnectLambdaProps {
  connectionsTable: ITable;
  authKeyStoreTable: ITable;
  configTable: ITable;
  maxSubscriptions: number;
  artifactResolver: ICdkArtifactResolver;
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
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        MAX_SUBSCRIPTIONS: props.maxSubscriptions.toString(),
      },
    });

    // Grant permissions
    props.connectionsTable.grantWriteData(this);
    props.authKeyStoreTable.grantReadData(this);
    props.configTable.grantReadData(this);
  }
}
