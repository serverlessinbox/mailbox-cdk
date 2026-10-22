import { StackIdentity, rootStackResourceTagConditions } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStackConditions }                      from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                          from 'aws-cdk-lib/aws-iam';
import * as lambda                                       from 'aws-cdk-lib/aws-lambda';
import * as sfn                                          from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration, Stack }                          from 'aws-cdk-lib';
import { Construct }                                     from 'constructs';

import type {
  StackFailureDetectorRemovalTarget,
  StackFailureDetectorWorkerInput,
} from '../../../runtime/resource-sweeper/removal';
import type { StackFailureDetectorSweepTargets }                      from '../stack-failure-detection';

import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard } from './removal';
import type { IResourceRemoval }                                      from './removal';

export interface StackFailureDetectorRemovalProps extends StackFailureDetectorSweepTargets {
  /**
   * How long to hold this removal back before its first attempt, giving the detector time to
   * observe a terminal stack-failure event and upload diagnostics before the sweeper tears it down.
   * Default: 15 minutes.
   */
  readonly gracePeriod?: Duration;
}

/**
 * Registers the stack-failure detector's rule, function and role as ONE removal — grouped
 * because they are torn down together, after a single grace-period wait, rather than as three
 * independent registrations.
 *
 * The grace period is a Wait step this removal contributes to the state machine.
 *
 * `role` is an `iam.IRole` reference, so its IAM grants are scoped to that role's own ARN
 * (iam:DeleteRole/DeleteRolePolicy don't support `aws:ResourceTag` at all).
 */
export class StackFailureDetectorRemoval extends Construct implements IResourceRemoval<'detector'> {
  private static readonly defaultGracePeriod = Duration.minutes(15);
  private static readonly anyRuleArn = `arn:aws:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:rule/*`;
  private static readonly anyRegionalFunctionArn = `arn:aws:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:*`;

  readonly id = 'detector';
  private readonly targets: StackFailureDetectorSweepTargets;
  private readonly gracePeriod: Duration;

  constructor(scope: Construct, id: string, props: StackFailureDetectorRemovalProps) {
    super(scope, id);
    this.targets     = props;
    this.gracePeriod = props.gracePeriod ?? StackFailureDetectorRemoval.defaultGracePeriod;
  }

  public grantStatements(): iam.PolicyStatement[] {
    return [
      this.grantRuleInspection(),
      ...this.grantRuleDeletion(),
      this.grantDetectorFunctionInspection(),
      ...this.grantDetectorFunctionDeletion(),
      this.grantDetectorRoleInspection(),
      this.grantDetectorRoleDeletion(),
    ];
  }

  public crProperties(): StackFailureDetectorRemovalTarget {
    return {
      ruleArn:                this.targets.stackFailedEvent.ruleArn,
      ruleTargetId:           this.targets.stackFailedEvent.ruleTargetId,
      detectorFnArn:          this.targets.detector.functionArn,
      detectorRoleArn:        this.targets.role.roleArn,
      detectorRolePolicyName: this.targets.detectorRolePolicyName,
    };
  }

  public buildChain(worker: lambda.IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const payload: StackFailureDetectorWorkerInput = {
      removalType:            'detector',
      ruleArn:                targetField(this.id, 'ruleArn'),
      ruleTargetId:           targetField(this.id, 'ruleTargetId'),
      detectorFnArn:          targetField(this.id, 'detectorFnArn'),
      detectorRoleArn:        targetField(this.id, 'detectorRoleArn'),
      detectorRolePolicyName: targetField(this.id, 'detectorRolePolicyName'),
      rootStackName:          Stack.of(this).stackName,
      rootStackId:            StackIdentity.guid,
    };

    const retryLoop = buildWorkerRetryLoop(this, 'Detector', {
      worker,
      payload,
      retryInterval,
      onSuccess,
      failureCause: 'Detector removal failed',
      gracePeriod:  this.gracePeriod,
    });

    return withTargetPresenceGuard(this, 'DetectorHasTarget', this.id, retryLoop, onSuccess);
  }

  /** Rules are auto-named, so there is no per-rule ARN to scope a read to; it carries no condition. */
  private grantRuleInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['events:DescribeRule', 'events:ListTargetsByRule', 'events:ListTagsForResource'],
      resources: [StackFailureDetectorRemoval.anyRuleArn],
    });
  }

  /** Rules are auto-named and support `aws:ResourceTag` on delete actions, so the root-stack tags are the scope. */
  private grantRuleDeletion(): iam.PolicyStatement[] {
    return this.rootStackConditions().map(
      (conditions) =>
        new iam.PolicyStatement({
          actions:   ['events:RemoveTargets', 'events:DeleteRule'],
          resources: [StackFailureDetectorRemoval.anyRuleArn],
          conditions,
        }),
    );
  }

  /** The detector is a regular regional function, not Lambda@Edge, so the scope is the stack's own region. */
  private grantDetectorFunctionInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['lambda:GetFunction'],
      resources: [StackFailureDetectorRemoval.anyRegionalFunctionArn],
    });
  }

  private grantDetectorFunctionDeletion(): iam.PolicyStatement[] {
    return this.rootStackConditions().map(
      (conditions) =>
        new iam.PolicyStatement({
          actions:   ['lambda:DeleteFunction'],
          resources: [StackFailureDetectorRemoval.anyRegionalFunctionArn],
          conditions,
        }),
    );
  }

  /** Scoped to the role's own ARN: `iam:DeleteRole` and `iam:DeleteRolePolicy` take no `aws:ResourceTag` condition. */
  private grantDetectorRoleInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:ListRoleTags'],
      resources: [this.targets.role.roleArn],
    });
  }

  private grantDetectorRoleDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
      resources: [this.targets.role.roleArn],
    });
  }

  private rootStackConditions(): readonly RootStackConditions[] {
    return rootStackResourceTagConditions({ name: Aws.STACK_NAME, id: StackIdentity.guid });
  }
}
