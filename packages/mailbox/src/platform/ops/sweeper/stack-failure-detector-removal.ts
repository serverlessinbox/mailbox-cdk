import { StackIdentity, rootStackResourceTagConditions } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStackConditions }                      from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                          from 'aws-cdk-lib/aws-iam';
import * as lambda                                       from 'aws-cdk-lib/aws-lambda';
import * as sfn                                          from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration }                                 from 'aws-cdk-lib';
import { Construct }                                     from 'constructs';

import type {
  StackFailureDetectorRemovalTarget,
  StackFailureDetectorWorkerInput,
} from '../../../runtime/resource-sweeper/removal';
import { DETECTOR_ROLE_NAME_PREFIX }                                  from '../stack-failure-detection-infra';
import type { StackFailureDetectorSweepTargets }                      from '../stack-failure-detection';

import { buildWorkerRetryLoop, targetAt, withTargetPresenceGuard }    from './removal';
import type { IResourceRemoval, WorkerPayloadTemplate }               from './removal';

/** Inputs of {@link StackFailureDetectorRemoval}: the detector's sweep targets and the grace period before they are swept. */
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
 * because they share a single grace-period wait, rather than being three independent
 * registrations. On an update only the parts whose own identity changed are swept.
 *
 * The grace period is a Wait step this removal contributes to the state machine.
 *
 * The role's IAM grants are scoped by name pattern to every detector role of this install, not to the
 * current role's ARN: iam:DeleteRole/DeleteRolePolicy don't support `aws:ResourceTag` at all, and an update
 * that moves the detector gives its role a new name while the old role still awaits its sweep.
 */
export class StackFailureDetectorRemoval extends Construct implements IResourceRemoval<'detector'> {
  private static readonly defaultGracePeriod = Duration.minutes(15);
  private static readonly anyRuleArn = `arn:${Aws.PARTITION}:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:rule/*`;
  private static readonly anyRegionalFunctionArn = `arn:${Aws.PARTITION}:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:*`;

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
    const payload: WorkerPayloadTemplate<StackFailureDetectorWorkerInput> = {
      removalType:   'detector',
      target:        targetAt(this.id),
      rootStackName: Aws.STACK_NAME,
      rootStackId:   StackIdentity.guid,
    };

    const retryLoop = buildWorkerRetryLoop(this, 'detector', {
      worker,
      payload,
      retryInterval,
      onSuccess,
      failureCause: 'Detector removal failed',
      gracePeriod:  this.gracePeriod,
    });

    return withTargetPresenceGuard(this, 'detector-has-target', this.id, retryLoop, onSuccess);
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

  /** Scoped by name pattern: `iam:DeleteRole` and `iam:DeleteRolePolicy` take no `aws:ResourceTag` condition. */
  private grantDetectorRoleInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:ListRoleTags'],
      resources: [this.detectorRoleArnPattern()],
    });
  }

  private grantDetectorRoleDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
      resources: [this.detectorRoleArnPattern()],
    });
  }

  /**
   * Every detector role this install has had: the role name is the role prefix, a position hash that changes
   * when the detector moves, then the install's guid prefix. A pattern admits a renamed role of this install
   * and no role of another install or another kind.
   */
  private detectorRoleArnPattern(): string {
    return `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/${DETECTOR_ROLE_NAME_PREFIX}*-${StackIdentity.guidPrefix}`;
  }

  private rootStackConditions(): readonly RootStackConditions[] {
    return rootStackResourceTagConditions({ name: Aws.STACK_NAME, id: StackIdentity.guid });
  }
}
