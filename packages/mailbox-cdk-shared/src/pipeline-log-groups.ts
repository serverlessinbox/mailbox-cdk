import * as cdk from 'aws-cdk-lib';
import { Aws, Fn } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
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
 * Get-or-create the one shared CloudWatch log group for a given pipeline, within the Stack that
 * `scope` belongs to, created lazily by whichever `GoLambda`/`TypeScriptLambda` wrapper asks for a
 * given pipeline first.
 *
 * Name: `/serverlessinbox/<stackName>/<pipeline>-<stackGuidPrefix>`. Derived from (stack, pipeline)
 * — never from a construct's logical id — so a construct moving in the tree doesn't rename the
 * group, and the GUID suffix keeps a delete-and-recreate of the stack from colliding with a
 * `RETAIN`ed orphan of the same name.
 */
export function getOrCreatePipelineLogGroup(scope: Construct, pipeline: Pipeline): logs.ILogGroup {
  const stack = cdk.Stack.of(scope);
  const shared = getOrCreateSharedGroup(stack);
  const childId = `log-group-${pipeline}`;
  const existing = shared.node.tryFindChild(childId);
  if (existing) return existing as logs.LogGroup;

  const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
  const guidPrefix = Fn.select(0, Fn.split('-', stackGuid));
  const logGroup = new logs.LogGroup(shared, childId, {
    logGroupName: Fn.join('', ['/serverlessinbox/', Aws.STACK_NAME, '/', pipeline, '-', guidPrefix]),
    retention: PIPELINE_RETENTION[pipeline],
    removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
  });

  return logGroup;
}
