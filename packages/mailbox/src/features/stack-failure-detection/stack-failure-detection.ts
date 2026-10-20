import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import { GateOnConditionAspect }      from '@serverlessinbox/mailbox-cdk-shared';
import * as events                    from 'aws-cdk-lib/aws-events';
import * as iam                       from 'aws-cdk-lib/aws-iam';
import * as lambda                    from 'aws-cdk-lib/aws-lambda';
import * as cdk                       from 'aws-cdk-lib';
import { Fn }                         from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import { StackFailureDetectionInfra } from './stack-failure-detection-infra';

export enum SendStackFailuresMode {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

export interface StackFailureDetectionProps {
  readonly mode: SendStackFailuresMode;
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor license API, resolved by the caller. */
  readonly vendorAccountIds: string[];
}

/**
 * All fields are either all present or all absent (`undefined` when `disabled`) — never check one
 * without the others.
 */
export interface StackFailureDetectorSweepTargets {
  readonly rule: events.IRule;
  readonly detector: lambda.IFunction;
  readonly role: iam.IRole;
  readonly ruleTargetId: string;
  readonly detectorRolePolicyName: string;
}

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
      rule: infra.rule,
      detector: infra.detector,
      role: infra.role,
      ruleTargetId: infra.ruleTargetId,
      detectorRolePolicyName: infra.detectorRolePolicyName,
    };

    cdk.Aspects.of(this).add(new GateOnConditionAspect(condition));
  }
}
