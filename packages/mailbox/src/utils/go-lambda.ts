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
import { applyArtifactTags } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

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
    const { lambdaId, artifactResolver, logGroupRetention = RetentionDays.ONE_MONTH, environment: callerEnvironment, ...restProps } = props;

    const code = artifactResolver.getCode('mailbox-go', `lambdas/${lambdaId}.zip`);

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
        SERVICE_NAME: lambdaId,
      },
      ...restProps,
    });

    applyArtifactTags(this, 'mailbox-go', lambdaId, artifactResolver.getVersion('mailbox-go'));
  }
}
