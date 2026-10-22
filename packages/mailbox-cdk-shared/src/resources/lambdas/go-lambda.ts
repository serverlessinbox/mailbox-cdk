import { ArtifactCode }           from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { Aws }               from 'aws-cdk-lib';
import { Construct }         from 'constructs';

import { applyArtifactTags } from '../../artifacts/apply-artifact-tags';

import { PipelineLogGroup }  from './pipeline-log-groups';
import type { Pipeline }     from './pipelines';

/** What `GoLambda` needs beyond the function options: which published artifact holds the code, and which pipeline the function logs under. */
export interface GoLambdaProps extends FunctionOptions {
  /**
   * Lambda identifier used by code provider
   */
  readonly lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  readonly artifactResolver: IArtifactResolver;

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

/**
 * A Go Lambda on ARM64 whose code is a published artifact, resolved through the artifact resolver from
 * `lambdas/<lambdaId>.zip`. It logs to the shared log group of its pipeline unless `logGroup` is passed,
 * and carries `SERVICE_NAME` and the artifact tags.
 * @internal
 */
export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambdaProps) {
    const { lambdaId, artifactResolver, pipeline, serviceName, environment: callerEnvironment, ...restProps } = props;

    const code = new ArtifactCode(scope, artifactResolver, 'mailbox-go', `lambdas/${lambdaId}.zip`);

    const logGroup = props.logGroup ?? PipelineLogGroup.getOrCreate(scope, pipeline);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      ...(restProps.functionName ? { functionName: restProps.functionName } : {}),
      description: restProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...(logGroup ? { logGroup } : {}),
      // SERVICE_NAME is the stable name every log line is attributed to.
      // Not AWS_LAMBDA_FUNCTION_NAME: that CFN-generated suffix changes on logical-id churn.
      environment: {
        ...callerEnvironment,
        SERVICE_NAME: serviceName ?? lambdaId,
      },
      ...restProps,
    });

    applyArtifactTags(this, 'mailbox-go', lambdaId, artifactResolver.getVersion('mailbox-go'));
  }
}
