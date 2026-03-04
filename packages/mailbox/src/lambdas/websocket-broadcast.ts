import { Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface WebSocketBroadcastLambdaProps {
  connectionsTable: ITable;
  configTable: ITable;
  websocketApiId: string;
  websocketStageName: string;
  artifactResolver: IArtifactResolver;
}

export class WebSocketBroadcastLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: WebSocketBroadcastLambdaProps) {
    const stack = Stack.of(scope);

    super(scope, id, {
      lambdaId: 'websocket-broadcast',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        WEBSOCKET_API_ENDPOINT: `https://${props.websocketApiId}.execute-api.${stack.region}.amazonaws.com/${props.websocketStageName}`,
      },
    });

    // Grant permissions
    props.connectionsTable.grantReadWriteData(this);
    props.configTable.grantReadData(this);

    // Grant API Gateway Management API permissions
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${stack.region}:${stack.account}:${props.websocketApiId}/*`],
    }));
  }
}
