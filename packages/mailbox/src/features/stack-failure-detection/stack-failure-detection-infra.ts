import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { Fn, Stack, Aws, RemovalPolicy } from 'aws-cdk-lib';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { getOrCreatePipelineLogGroup } from '@serverlessinbox/mailbox-cdk-shared';
import { StackFailureDetectorLambda } from '../../lambdas';

export interface StackFailureDetectionInfraProps {
  readonly artifactResolver: ICdkArtifactEngine;
}

const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';
const RULE_TARGET_ID = 'Target0';

/**
 * Core stack-failure-detection infrastructure: retained EventBridge rule, retained detector Lambda +
 * role. This construct has no knowledge of the resource sweeper at all — it only builds the
 * detector and exposes its retained resources (`rule`, `role`, plus `ruleTargetId`/
 * `detectorRolePolicyName`) as public readonly properties. The composing stack (`mailbox.ts`) reads
 * those and registers a `StackFailureDetectorRemoval` on the shared sweeper, the same way the ACM cert / edge
 * Lambda targets already are. The reference only ever runs one way — sweeper knows about the
 * detector's resources; the detector knows nothing about the sweeper — so there is no
 * circular dependency between the two constructs.
 *
 * `detectorFunctionName` and `detectorRoleName` stay pinned (GUID-suffixed, deterministic), each for
 * an independent, non-cycle reason:
 * - `detectorFunctionName`: the detector Lambda wrapper's `functionName` prop is required, not
 *   optional — relaxing that is outside the scope of this fix.
 * - `detectorRoleName`: the sweeper's worker IAM cannot scope `iam:DeleteRole`/`iam:DeleteRolePolicy`
 *   by `aws:ResourceTag` — that condition key isn't supported for those two actions at all (verified
 *   against the IAM service reference) — so the sweeper scopes its grant to a deterministic name
 *   prefix instead (see `sweeper-infra.ts`). An auto-named role would leave that grant unscoped.
 *
 * The EventBridge rule is deliberately NOT given an explicit name: its only prior reason for one was
 * to let this construct build the rule's ARN as a plain `stack.formatArn()` string and hand it to the
 * detector's own environment, breaking a construction-order cycle that existed only because the
 * detector used to call back into the sweeper. That cycle is gone along with the callback — the
 * sweeper reads `this.rule.ruleArn` (a real token) from the outside, after this construct is fully
 * built, which is an ordinary forward reference, not a cycle. Letting CDK auto-name the rule also
 * means a future construct-tree move can never collide with a RETAIN'd orphan of the old name (see
 * the "Explicit physical names + RETAIN" note in the CDK construct-pattern skill) — the sweeper's own
 * rule-delete grant is already scoped by ownership tag, not by name, so nothing depends on it.
 *
 * All pinned names use only the first 8 characters of the stack GUID
 * (`Fn.select(0, Fn.split('-', stackGuid))`), not the full 36-character UUID — the same precedent as
 * `getOrCreatePipelineLogGroup` in `mailbox-cdk-shared/src/pipeline-log-groups.ts`. See
 * `__tests__/stack-failure-detection-infra.test.ts` for the length regression coverage.
 */
export class StackFailureDetectionInfra extends Construct {
  readonly detector: StackFailureDetectorLambda;
  readonly rule: events.Rule;
  /** Real interface for the retained detector role — a sweep target, not consumed by the detector. */
  readonly role: iam.IRole;

  /** Target ID to remove from the rule before it can be deleted (see `resource-sweeper/targets/stack-failure-detector.ts`). */
  readonly ruleTargetId: string;
  /** Name of the inline policy attached to the detector role, deleted before the role itself. */
  readonly detectorRolePolicyName: string;

  constructor(scope: Construct, id: string, props: StackFailureDetectionInfraProps) {
    super(scope, id);

    // Fixed for a stack's lifetime, differs after destroy+redeploy — keeps RETAIN'd orphans from
    // colliding with the resources of a freshly (re)created stack. Only the first segment (8 hex
    // chars, fixed by the UUID format) is used — see class doc for why.
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const guidPrefix = Fn.select(0, Fn.split('-', stackGuid));

    // Makes names unique per construct position, so a future move doesn't collide with the old name.
    const parentGroupId = (this.node.scope as any)?.node?.id ?? 'default';

    const detectorFunctionName = Fn.join('', ['mailbox-diag-fn-', parentGroupId, '-', guidPrefix]);
    const detectorRoleName = Fn.join('', ['mailbox-diag-role-', parentGroupId, '-', guidPrefix]);

    const stack = Stack.of(this);

    // Detector execution role — pinned name (see class doc for why).
    const detectorRole = new iam.Role(this, 'detector-role', {
      roleName: detectorRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    (detectorRole.node.defaultChild as any)?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Detector Lambda — retained. Function name stays pinned only because the wrapper's `functionName`
    // prop is required (see class doc). Takes no sweeper-related props at all.
    this.detector = new StackFailureDetectorLambda(this, 'detector', {
      artifactResolver: props.artifactResolver,
      role: detectorRole,
      functionName: detectorFunctionName,
    });
    (this.detector.node.defaultChild as any)?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // EventBridge rule — auto-named (see class doc for why this is no longer pinned). Matches AWS's
    // native STACK-level status-change event (a different detail-type from `CloudFormation Resource
    // Status Change`, despite overlapping status spellings — do not conflate the two) on the root
    // stack only, for exactly the five terminal failure statuses below. Each fires once per failed
    // stack operation, which is what lets the detector carry no de-duplication or state.
    // CREATE_FAILED/UPDATE_FAILED are deliberately excluded: they are only terminal when rollback is
    // disabled (not the default), and whether they also fire transiently under default rollback is
    // unconfirmed — see subplan 01. Retained so DELETE_FAILED stays observable after the root stack
    // is gone.
    this.rule = new events.Rule(this, 'rule', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [stack.stackId],
          'status-details': {
            status: [
              'ROLLBACK_COMPLETE',
              'ROLLBACK_FAILED',
              'UPDATE_ROLLBACK_COMPLETE',
              'UPDATE_ROLLBACK_FAILED',
              'DELETE_FAILED',
            ],
          },
        },
      },
    });
    this.rule.addTarget(new targets.LambdaFunction(this.detector));
    (this.rule.node.defaultChild as any)?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Detector's own least-privilege policy:
    // - CloudFormation reads scoped to the root stack's own ARN only (Aws.STACK_ID is already the
    //   full stack ARN) — never a stack/${Aws.STACK_NAME}-*/* wildcard.
    // - logs:FilterLogEvents on the exact `infra` pipeline log group ARN (the same shared log group
    //   the detector itself logs to, via `getOrCreatePipelineLogGroup` — reused here rather than
    //   re-derived, so the ARN can never drift from the real group's name).
    // - logs:CreateLogStream/PutLogEvents on that same ARN: plumbing so the detector can emit its own
    //   runtime logs — needed because an explicit `role:` was passed to the Lambda, which skips the
    //   AWSLambdaBasicExecutionRole managed-policy attachment `Function` would otherwise add.
    // - No sweeper permissions of any kind — the detector never starts or touches the sweeper.
    // - No s3:PutObject: the upload uses a presigned POST, which carries its own credential.
    const infraLogGroupArn = getOrCreatePipelineLogGroup(this, 'infra').logGroupArn;
    const detectorPolicy = new iam.Policy(this, 'detector-policy', {
      policyName: DETECTOR_POLICY_NAME,
      statements: [
        new iam.PolicyStatement({
          actions: ['cloudformation:DescribeStackEvents', 'cloudformation:DescribeStacks'],
          resources: [Aws.STACK_ID],
        }),
        new iam.PolicyStatement({
          actions: ['logs:FilterLogEvents'],
          resources: [infraLogGroupArn],
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [infraLogGroupArn],
        }),
      ],
    });
    detectorPolicy.attachToRole(detectorRole);
    // Retained alongside the RETAIN'd role: the detector must keep working (including after root
    // stack deletion, for the DELETE_FAILED case) until the sweeper deletes it.
    (detectorPolicy.node.defaultChild as any)?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Expose real tokens (not hand-built ARN strings) for the composing stack to register as sweep
    // targets — an ordinary forward reference read from outside this construct, after it is fully
    // built. No cycle: this construct never reads anything back from the sweeper.
    this.role = detectorRole;
    this.ruleTargetId = RULE_TARGET_ID;
    this.detectorRolePolicyName = DETECTOR_POLICY_NAME;
  }
}
