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

/** What `TypeScriptLambda` needs beyond the function options: which published artifact holds the code, and which pipeline the function logs under. */
export interface TypeScriptLambdaProps extends FunctionOptions {
  /**
   * Lambda identifier used by artifact resolver
   */
  readonly lambdaId: string;

  /**
   * Artifact resolver for obtaining lambda code from S3
   */
  readonly artifactResolver: IArtifactResolver;

  /**
   * Package name where the lambda artifact is published.
   * The artifact resolver must hold a pin for it.
   */
  readonly packageName: string;

  /**
   * Lambda entry point handler (defaults to 'index.handler')
   */
  readonly handler?: string;

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
 * A Node.js Lambda on ARM64 whose code is a published artifact, resolved through the artifact resolver
 * from `lambdas/<lambdaId>.zip` of the package named by `packageName`. It logs to the shared log group
 * of its pipeline unless `logGroup` is passed, and carries `SERVICE_NAME` and the artifact tags.
 */
export class TypeScriptLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: TypeScriptLambdaProps) {
    const {
      lambdaId,
      artifactResolver,
      packageName,
      handler = 'index.handler',
      pipeline,
      serviceName,
      environment: callerEnvironment,
      ...lambdaProps
    } = props;

    const code = new ArtifactCode(scope, artifactResolver, packageName, `lambdas/${lambdaId}.zip`);

    const logGroup = props.logGroup ?? PipelineLogGroup.getOrCreate(scope, pipeline);

    super(scope, id, {
      code,
      runtime: Runtime.NODEJS_24_X,
      handler,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      ...(lambdaProps.functionName ? { functionName: lambdaProps.functionName } : {}),
      description: lambdaProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...(logGroup ? { logGroup } : {}),
      // SERVICE_NAME is the stable name every log line is attributed to.
      // Not AWS_LAMBDA_FUNCTION_NAME: that CFN-generated suffix changes on logical-id churn.
      environment: {
        ...callerEnvironment,
        SERVICE_NAME: serviceName ?? lambdaId,
      },
      ...lambdaProps,
    });

    applyArtifactTags(this, packageName, lambdaId, artifactResolver.getVersion(packageName));
  }
}
