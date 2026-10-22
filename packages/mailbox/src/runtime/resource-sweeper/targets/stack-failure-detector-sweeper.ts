import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { IAMClient, ListRoleTagsCommand, DeleteRolePolicyCommand, DeleteRoleCommand }          from '@aws-sdk/client-iam';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand }                             from '@aws-sdk/client-lambda';
import { CaughtError, parseArn, type LoggerBuffer }                                            from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { OwnershipCheckedDelete }                                                              from '../ownership-checked-delete';
import type { StackFailureDetectorRemovalInput, TargetResult, TargetSweeper, WorkerRootStack } from '../removal';
import { RootStackMembership }                                                                 from '../root-stack-membership';
import { TargetResults }                                                                       from '../target-results';

/**
 * Sweeps the parts of the stack-failure detector the input carries, sequentially: rule, then
 * function, then role. Each step is idempotent (an already-deleted resource counts as done),
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
   * Sweeps the parts `input` carries: the rule, then the function, then the role. A part the input
   * does not carry is live and is never touched. Resolves to `SUCCESS` once every carried part is gone,
   * otherwise to the outcome of the first step that is not done: `RETRY` while the role still has
   * attached policies, `FAILED` on a root stack mismatch or any other error. Never rejects.
   */
  public async sweep(input: StackFailureDetectorRemovalInput): Promise<TargetResult> {
    const { ruleArn, ruleTargetId, detectorFnArn, detectorRoleArn, detectorRolePolicyName } = input;

    const steps = [
      ...(ruleArn !== undefined && ruleTargetId !== undefined
        ? [() => this.sweepRule(input, ruleArn, ruleTargetId)]
        : []),
      ...(detectorFnArn !== undefined
        ? [() => this.sweepFunction(input, detectorFnArn)]
        : []),
      ...(detectorRoleArn !== undefined && detectorRolePolicyName !== undefined
        ? [() => this.sweepRole(input, detectorRoleArn, detectorRolePolicyName)]
        : []),
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

  private sweepRule(root: WorkerRootStack, ruleArn: string, ruleTargetId: string): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'EventBridge rule',
      goneErrorName:         'ResourceNotFoundException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRuleRootStackMismatch(root, ruleArn),
      deleteResource:        () => this.deleteRule(ruleArn, ruleTargetId),
    });
  }

  private async findRuleRootStackMismatch(root: WorkerRootStack, ruleArn: string): Promise<string | undefined> {
    this.logger.debug('Verifying EventBridge rule belongs to the root stack');
    const tagsResp = await this.eventsClient.send(new ListTagsForResourceCommand({ ResourceARN: ruleArn }));
    return this.rootStackMembership.mismatchInTagList(root, 'EventBridge rule', tagsResp.Tags);
  }

  private async deleteRule(ruleArn: string, ruleTargetId: string): Promise<TargetResult> {
    const ruleName = parseArn(ruleArn).resourceName;

    this.logger.info('EventBridge rule belongs to the root stack; removing targets and deleting');
    await this.eventsClient.send(new RemoveTargetsCommand({ Rule: ruleName, Ids: [ruleTargetId] }));
    await this.eventsClient.send(new DeleteRuleCommand({ Name: ruleName }));
    this.logger.info('EventBridge rule deleted successfully');
    return this.results.done();
  }

  private sweepFunction(root: WorkerRootStack, detectorFnArn: string): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'Detector Lambda function',
      goneErrorName:         'ResourceNotFoundException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findFunctionRootStackMismatch(root, detectorFnArn),
      deleteResource:        () => this.deleteFunction(detectorFnArn),
    });
  }

  private async findFunctionRootStackMismatch(root: WorkerRootStack, detectorFnArn: string): Promise<string | undefined> {
    this.logger.debug('Verifying detector Lambda function belongs to the root stack');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: parseArn(detectorFnArn).resourceName }));
    return this.rootStackMembership.mismatchInTagMap(root, 'Detector Lambda function', getResp.Tags);
  }

  private async deleteFunction(detectorFnArn: string): Promise<TargetResult> {
    this.logger.info('Detector Lambda function belongs to the root stack; attempting delete');
    await this.lambdaClient.send(new DeleteFunctionCommand({ FunctionName: parseArn(detectorFnArn).resourceName }));
    this.logger.info('Detector Lambda function deleted successfully');
    return this.results.done();
  }

  private sweepRole(root: WorkerRootStack, detectorRoleArn: string, detectorRolePolicyName: string): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'Detector IAM role',
      goneErrorName:         'NoSuchEntityException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRoleRootStackMismatch(root, detectorRoleArn),
      deleteResource:        () => this.deleteRolePolicyAndRole(detectorRoleArn, detectorRolePolicyName),
    });
  }

  private async findRoleRootStackMismatch(root: WorkerRootStack, detectorRoleArn: string): Promise<string | undefined> {
    this.logger.debug('Verifying detector IAM role belongs to the root stack');
    const tagsResp = await this.iamClient.send(new ListRoleTagsCommand({ RoleName: parseArn(detectorRoleArn).resourceName }));
    return this.rootStackMembership.mismatchInTagList(root, 'Detector IAM role', tagsResp.Tags);
  }

  private async deleteRolePolicyAndRole(detectorRoleArn: string, detectorRolePolicyName: string): Promise<TargetResult> {
    const roleName = parseArn(detectorRoleArn).resourceName;

    this.logger.info('Detector IAM role belongs to the root stack; deleting policy and role');
    await this.deleteRolePolicyIfPresent(roleName, detectorRolePolicyName);
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
