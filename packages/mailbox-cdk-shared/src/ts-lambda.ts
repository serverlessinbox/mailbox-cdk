import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from './artifact-engine';
import { applyArtifactTags } from './apply-artifact-tags';

export interface TypeScriptLambdaProps extends FunctionOptions {
  /**
   * Lambda identifier used by artifact resolver (e.g., "edge-deployer", "webhook-handler")
   */
  readonly lambdaId: string;

  /**
   * Artifact resolver for obtaining lambda code from S3
   */
  readonly artifactResolver: ICdkArtifactEngine;

  /**
   * Package name where the lambda artifact is published (defaults to 'mailbox-cdk')
   */
  readonly packageName?: string;

  /**
   * Lambda entry point handler (defaults to 'index.handler')
   */
  readonly handler?: string;

  /**
   * Log retention policy for the lambda's default log group.
   * Set to `false` to skip log retention management.
   *
   * Default: ONE_MONTH.
   */
  readonly logGroupRetention?: RetentionDays | false;
}

/**
 * TypeScript Lambda construct that loads code from S3 artifacts.
 * Similar to GoLambda but for Node.js runtimes.
 *
 * Automatically:
 * - Resolves code from artifact bucket using artifact resolver
 * - Sets up CloudWatch logs with retention
 * - Uses Node.js 24.x runtime with ARM64 architecture
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
      environment: callerEnvironment,
      ...lambdaProps
    } = props;

    const code = artifactResolver.getCode(packageName, `lambdas/${lambdaId}.zip`);

    // Unnamed (CFN-generated) log group passed via the `logGroup` prop (renders LoggingConfig —
    // a plain AWS::Logs::LogGroup, no LogRetention custom resource; the prop also makes the
    // `fn.logGroup` getter safe, which would otherwise lazily create that CR). Deriving the name
    // from the function (`/aws/lambda/<fn>`) is unsafe combined with RETAIN: the name stays
    // identical across logical-id churn (construct moves/renames), so a replacement LogGroup
    // collides with the still-existing or retained-orphan one ("already exists in stack …").
    // A generated name is unique per logical resource — replacements and retained orphans can
    // never collide, and Lambda can't auto-create the group before CFN does.
    const logGroup = logGroupRetention !== false && !props.logGroup
      ? new logs.LogGroup(scope, `${id}-log-group`, {
        retention: logGroupRetention,
        removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      })
      : undefined;

    super(scope, id, {
      code,
      runtime: Runtime.NODEJS_24_X,
      handler,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      ...(lambdaProps.functionName ? { functionName: lambdaProps.functionName } : {}),
      description: lambdaProps.description ?? `Serverless Inbox Mailbox: ${lambdaId} (${Aws.STACK_NAME})`,
      ...(logGroup ? { logGroup } : {}),
      // SERVICE_NAME carries the stable lambdaId to every log line for attribution.
      // Not AWS_LAMBDA_FUNCTION_NAME: that CFN-generated suffix changes on logical-id churn.
      environment: {
        ...callerEnvironment,
        SERVICE_NAME: lambdaId,
      },
      ...lambdaProps,
    });

    applyArtifactTags(this, packageName, lambdaId, artifactResolver.getVersion(packageName));
  }
}
