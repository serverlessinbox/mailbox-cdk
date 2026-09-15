import { Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface WebSocketMessageLambdaProps {
  connectionsTable: ITable;
  configTable: ITable;
  itemTable: ITable;
  maxSubscriptions: number;
  websocketApiId: string;
  websocketStageName: string;
  artifactResolver: ICdkArtifactEngine;
}

export class WebSocketMessageLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketMessageLambdaProps) {
    const stack = Stack.of(scope);

    super(scope, id, {
      lambdaId: 'websocket-message',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        MAX_SUBSCRIPTIONS: props.maxSubscriptions.toString(),
        WEBSOCKET_API_ENDPOINT: `https://${props.websocketApiId}.execute-api.${stack.region}.amazonaws.com/${props.websocketStageName}`,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWriteData(this);
    props.configTable.grantReadData(this);
    props.itemTable.grantReadData(this);

    // Grant API Gateway Management API permissions
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${props.websocketApiId}/*`],
    }));
  }
}
