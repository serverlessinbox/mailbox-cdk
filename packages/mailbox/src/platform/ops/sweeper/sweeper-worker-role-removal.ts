import { StackIdentity }                                                  from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                                           from 'aws-cdk-lib/aws-iam';
import * as lambda                                                        from 'aws-cdk-lib/aws-lambda';
import * as sfn                                                           from 'aws-cdk-lib/aws-stepfunctions';
import { Aws, Duration }                                                  from 'aws-cdk-lib';
import { Construct }                                                      from 'constructs';

import type { RemovalTargets, SweeperRoleWorkerInput }                    from '../../../runtime/resource-sweeper/removal';

import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard }     from './removal';
import type { IResourceRemoval, WorkerPayloadTemplate }                   from './removal';
import { SWEEPER_WORKER_ROLE_NAME_PREFIX }                                from './sweeper-worker-role-name';

/** Inputs of {@link SweeperWorkerRoleRemoval}: the ARN and inline policy name of the sweeper's worker role. */
export interface SweeperWorkerRoleRemovalProps {
  readonly workerRoleArn:        string;
  readonly workerRolePolicyName: string;
}

/**
 * Registers the sweeper's own worker IAM role as a removal, so the role an earlier position of the sweeper left
 * behind is swept when the sweeper moves. The grants are scoped by name pattern to every worker role of this
 * install, which admits a renamed one and no role of another install.
 */
export class SweeperWorkerRoleRemoval extends Construct implements IResourceRemoval<'sweeper-role'> {
  readonly id = 'sweeper-role';
  private readonly workerRoleArn: string;
  private readonly workerRolePolicyName: string;

  constructor(scope: Construct, id: string, props: SweeperWorkerRoleRemovalProps) {
    super(scope, id);
    this.workerRoleArn        = props.workerRoleArn;
    this.workerRolePolicyName = props.workerRolePolicyName;
  }

  public grantStatements(): iam.PolicyStatement[] {
    return [this.grantRoleInspection(), this.grantRoleDeletion()];
  }

  public crProperties(): RemovalTargets['sweeper-role'] {
    return {
      workerRoleArn:        this.workerRoleArn,
      workerRolePolicyName: this.workerRolePolicyName,
    };
  }

  public buildChain(worker: lambda.IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State {
    const payload: WorkerPayloadTemplate<SweeperRoleWorkerInput> = {
      removalType:          'sweeper-role',
      workerRoleArn:        targetField(this.id, 'workerRoleArn'),
      workerRolePolicyName: targetField(this.id, 'workerRolePolicyName'),
      rootStackName:        Aws.STACK_NAME,
      rootStackId:          StackIdentity.guid,
    };

    const retryLoop = buildWorkerRetryLoop(this, 'sweeper-role', {
      worker,
      payload,
      retryInterval,
      onSuccess,
      failureCause: 'Sweeper worker role removal failed',
    });

    return withTargetPresenceGuard(this, 'sweeper-role-has-target', this.id, retryLoop, onSuccess);
  }

  private grantRoleInspection(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:ListRoleTags'],
      resources: [this.workerRoleArnPattern()],
    });
  }

  /** `iam:DeleteRole` and `iam:DeleteRolePolicy` take no `aws:ResourceTag` condition, so the name pattern is the scope. */
  private grantRoleDeletion(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
      resources: [this.workerRoleArnPattern()],
    });
  }

  /** Every worker role this install has had: the role prefix, a position hash that changes when the sweeper moves, then the guid prefix. */
  private workerRoleArnPattern(): string {
    return `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/${SWEEPER_WORKER_ROLE_NAME_PREFIX}*-${StackIdentity.guidPrefix}`;
  }
}
