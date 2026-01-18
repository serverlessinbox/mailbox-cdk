import { Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface WebSocketMessageLambdaProps {
  connectionsTable: ITable;
  configTable: ITable;
  maxSubscriptions: number;
  websocketApiId: string;
  artifactResolver: IArtifactResolver;
}

export class WebSocketMessageLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketMessageLambdaProps) {
    super(scope, id, {
      lambdaId: 'websocket-message',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        MAX_SUBSCRIPTIONS: props.maxSubscriptions.toString(),
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWriteData(this);
    props.configTable.grantReadData(this);

    // Grant API Gateway Management API permissions
    const stack = Stack.of(this);
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${props.websocketApiId}/*`],
    }));
  }
}
