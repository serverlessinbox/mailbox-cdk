import * as cdk from 'aws-cdk-lib';
import { Aws, Fn } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { getOrCreateSharedGroup } from './shared-group';
import type { Pipeline } from './pipelines';

/** Log retention, settable per pipeline. */
const PIPELINE_RETENTION: Record<Pipeline, RetentionDays> = {
  infra: RetentionDays.ONE_MONTH,
  'mail-in': RetentionDays.ONE_MONTH,
  'mail-out': RetentionDays.ONE_MONTH,
  jmap: RetentionDays.ONE_MONTH,
  admin: RetentionDays.ONE_MONTH,
  audit: RetentionDays.ONE_MONTH,
};

/**
 * The CloudWatch log group for a pipeline — provides narrow grant methods for specific access patterns.
 * Extends `logs.LogGroup` so consumers can pass it directly as a CDK Lambda's logGroup property.
 */
export interface IPipelineLogGroup extends logs.ILogGroup {
  /**
   * Grants exactly `logs:FilterLogEvents` on this log group (e.g., for querying logs during
   * recovery/troubleshooting). Scoped to this log group's ARN — no conditions.
   */
  grantFilterEvents(grantee: iam.IGrantable): iam.Grant;
}

/**
 * The CloudWatch log group for a pipeline — provides narrow grant methods for specific access patterns.
 * Extends `logs.LogGroup` so consumers can pass it directly as a CDK Lambda's logGroup property.
 * The inherited `grantWrite()` from `logs.LogGroup` grants exactly `logs:CreateLogStream` + `logs:PutLogEvents`,
 * which is what consumers need; no separate `grantWrite` method is added here.
 */
export class PipelineLogGroup extends logs.LogGroup implements IPipelineLogGroup {
  /**
   * Get-or-create the one shared CloudWatch log group for a given pipeline, within the Stack that
   * `scope` belongs to, created lazily by whichever `GoLambda`/`TypeScriptLambda` wrapper asks for a
   * given pipeline first.
   *
   * Name: `/serverlessinbox/<stackName>/<pipeline>-<stackGuidPrefix>`. Derived from (stack, pipeline)
   * — never from a construct's logical id — so a construct moving in the tree doesn't rename the
   * group, and the GUID suffix keeps a delete-and-recreate of the stack from colliding with a
   * `RETAIN`ed orphan of the same name.
   *
   * Returns the same PipelineLogGroup instance for repeated calls with the same (stack, pipeline) pair.
   */
  static getOrCreate(scope: Construct, pipeline: Pipeline): IPipelineLogGroup {
    const stack = cdk.Stack.of(scope);
    const shared = getOrCreateSharedGroup(stack);
    const childId = `log-group-${pipeline}`;
    const existing = shared.node.tryFindChild(childId);
    if (existing) {
      if (!(existing instanceof PipelineLogGroup)) {
        throw new Error(
          `Expected PipelineLogGroup at ${childId}, but found ${existing.constructor.name}. ` +
          'This indicates a construct tree collision — a different resource was placed at this location.'
        );
      }
      return existing;
    }

    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const guidPrefix = Fn.select(0, Fn.split('-', stackGuid));
    const logGroup = new PipelineLogGroup(shared, childId, {
      logGroupName: Fn.join('', ['/serverlessinbox/', Aws.STACK_NAME, '/', pipeline, '-', guidPrefix]),
      retention: PIPELINE_RETENTION[pipeline],
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    return logGroup;
  }

  grantFilterEvents(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['logs:FilterLogEvents'],
      resourceArns: [this.logGroupArn],
    });
  }
}
