import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { applyArtifactTags, getOrCreatePipelineLogGroup } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine, Pipeline } from '@serverlessinbox/mailbox-cdk-shared';

export interface GoLambda2Props extends FunctionOptions {
  /**
   * Lambda identifier used by code provider (e.g., "authorizer", "api-handler")
   */
  lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  artifactResolver: ICdkArtifactEngine;

  /**
   * The pipeline this Lambda belongs to. Selects the shared CloudWatch log group it writes to.
   */
  readonly pipeline: Pipeline;

  /**
   * Value written to the `SERVICE_NAME` environment variable.
   *
   * Defaults to `lambdaId`. Set this when several physical Lambda functions
   * share one `lambdaId` (and therefore one artifact) so each function still
   * gets a distinct `SERVICE_NAME` for log attribution.
   */
  readonly serviceName?: string;
}

/** @internal */
export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambda2Props) {
    const { lambdaId, artifactResolver, pipeline, serviceName, environment: callerEnvironment, ...restProps } = props;

    const code = artifactResolver.getCode('mailbox-go', `lambdas/${lambdaId}.zip`);

    const logGroup = props.logGroup ?? getOrCreatePipelineLogGroup(scope, pipeline);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      ...(restProps.functionName ? { functionName: restProps.functionName } : {}),
      description: restProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...(logGroup ? { logGroup } : {}),
      // SERVICE_NAME carries the stable lambdaId to every log line for attribution.
      // Not AWS_LAMBDA_FUNCTION_NAME: that CFN-generated suffix changes on logical-id churn.
      environment: {
        ...callerEnvironment,
        SERVICE_NAME: serviceName ?? lambdaId,
        PIPELINE: pipeline,
      },
      ...restProps,
    });

    applyArtifactTags(this, 'mailbox-go', lambdaId, artifactResolver.getVersion('mailbox-go'));
  }
}
