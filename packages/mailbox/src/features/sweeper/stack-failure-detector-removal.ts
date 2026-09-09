import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { StackFailureDetectorSweepTargets } from '../stack-failure-detection';
import { withTargetPresenceGuard } from './removal';
import type { IResourceRemoval } from './removal';

export interface StackFailureDetectorRemovalProps extends StackFailureDetectorSweepTargets {
  /**
   * How long to hold this removal back before its first attempt, giving the detector time to
   * observe a terminal stack-failure event and upload diagnostics before the sweeper tears it down.
   * Default: 15 minutes.
   */
  readonly gracePeriod?: Duration;
}

const DEFAULT_GRACE_PERIOD = Duration.minutes(15);

/**
 * Registers the stack-failure detector's rule, function and role as ONE removal — grouped
 * because they are torn down together, in a single worker invocation, after a single grace-period
 * wait, rather than as three independent registrations. See
 * `ts-lambdas/resource-sweeper/targets/stack-failure-detector.ts` for the sub-handler.
 *
 * The grace period is a real Wait step this removal contributes to the state machine — not a flag
 * threaded through the worker's decision logic (that was the pre-rework design; see
 * `StackFailureDetectorRemovalInput`'s doc for why it no longer needs one).
 *
 * `role` is a real `iam.IRole` reference, so its IAM grants are scoped to that role's own ARN — no
 * name-prefix wildcard is needed here (iam:DeleteRole/DeleteRolePolicy don't support
 * `aws:ResourceTag` at all, which is why a wildcard was needed before this construct could see the
 * detector's real role).
 */
export class StackFailureDetectorRemoval extends Construct implements IResourceRemoval {
  readonly id = 'detector';
  private readonly targets: StackFailureDetectorSweepTargets;
  private readonly gracePeriod: Duration;

  constructor(scope: Construct, id: string, props: StackFailureDetectorRemovalProps) {
    super(scope, id);
    this.targets = props;
    this.gracePeriod = props.gracePeriod ?? DEFAULT_GRACE_PERIOD;
  }

  grantStatements(): iam.PolicyStatement[] {
    const rootStackTagKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`;
    return [
      // EventBridge rule operations. Rules support aws:ResourceTag on both read and delete actions
      // (verified against the IAM service reference's rule-on-default-event-bus resource type), so
      // this is a wildcard scoped by ownership tag, not a per-target ARN: rules here are auto-named.
      new iam.PolicyStatement({
        actions: ['events:DescribeRule', 'events:ListTargetsByRule', 'events:ListTagsForResource'],
        resources: [`arn:aws:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:rule/*`],
      }),
      new iam.PolicyStatement({
        actions: ['events:RemoveTargets', 'events:DeleteRule'],
        resources: [`arn:aws:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:rule/*`],
        conditions: { StringEquals: { [rootStackTagKey]: Aws.STACK_NAME } },
      }),
      // Detector Lambda function operations — the stack's OWN region (not us-east-1): the
      // stack-failure detector is a regular regional Lambda, not Lambda@Edge.
      new iam.PolicyStatement({
        actions: ['lambda:GetFunction'],
        resources: [`arn:aws:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:*`],
      }),
      new iam.PolicyStatement({
        actions: ['lambda:DeleteFunction'],
        resources: [`arn:aws:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:*`],
        conditions: { StringEquals: { [rootStackTagKey]: Aws.STACK_NAME } },
      }),
      // Detector IAM role operations. iam:DeleteRole/DeleteRolePolicy don't support
      // aws:ResourceTag at all (verified against the IAM service reference: their only
      // ActionConditionKeys entry is iam:PermissionsBoundary) — scoped instead to this removal's
      // own role ARN, a real token from the CDK object passed in.
      new iam.PolicyStatement({
        actions: ['iam:ListRoleTags'],
        resources: [this.targets.role.roleArn],
      }),
      new iam.PolicyStatement({
        actions: ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
        resources: [this.targets.role.roleArn],
      }),
    ];
  }

  crProperties(): Record<string, string> {
    return {
      ruleArn: this.targets.rule.ruleArn,
      ruleTargetId: this.targets.ruleTargetId,
      detectorFnArn: this.targets.detector.functionArn,
      detectorRoleArn: this.targets.role.roleArn,
      detectorRolePolicyName: this.targets.detectorRolePolicyName,
    };
  }

  buildChain(worker: lambda.IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const rootStackName = Stack.of(this).stackName;
    const targetPath = `$.toSweep.${this.id}`;

    const graceWait = new sfn.Wait(this, 'DetectorGraceWait', {
      time: sfn.WaitTime.duration(this.gracePeriod),
    });

    const invoke = new tasks.LambdaInvoke(this, 'DetectorInvoke', {
      lambdaFunction: worker,
      payloadResponseOnly: true,
      resultPath: '$.workerResult',
      payload: sfn.TaskInput.fromObject({
        removalType: 'detector',
        ruleArn: sfn.JsonPath.stringAt(`${targetPath}.ruleArn`),
        ruleTargetId: sfn.JsonPath.stringAt(`${targetPath}.ruleTargetId`),
        detectorFnArn: sfn.JsonPath.stringAt(`${targetPath}.detectorFnArn`),
        detectorRoleArn: sfn.JsonPath.stringAt(`${targetPath}.detectorRoleArn`),
        detectorRolePolicyName: sfn.JsonPath.stringAt(`${targetPath}.detectorRolePolicyName`),
        rootStackName,
      }),
      retryOnServiceExceptions: true,
    });

    const wait = new sfn.Wait(this, 'DetectorWaitRetry', { time: sfn.WaitTime.duration(retryInterval) });

    const choice = new sfn.Choice(this, 'DetectorStatusChoice')
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'SUCCESS'), onSuccess)
      .when(sfn.Condition.stringEquals('$.workerResult.status', 'RETRY'), wait)
      .otherwise(new sfn.Fail(this, 'DetectorFailed', { error: 'WorkerFailed', cause: 'Detector removal failed' }));

    graceWait.next(invoke);
    invoke.next(choice);
    wait.next(invoke);

    return withTargetPresenceGuard(this, 'DetectorHasTarget', this.id, graceWait, onSuccess);
  }
}
