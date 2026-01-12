import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IArtifactResolver } from './artifact-resolver';

export interface GoLambda2Props extends FunctionOptions {
  /**
   * Lambda identifier used by code provider (e.g., "authorizer", "api-handler")
   */
  lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  artifactResolver: IArtifactResolver;
}

export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambda2Props) {
    const { lambdaId, artifactResolver, ...lambdaProps } = props;

    const code = artifactResolver.getCode('mailbox-go', `lambdas/${lambdaId}.zip`);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      logGroup: new LogGroup(scope, `${id}-LogGroup`, {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      ...lambdaProps,
    });
  }
}