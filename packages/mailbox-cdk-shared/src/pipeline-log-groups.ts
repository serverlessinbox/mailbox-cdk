import * as cdk from 'aws-cdk-lib';
import { Aws, Fn } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct, IConstruct } from 'constructs';
import { StackIdentity } from './naming/stack-identity';
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
 * Removal policy, settable per pipeline. The infra group is RETAIN on every operation: the stack-failure
 * detector writes to it and reads it as its upload payload, and it must still exist when the detector
 * runs after a failed first create, which RETAIN_ON_UPDATE_OR_DELETE does not preserve.
 */
const PIPELINE_REMOVAL_POLICY: Record<Pipeline, cdk.RemovalPolicy> = {
  infra: cdk.RemovalPolicy.RETAIN,
  'mail-in': cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
  'mail-out': cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
  jmap: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
  admin: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
  audit: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
};

/** The CloudWatch log group of a pipeline: a `logs.ILogGroup` plus one narrow read grant. */
export interface IPipelineLogGroup extends logs.ILogGroup {
  /**
   * Grants exactly `logs:FilterLogEvents` on this log group (e.g., for querying logs during
   * recovery/troubleshooting). Scoped to this log group's ARN — no conditions.
   */
  grantFilterEvents(grantee: iam.IGrantable): iam.Grant;
}

/**
 * The CloudWatch log group of a pipeline, one per (stack, pipeline), created through `getOrCreate`.
 * Writing needs no method of its own: the inherited `grantWrite()` grants exactly
 * `logs:CreateLogStream` + `logs:PutLogEvents`.
 */
export class PipelineLogGroup extends logs.LogGroup implements IPipelineLogGroup {
  /**
   * Get-or-create the one shared CloudWatch log group for a given pipeline, within the Stack that
   * `scope` belongs to.
   *
   * Name: `/serverlessinbox/<stackName>/<pipeline>-<stackGuidPrefix>`. Derived from (stack, pipeline)
   * — never from a construct's logical id — so a construct moving in the tree doesn't rename the
   * group, and the GUID suffix keeps a delete-and-recreate of the stack from colliding with a
   * `RETAIN`ed orphan of the same name.
   *
   * Returns the same PipelineLogGroup instance for repeated calls with the same (stack, pipeline) pair.
   */
  static getOrCreate(scope: Construct, pipeline: Pipeline): IPipelineLogGroup {
    const shared = getOrCreateSharedGroup(cdk.Stack.of(scope));
    const childId = `log-group-${pipeline}`;

    const existing = shared.node.tryFindChild(childId);
    if (existing) {
      return PipelineLogGroup.requirePipelineLogGroup(existing, childId);
    }

    return new PipelineLogGroup(shared, childId, {
      logGroupName: PipelineLogGroup.logGroupNameFor(pipeline),
      retention: PIPELINE_RETENTION[pipeline],
      removalPolicy: PIPELINE_REMOVAL_POLICY[pipeline],
    });
  }

  grantFilterEvents(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['logs:FilterLogEvents'],
      resourceArns: [this.logGroupArn],
    });
  }

  private static requirePipelineLogGroup(existing: IConstruct, childId: string): PipelineLogGroup {
    if (!(existing instanceof PipelineLogGroup)) {
      throw new Error(
        `Expected PipelineLogGroup at ${childId}, but found ${existing.constructor.name}. ` +
        'This indicates a construct tree collision — a different resource was placed at this location.'
      );
    }

    return existing;
  }

  private static logGroupNameFor(pipeline: Pipeline): string {
    return Fn.join('', ['/serverlessinbox/', Aws.STACK_NAME, '/', pipeline, '-', StackIdentity.guidPrefix]);
  }
}
