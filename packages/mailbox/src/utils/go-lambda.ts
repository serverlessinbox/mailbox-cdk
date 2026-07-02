import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { Aws, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';

export interface GoLambda2Props extends FunctionOptions {
  /**
   * Lambda identifier used by code provider (e.g., "authorizer", "api-handler")
   */
  lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  artifactResolver: ICdkArtifactResolver;

  /**
   * Log retention policy for the lambda's default log group.
   * Set to `false` to skip log retention management.
   *
   * Default: ONE_MONTH.
   */
  logGroupRetention?: RetentionDays | false;
}

/** @internal */
export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambda2Props) {
    const { lambdaId, artifactResolver, logGroupRetention = RetentionDays.ONE_MONTH, ...lambdaProps } = props;

    const code = artifactResolver.getCode('mailbox-go', `lambdas/${lambdaId}.zip`);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      ...(lambdaProps.functionName ? { functionName: lambdaProps.functionName } : {}),
      description: lambdaProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...lambdaProps,
    });

    Tags.of(this).add('mailbox:artifact-name', lambdaId);
    Tags.of(this).add('mailbox:artifact-version', artifactResolver.getVersion('mailbox-go'));

    if (logGroupRetention !== false) {
      const cfnLogGroup = new logs.CfnLogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${this.functionName}`,
        retentionInDays: logGroupRetention,
      });
      cfnLogGroup.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
    }
  }
}
