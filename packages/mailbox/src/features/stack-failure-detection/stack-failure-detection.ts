import * as cdk from 'aws-cdk-lib';
import { Fn } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { StackFailureDetectionInfra } from './stack-failure-detection-infra';

/**
 * Consent mode for the stack-failure detector.
 */
export enum SendStackFailuresMode {
  /** Detector infrastructure is provisioned. */
  ENABLED = 'enabled',
  /** No detector infrastructure is provisioned at all. */
  DISABLED = 'disabled',
}

export interface StackFailureDetectionProps {
  /** Consent mode — `disabled` synthesizes zero detector resources. */
  readonly mode: SendStackFailuresMode;
  /** Artifact resolver for the detector Lambda's code resolution. */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * The detector's retained resources, all-or-nothing: the whole subtree is gated by one
 * `CfnCondition` (see `StackFailureDetection`), so these five values are either all built together
 * or all absent together. Owned by the detection feature — the sweeper depends on this shape, never
 * the other way around — so a consumer (e.g. `StackFailureDetectorRemoval`) can register the detector
 * as a single sweep target instead of checking five separate optional properties by hand.
 */
export interface StackFailureDetectorSweepTargets {
  /** The retained rule itself — a sweep target. */
  readonly rule: events.IRule;
  /** The retained detector function itself — a sweep target. */
  readonly detector: lambda.IFunction;
  /** The retained detector role itself — a sweep target. */
  readonly role: iam.IRole;
  /** Target ID to remove from the rule before it can be deleted. */
  readonly ruleTargetId: string;
  /** Name of the inline policy on the detector role. */
  readonly detectorRolePolicyName: string;
}

/**
 * Customer-side stack-failure diagnostics detector (subplan 01 of the stack-failure-detection feature).
 *
 * Watches the root stack's own `CloudFormation Stack Status Change` events for exactly five terminal
 * failure statuses (`ROLLBACK_COMPLETE`, `ROLLBACK_FAILED`, `UPDATE_ROLLBACK_COMPLETE`,
 * `UPDATE_ROLLBACK_FAILED`, `DELETE_FAILED`) via a retained EventBridge rule, and — with consent —
 * uploads raw `DescribeStackEvents` output plus the shared `infra` log group to the vendor.
 * The rule, detector Lambda and its role are retained so `DELETE_FAILED` stays observable even if the
 * root stack itself is torn down. This construct has no knowledge of the resource sweeper: it only
 * exposes its retained resources as one `sweepTargets` value (`undefined` when `disabled`) for the
 * composing stack to register on the sweeper (see `stack-failure-detection-infra.ts` and
 * `mailbox.ts`).
 *
 * `disabled` provisions none of this: the whole subtree is gated by a `CfnCondition` plus
 * `GateOnConditionAspect`, following the `SupportAddon` precedent — never a runtime early-return.
 */
export class StackFailureDetection extends Construct {
  /** The detector's retained resources, all present together or all absent (`disabled`). */
  readonly sweepTargets?: StackFailureDetectorSweepTargets;

  constructor(scope: Construct, id: string, props: StackFailureDetectionProps) {
    super(scope, id);

    // A literal DISABLED is the only value that fully disables the detector at synth time — an
    // unresolved CFN-parameter token falls through to the gated path below.
    const fullyDisabled =
      props.mode === SendStackFailuresMode.DISABLED && !cdk.Token.isUnresolved(props.mode);

    if (fullyDisabled) {
      return;
    }

    // Build condition: SendStackFailures == ENABLED. Create all resources unconditionally in the
    // template; GateOnConditionAspect stamps the condition onto every one of them, so they produce
    // zero live resources when the condition evaluates to false at deploy.
    const condition = new cdk.CfnCondition(this, 'IsEnabled', {
      expression: Fn.conditionEquals(props.mode, SendStackFailuresMode.ENABLED),
    });

    const infra = new StackFailureDetectionInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
    });
    this.sweepTargets = {
      rule: infra.rule,
      detector: infra.detector,
      role: infra.role,
      ruleTargetId: infra.ruleTargetId,
      detectorRolePolicyName: infra.detectorRolePolicyName,
    };

    cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
  }
}
