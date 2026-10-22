import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { IAMClient, ListRoleTagsCommand, DeleteRolePolicyCommand, DeleteRoleCommand } from '@aws-sdk/client-iam';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand }                    from '@aws-sdk/client-lambda';
import { CaughtError, parseArn, type LoggerBuffer }                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { OwnershipCheckedDelete }                                                     from '../ownership-checked-delete';
import type { StackFailureDetectorRemovalInput, TargetResult, TargetSweeper }         from '../removal';
import { RootStackMembership }                                                        from '../root-stack-membership';
import { TargetResults }                                                              from '../target-results';

/**
 * Sweeps the stack-failure detector's rule, function and role as ONE removal, sequentially: rule,
 * then function, then role. Each step is idempotent (an already-deleted resource counts as done),
 * so a run that stopped part-way, e.g. on a role `DeleteConflictException`, is simply invoked again:
 * it re-verifies the earlier steps are gone and resumes at the one that did not finish. The first
 * step that is not done ends the sweep with that step's outcome.
 *
 * The detector function is a regular regional Lambda, so the Lambda client is the stack's own region.
 */
export class StackFailureDetectorSweeper implements TargetSweeper<StackFailureDetectorRemovalInput> {
  private readonly results = new TargetResults('detector');
  private readonly ownershipCheckedDelete: OwnershipCheckedDelete;

  constructor(
    private readonly eventsClient: EventBridgeClient,
    private readonly lambdaClient: LambdaClient,
    private readonly iamClient: IAMClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly logger: LoggerBuffer,
  ) {
    this.ownershipCheckedDelete = new OwnershipCheckedDelete(this.results, logger);
  }

  /**
   * Sweeps the rule, then the function, then the role. Resolves to `SUCCESS` once all three are gone,
   * otherwise to the outcome of the first step that is not done: `RETRY` while the role still has
   * attached policies, `FAILED` on a root stack mismatch or any other error. Never rejects.
   */
  public async sweep(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const steps = [
      () => this.sweepRule(input),
      () => this.sweepFunction(input),
      () => this.sweepRole(input),
    ];

    for (const step of steps) {
      const outcome = await step();
      // Stop at the first step that is not done: the role must not be deleted while the function that runs under it exists.
      if (outcome.status !== 'SUCCESS') {
        return outcome;
      }
    }

    return this.results.done();
  }

  private sweepRule(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'EventBridge rule',
      goneErrorName:         'ResourceNotFoundException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRuleRootStackMismatch(input),
      deleteResource:        () => this.deleteRule(input),
    });
  }

  private async findRuleRootStackMismatch(input: StackFailureDetectorRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying EventBridge rule belongs to the root stack');
    const tagsResp = await this.eventsClient.send(new ListTagsForResourceCommand({ ResourceARN: input.ruleArn }));
    return this.rootStackMembership.mismatchInTagList(input, 'EventBridge rule', tagsResp.Tags);
  }

  private async deleteRule(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const ruleName = parseArn(input.ruleArn).resourceName;

    this.logger.info('EventBridge rule belongs to the root stack; removing targets and deleting');
    await this.eventsClient.send(new RemoveTargetsCommand({ Rule: ruleName, Ids: [input.ruleTargetId] }));
    await this.eventsClient.send(new DeleteRuleCommand({ Name: ruleName }));
    this.logger.info('EventBridge rule deleted successfully');
    return this.results.done();
  }

  private sweepFunction(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'Detector Lambda function',
      goneErrorName:         'ResourceNotFoundException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findFunctionRootStackMismatch(input),
      deleteResource:        () => this.deleteFunction(input),
    });
  }

  private async findFunctionRootStackMismatch(input: StackFailureDetectorRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying detector Lambda function belongs to the root stack');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: parseArn(input.detectorFnArn).resourceName }));
    return this.rootStackMembership.mismatchInTagMap(input, 'Detector Lambda function', getResp.Tags);
  }

  private async deleteFunction(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    this.logger.info('Detector Lambda function belongs to the root stack; attempting delete');
    await this.lambdaClient.send(new DeleteFunctionCommand({ FunctionName: parseArn(input.detectorFnArn).resourceName }));
    this.logger.info('Detector Lambda function deleted successfully');
    return this.results.done();
  }

  private sweepRole(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'Detector IAM role',
      goneErrorName:         'NoSuchEntityException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRoleRootStackMismatch(input),
      deleteResource:        () => this.deleteRolePolicyAndRole(input),
    });
  }

  private async findRoleRootStackMismatch(input: StackFailureDetectorRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying detector IAM role belongs to the root stack');
    const tagsResp = await this.iamClient.send(new ListRoleTagsCommand({ RoleName: parseArn(input.detectorRoleArn).resourceName }));
    return this.rootStackMembership.mismatchInTagList(input, 'Detector IAM role', tagsResp.Tags);
  }

  private async deleteRolePolicyAndRole(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const roleName = parseArn(input.detectorRoleArn).resourceName;

    this.logger.info('Detector IAM role belongs to the root stack; deleting policy and role');
    await this.deleteRolePolicyIfPresent(roleName, input.detectorRolePolicyName);
    return this.deleteRole(roleName);
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
    if (!new CaughtError(thrown).is('NoSuchEntityException')) {
      throw thrown;
    }
  }

  private async deleteRole(roleName: string): Promise<TargetResult> {
    try {
      await this.iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
      this.logger.info('Detector IAM role deleted successfully');
      return this.results.done();
    } catch (thrown) {
      return this.resultOfRoleDeletionFailure(thrown);
    }
  }

  private resultOfRoleDeletionFailure(thrown: unknown): TargetResult {
    // IAM answers `DeleteConflictException` while an attached policy is still draining, which a later run clears.
    if (new CaughtError(thrown).is('DeleteConflictException')) {
      this.logger.info('Detector IAM role still has attached policies; will retry');
      return this.results.retry('DeleteConflictException');
    }

    throw thrown;
  }
}
