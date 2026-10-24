import { IAMClient }                                                 from '@aws-sdk/client-iam';
import type { LoggerBuffer }                                         from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { SweeperRoleRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { RootStackMembership }                                       from '../root-stack-membership';
import { TargetResults }                                             from '../target-results';

import { OwnedRoleSweep }                                            from './owned-role-sweep';

/** Sweeps the sweeper's own worker IAM role, once the root stack owns it, as the sweeper's removal of a moved worker role. */
export class SweeperRoleSweeper implements TargetSweeper<SweeperRoleRemovalInput> {
  private readonly results = new TargetResults('sweeper-role');
  private readonly ownedRoleSweep: OwnedRoleSweep;

  constructor(iamClient: IAMClient, rootStackMembership: RootStackMembership, logger: LoggerBuffer) {
    this.ownedRoleSweep = new OwnedRoleSweep(iamClient, rootStackMembership, this.results, logger);
  }

  public sweep(input: SweeperRoleRemovalInput): Promise<TargetResult> {
    return this.ownedRoleSweep.sweep(input, input.workerRoleArn, input.workerRolePolicyName, 'Sweeper worker IAM role');
  }
}
