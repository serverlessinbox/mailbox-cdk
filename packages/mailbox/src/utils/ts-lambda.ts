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

export interface TypeScriptLambdaProps extends FunctionOptions {
  /**
   * Lambda identifier used by artifact resolver (e.g., "edge-deployer", "webhook-handler")
   */
  lambdaId: string;

  /**
   * Artifact resolver for obtaining lambda code from S3
   */
  artifactResolver: IArtifactResolver;

  /**
   * Package name where the lambda artifact is published (defaults to 'mailbox-cdk')
   */
  packageName?: string;

  /**
   * Lambda entry point handler (defaults to 'index.handler')
   */
  handler?: string;

  /**
   * Log retention policy for the lambda's default log group.
   * Set to `false` to skip log retention management.
   *
   * Default: ONE_MONTH.
   */
  logGroupRetention?: RetentionDays | false;
}

/**
 * TypeScript Lambda construct that loads code from S3 artifacts.
 * Similar to GoLambda but for Node.js runtimes.
 *
 * Automatically:
 * - Resolves code from artifact bucket using artifact resolver
 * - Sets up CloudWatch logs with retention
 * - Uses Node.js 20.x runtime with ARM64 architecture
 * - Configurable memory and timeout
 *
 * Example:
 * ```ts
 * new TypeScriptLambda(scope, 'MyLambda', {
 *   lambdaId: 'my-handler',
 *   artifactResolver,
 *   packageName: 'mailbox-cdk',
 *   timeout: Duration.seconds(30),
 *   memorySize: 256,
 *   environment: {
 *     MY_ENV: 'value',
 *   },
 * });
 * ```
 */
export class TypeScriptLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: TypeScriptLambdaProps) {
    const {
      lambdaId,
      artifactResolver,
      packageName = 'mailbox-cdk',
      handler = 'index.handler',
      logGroupRetention = RetentionDays.ONE_MONTH,
      ...lambdaProps
    } = props;

    const code = artifactResolver.getCode(packageName, `lambdas/${lambdaId}.zip`);

    super(scope, id, {
      code,
      runtime: Runtime.NODEJS_20_X,
      handler,
      architecture: Architecture.ARM_64,
      memorySize: 512,
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
