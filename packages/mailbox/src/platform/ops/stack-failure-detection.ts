import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import { GateOnConditionAspect }      from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                       from 'aws-cdk-lib/aws-iam';
import * as lambda                    from 'aws-cdk-lib/aws-lambda';
import * as cdk                       from 'aws-cdk-lib';
import { Fn }                         from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import type { IStackFailedEvent }     from '../../resources/events/stack-failed-event';

import { StackFailureDetectionInfra } from './stack-failure-detection-infra';

/**
 * Whether the stack watches its own terminal stack-status events and uploads diagnostics about a failed
 * stack operation to the vendor's stack-failure API. Reporting is a consent decision of the operator:
 * choose {@link SendStackFailuresMode.DISABLED} when the stack must not send such reports.
 */
export enum SendStackFailuresMode {
  /** The stack provisions the detector (a Lambda, its role and an event rule), which reports a failed stack operation. */
  ENABLED = 'enabled',
  /** The stack provisions no detector resources, so no failure report is sent. */
  DISABLED = 'disabled',
}

/** Inputs of {@link StackFailureDetection}. */
export interface StackFailureDetectionProps {
  readonly mode:             SendStackFailuresMode;
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor license API, resolved by the caller. */
  readonly vendorAccountIds: string[];
}

/**
 * All fields are either all present or all absent (`undefined` when `disabled`) — never check one
 * without the others.
 */
export interface StackFailureDetectorSweepTargets {
  readonly stackFailedEvent:       IStackFailedEvent;
  readonly detector:               lambda.IFunction;
  readonly role:                   iam.IRole;
  readonly detectorRolePolicyName: string;
}

/**
 * The stack-failure detector, provisioned only when {@link SendStackFailuresMode.ENABLED}. It exposes the
 * rule, function and role it creates as `sweepTargets`, which is `undefined` when the mode is the literal DISABLED.
 */
export class StackFailureDetection extends Construct {
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

    const condition = new cdk.CfnCondition(this, 'IsEnabled', {
      expression: Fn.conditionEquals(props.mode, SendStackFailuresMode.ENABLED),
    });

    const infra       = new StackFailureDetectionInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      vendorAccountIds: props.vendorAccountIds,
    });
    this.sweepTargets = {
      stackFailedEvent:       infra.stackFailedEvent,
      detector:               infra.detector,
      role:                   infra.role,
      detectorRolePolicyName: infra.detectorRolePolicyName,
    };

    cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
  }
}
