import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { IAMClient, ListRoleTagsCommand, DeleteRolePolicyCommand, DeleteRoleCommand } from '@aws-sdk/client-iam';
import { parseArn, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { CaughtError } from '../caught-error';
import type { StackFailureDetectorRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { StackOwnership } from '../stack-ownership';
import { TargetResults } from '../target-results';

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

  constructor(
    private readonly eventsClient: EventBridgeClient,
    private readonly lambdaClient: LambdaClient,
    private readonly iamClient: IAMClient,
    private readonly ownership: StackOwnership,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Sweeps the rule, then the function, then the role. Resolves to `done` once all three are gone,
   * otherwise to the outcome of the first step that is not done: `retry` while the role still has
   * attached policies, `failed` on an ownership mismatch or any other error. Never rejects.
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
      if (outcome.status !== 'done') {
        return outcome;
      }
    }

    return this.results.done();
  }

  private async sweepRule(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteRuleWhenOwned(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown, 'EventBridge rule', 'ResourceNotFoundException');
    }
  }

  private async deleteRuleWhenOwned(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const ruleName = parseArn(input.ruleArn).resourceName;

    const mismatch = await this.findRuleOwnershipMismatch(input);
    // Never delete what another stack owns. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    await this.deleteRule(input, ruleName);
    return this.results.done();
  }

  private async findRuleOwnershipMismatch(input: StackFailureDetectorRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying EventBridge rule ownership');
    const tagsResp = await this.eventsClient.send(new ListTagsForResourceCommand({ ResourceARN: input.ruleArn }));
    return this.ownership.mismatchInTagList(input.rootStackName, 'EventBridge rule', tagsResp.Tags);
  }

  private async deleteRule(input: StackFailureDetectorRemovalInput, ruleName: string): Promise<void> {
    this.logger.info('EventBridge rule ownership verified; removing targets and deleting');
    // Targets are detached only when the input names one.
    if (input.ruleTargetId) {
      await this.eventsClient.send(new RemoveTargetsCommand({ Rule: ruleName, Ids: [input.ruleTargetId] }));
    }
    await this.eventsClient.send(new DeleteRuleCommand({ Name: ruleName }));
    this.logger.info('EventBridge rule deleted successfully');
  }

  private async sweepFunction(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteFunctionWhenOwned(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown, 'Detector Lambda function', 'ResourceNotFoundException');
    }
  }

  private async deleteFunctionWhenOwned(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const functionName = parseArn(input.detectorFnArn).resourceName;

    const mismatch = await this.findFunctionOwnershipMismatch(input, functionName);
    // Never delete what another stack owns. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    await this.deleteFunction(functionName);
    return this.results.done();
  }

  private async findFunctionOwnershipMismatch(
    input: StackFailureDetectorRemovalInput,
    functionName: string,
  ): Promise<string | undefined> {
    this.logger.debug('Verifying detector Lambda function ownership');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    return this.ownership.mismatchInTagMap(input.rootStackName, 'Detector Lambda function', getResp.Tags);
  }

  private async deleteFunction(functionName: string): Promise<void> {
    this.logger.info('Detector Lambda function ownership verified; attempting delete');
    await this.lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
    this.logger.info('Detector Lambda function deleted successfully');
  }

  private async sweepRole(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteRoleWhenOwned(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown, 'Detector IAM role', 'NoSuchEntityException');
    }
  }

  private async deleteRoleWhenOwned(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const roleName = parseArn(input.detectorRoleArn).resourceName;

    const mismatch = await this.findRoleOwnershipMismatch(input, roleName);
    // Never delete what another stack owns. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    return this.deleteRolePolicyAndRole(input, roleName);
  }

  private async findRoleOwnershipMismatch(
    input: StackFailureDetectorRemovalInput,
    roleName: string,
  ): Promise<string | undefined> {
    this.logger.debug('Verifying detector IAM role ownership');
    const tagsResp = await this.iamClient.send(new ListRoleTagsCommand({ RoleName: roleName }));
    return this.ownership.mismatchInTagList(input.rootStackName, 'Detector IAM role', tagsResp.Tags);
  }

  private async deleteRolePolicyAndRole(input: StackFailureDetectorRemovalInput, roleName: string): Promise<TargetResult> {
    this.logger.info('Detector IAM role ownership verified; deleting policy and role');
    // The inline policy is deleted only when the input names one.
    if (input.detectorRolePolicyName) {
      await this.deleteRolePolicyIfPresent(roleName, input.detectorRolePolicyName);
    }
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

  private resultOfFailure(thrown: unknown, resourceLabel: string, goneErrorName: string): TargetResult {
    const error = new CaughtError(thrown);
    // A resource that no longer exists is what the sweep is after, so it counts as swept.
    if (error.is(goneErrorName)) {
      this.logger.debug(`${resourceLabel} not found; treating as deleted`);
      return this.results.done();
    }

    // Any other error ends the sweep as failed, reported with its name and message as the result's reason.
    this.logger.error(`${resourceLabel} deletion error`, { errorName: error.name, errorMessage: error.message });
    return this.results.failed(error.describe());
  }
}
