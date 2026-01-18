import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { LogGroupRetention } from '../features/observability/log-group-retention';

export interface GoLambda2Props extends FunctionOptions {
  /**
   * Lambda identifier used by code provider (e.g., "authorizer", "api-handler")
   */
  lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  artifactResolver: IArtifactResolver;

  /**
   * Log retention policy for the lambda's default log group.
   * Set to `false` to skip log retention management.
   *
   * Default: ONE_MONTH.
   */
  logGroupRetention?: RetentionDays | false;
}

export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambda2Props) {
    const { lambdaId, artifactResolver, logGroupRetention = RetentionDays.ONE_MONTH, ...lambdaProps } = props;

    const code = artifactResolver.getCode('mailbox-go', `lambdas/${lambdaId}.zip`);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      ...(lambdaProps.functionName ? { functionName: lambdaProps.functionName } : {}),
      description: lambdaProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...lambdaProps,
    });

    if (logGroupRetention !== false) {
      new LogGroupRetention(this, 'log-retention', {
        artifactResolver,
        lambdaFunction: this,
        retention: logGroupRetention,
      });
    }
  }
}