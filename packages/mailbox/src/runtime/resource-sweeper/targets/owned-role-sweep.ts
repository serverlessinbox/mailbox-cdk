import { DeleteRoleCommand, DeleteRolePolicyCommand, IAMClient, ListRoleTagsCommand } from '@aws-sdk/client-iam';
import { CaughtError, parseArn, type LoggerBuffer }                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { OwnershipCheckedDelete }                                                     from '../ownership-checked-delete';
import type { TargetResult, WorkerRootStack }                                         from '../removal';
import type { RootStackMembership }                                                   from '../root-stack-membership';
import type { TargetResults }                                                         from '../target-results';

/**
 * Deletes one IAM role of this stack once the root stack owns it: its one named inline policy, then the role.
 * A role that is gone counts as swept, and one that still has attached policies is retried.
 */
export class OwnedRoleSweep {
  private readonly ownershipCheckedDelete: OwnershipCheckedDelete;

  constructor(
    private readonly iamClient: IAMClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly results: TargetResults,
    private readonly logger: LoggerBuffer,
  ) {
    this.ownershipCheckedDelete = new OwnershipCheckedDelete(this.results, this.logger);
  }

  /** Resolves to `SUCCESS` once the role is gone, `RETRY` while it has attached policies, `FAILED` otherwise. Never rejects. */
  public sweep(root: WorkerRootStack, roleArn: string, policyName: string, label: string): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label,
      goneErrorName:         'NoSuchEntityException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRoleRootStackMismatch(root, roleArn, label),
      deleteResource:        () => this.deleteRolePolicyAndRole(roleArn, policyName, label),
    });
  }

  private async findRoleRootStackMismatch(root: WorkerRootStack, roleArn: string, label: string): Promise<string | undefined> {
    this.logger.debug(`Verifying ${label} belongs to the root stack`);
    const tagsResp = await this.iamClient.send(new ListRoleTagsCommand({ RoleName: parseArn(roleArn).resourceName }));
    return this.rootStackMembership.mismatchInTagList(root, label, tagsResp.Tags);
  }

  private async deleteRolePolicyAndRole(roleArn: string, policyName: string, label: string): Promise<TargetResult> {
    const roleName = parseArn(roleArn).resourceName;

    this.logger.info(`${label} belongs to the root stack; deleting policy and role`);
    await this.deleteRolePolicyIfPresent(roleName, policyName);
    return this.deleteRole(roleName, label);
  }

  private async deleteRolePolicyIfPresent(roleName: string, policyName: string): Promise<void> {
    try {
      await this.iamClient.send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }));
    } catch (thrown) {
      this.ignoreMissingPolicy(thrown);
    }
  }

  private ignoreMissingPolicy(thrown: unknown): void {
    // A policy that is already gone is the state the sweep is after; any other error ends the role step.
    if (!CaughtError.is(thrown, 'NoSuchEntityException')) {
      throw thrown;
    }
  }

  private async deleteRole(roleName: string, label: string): Promise<TargetResult> {
    try {
      await this.iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
      this.logger.info(`${label} deleted successfully`);
      return this.results.done();
    } catch (thrown) {
      return this.resultOfRoleDeletionFailure(thrown, label);
    }
  }

  private resultOfRoleDeletionFailure(thrown: unknown, label: string): TargetResult {
    // IAM answers `DeleteConflictException` while an attached policy is still draining, which a later run clears.
    if (CaughtError.is(thrown, 'DeleteConflictException')) {
      this.logger.info(`${label} still has attached policies; will retry`);
      return this.results.retry('DeleteConflictException');
    }

    throw thrown;
  }
}
