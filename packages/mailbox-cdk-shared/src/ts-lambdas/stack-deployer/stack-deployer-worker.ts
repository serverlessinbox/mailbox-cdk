import type { Stack } from '@aws-sdk/client-cloudformation';
import { CaughtError } from '../shared/caught-error';
import type { LoggerBuffer } from '../shared/logger-buffer';
import type { CfnReplyTarget, CfnResponder } from './cfn-responder';
import type { CloudFormationStacks } from './cloudformation-stacks';
import type { OperationInput, SfnInvokeEvent } from './stack-deployment';
import { StackOperationFailure } from './stack-operation-failure';
import { StackStatus } from './stack-status';
import { WorkerResult, type RetryCounts } from './worker-result';

// Polling stops so the worker answers CloudFormation before the 60 minute service timeout of the custom
// resource; at a check interval of 20 seconds, 135 attempts take about 45 minutes.
const MAX_POLL_ATTEMPTS = 135;

// At a check interval of 20 seconds, 180 retries of a DELETE_FAILED stack take about 60 minutes.
const MAX_DELETE_RETRIES = 180;

const MAX_KMS_CREATE_RETRIES = 3;

const START_FAILED_STEP = 'Stack deployer start failed';
const CHECK_FAILED_STEP = 'Stack deployer check failed (DescribeStacks)';

/**
 * Carries out one invocation of the Step Functions workflow that deploys, updates or deletes a stack: it
 * starts the stack operation, or checks how far it got and answers CloudFormation once it is over. Whether
 * to keep polling is returned to the workflow as a WorkerResult.
 */
export class StackDeployerWorker {
  private readonly stacks: CloudFormationStacks;
  private readonly responder: CfnResponder;
  private readonly logger: LoggerBuffer;

  constructor(stacks: CloudFormationStacks, responder: CfnResponder, logger: LoggerBuffer) {
    this.stacks = stacks;
    this.responder = responder;
    this.logger = logger;
  }

  /**
   * A stack operation that ends in a failed or unfinished stack is answered to CloudFormation here and
   * returns normally. A Delete is always answered SUCCESS, so that it never blocks the parent stack from
   * deleting or rolling back. An AWS call that fails to start the operation or to describe the stack throws a
   * StackOperationFailure, which is answered with `answerFailure`; any other failure throws as it is.
   */
  async handle(event: SfnInvokeEvent, target: CfnReplyTarget): Promise<WorkerResult> {
    this.logger.info('Stack deployer op', {
      mode: event.mode,
      requestType: event.op.requestType,
      stackName: event.op.stackName,
      templateUrl: event.op.templateUrl,
      terminationProtection: event.op.terminationProtection,
      parameterKeys: Object.keys(event.op.parameters ?? {}),
    });

    if (event.mode === 'start') {
      return this.startOperation(event.op, target);
    }
    return this.checkOperation(event, target);
  }

  /** Answers CloudFormation that the stack operation failed, with the recent stack events as detail, and ends the workflow. */
  async answerFailure(op: OperationInput, failure: StackOperationFailure, target: CfnReplyTarget): Promise<WorkerResult> {
    this.logger.error('Stack deployer failed', { errorMessage: failure.message });

    const failures = await this.stacks.describeRecentFailures(op);
    await this.responder.answerFailure(target, op.requestType, this.responder.limitedReason(`${failure.message}${this.eventsDetail(failures)}`));
    return WorkerResult.finished();
  }

  private async startOperation(op: OperationInput, target: CfnReplyTarget): Promise<WorkerResult> {
    try {
      if (op.requestType !== 'Delete') {
        await this.stacks.startOrUpdate(op);
        return WorkerResult.pollAgain();
      }

      // preserveOnDelete leaves the stack in place and answers SUCCESS.
      if (op.preserveOnDelete) {
        await this.responder.succeed(target);
        return WorkerResult.finished();
      }

      await this.stacks.deleteIfExists(op);
      return WorkerResult.pollAgain();
    } catch (failure) {
      throw new StackOperationFailure(START_FAILED_STEP, failure);
    }
  }

  private async checkOperation(event: SfnInvokeEvent, target: CfnReplyTarget): Promise<WorkerResult> {
    const retries: RetryCounts = {
      deleteRetryCount: event.deleteRetryCount ?? 0,
      createRetryCount: event.createRetryCount ?? 0,
    };
    const attempt = event.attempt ?? 0;

    const stack = await this.describeForCheck(event.op);
    if (event.op.requestType === 'Delete') {
      return this.checkDeletion(event.op, stack, attempt, retries, target);
    }
    return this.checkDeployment(event.op, stack, attempt, retries, target);
  }

  private async describeForCheck(op: OperationInput): Promise<Stack | undefined> {
    try {
      return await this.stacks.describe(op);
    } catch (failure) {
      throw new StackOperationFailure(CHECK_FAILED_STEP, failure);
    }
  }

  private async checkDeletion(op: OperationInput, stack: Stack | undefined, attempt: number, retries: RetryCounts, target: CfnReplyTarget): Promise<WorkerResult> {
    if (!stack) {
      await this.responder.succeed(target);
      return WorkerResult.finished(retries);
    }

    const status = new StackStatus(stack.StackStatus);

    if (status.isDeleteFailed()) {
      return this.retryDeletion(op, stack, retries);
    }

    if (status.isTerminalFailure()) {
      const failures = await this.stacks.describeRecentFailures(op);
      const reason = stack.StackStatusReason ?? `Stack delete failed with status ${status.value}`;
      await this.responder.succeed(target, { reason: this.responder.limitedReason(`${reason}${this.eventsDetail(failures)}`) });
      return WorkerResult.finished(retries);
    }

    if (attempt >= MAX_POLL_ATTEMPTS) {
      this.logger.warn('Delete polling cap reached; responding SUCCESS to unblock CloudFormation', {
        attempt,
        MAX_POLL_ATTEMPTS,
        stackStatus: status.value,
      });
      await this.responder.succeed(target, {
        reason: `Stack deletion still in progress after ${attempt} attempts (${status.value}); responding SUCCESS to unblock CloudFormation rollback.`,
      });
      return WorkerResult.finished(retries);
    }

    return WorkerResult.pollAgain(retries);
  }

  private async retryDeletion(op: OperationInput, stack: Stack, retries: RetryCounts): Promise<WorkerResult> {
    this.logger.info('Stack delete failed (DELETE_FAILED); retrying delete', {
      deleteRetryCount: retries.deleteRetryCount,
      maxDeleteRetries: MAX_DELETE_RETRIES,
      reason: stack.StackStatusReason ?? 'unknown',
    });
    try {
      await this.stacks.deleteIfExists(op);
    } catch (failure) {
      this.warnDeleteRetryFailed(failure);
    }
    return WorkerResult.pollAgain({ deleteRetryCount: retries.deleteRetryCount + 1, createRetryCount: retries.createRetryCount });
  }

  private async checkDeployment(op: OperationInput, stack: Stack | undefined, attempt: number, retries: RetryCounts, target: CfnReplyTarget): Promise<WorkerResult> {
    if (!stack) {
      this.logger.error('Stack does not exist', { stackName: op.stackName });
      await this.responder.fail(target, `Stack ${op.stackName} does not exist`);
      return WorkerResult.finished(retries);
    }

    this.logger.info('Stack status check', {
      stackName: op.stackName,
      stackId: stack.StackId,
      status: stack.StackStatus,
      statusReason: stack.StackStatusReason,
      outputCount: (stack.Outputs ?? []).length,
    });

    const status = new StackStatus(stack.StackStatus);
    const failures = await this.stacks.describeRecentFailures(op);
    const detail = this.eventsDetail(failures);

    // A stack being torn down can never satisfy a create or an update, and polling it would not end.
    if (status.isDeleting()) {
      await this.responder.fail(target, this.responder.limitedReason(`Stack ${op.stackName} is being deleted (status ${status.value}); cannot deploy into a deleting stack.${detail}`));
      return WorkerResult.finished(retries);
    }

    const kmsRace = this.matchesKmsTransientSignature(failures.join(' '));

    // A Create that fails on a KMS key that is not available yet succeeds when tried again: wait for the rollback to end.
    if (op.requestType === 'Create' && status.isRollbackInProgress() && kmsRace) {
      this.logger.info('Stack in ROLLBACK_IN_PROGRESS with KMS transient error; waiting for rollback', {
        stackName: op.stackName,
        createRetryCount: retries.createRetryCount,
      });
      return WorkerResult.pollAgain(retries);
    }

    if (op.requestType === 'Create' && status.requiresRecreate() && kmsRace && retries.createRetryCount < MAX_KMS_CREATE_RETRIES) {
      return this.recreateAfterKmsRace(op, retries);
    }

    if (status.isTerminalFailure()) {
      const reason = stack.StackStatusReason ?? `Stack failed with status ${status.value}`;
      await this.responder.fail(target, this.responder.limitedReason(`${reason}${detail}`));
      return WorkerResult.finished(retries);
    }

    if (status.isTerminalSuccess()) {
      return this.answerSuccess(op, stack, retries, target);
    }

    // The cap answers before the workflow's own timeout does, so CloudFormation is told why.
    if (attempt >= MAX_POLL_ATTEMPTS) {
      await this.responder.fail(target, this.responder.limitedReason(`Stack ${op.stackName} did not reach a terminal state after ${attempt} attempts (last status ${status.value})`));
      return WorkerResult.finished(retries);
    }

    return WorkerResult.pollAgain(retries);
  }

  private async recreateAfterKmsRace(op: OperationInput, retries: RetryCounts): Promise<WorkerResult> {
    this.logger.info('Stack requires recreation due to KMS transient error', {
      stackName: op.stackName,
      createRetryCount: retries.createRetryCount,
      MAX_KMS_CREATE_RETRIES,
    });
    try {
      await this.stacks.recreate(op);
    } catch (failure) {
      this.logRecreateFailed(failure);
    }
    return WorkerResult.pollAgain({ deleteRetryCount: retries.deleteRetryCount, createRetryCount: retries.createRetryCount + 1 });
  }

  private async answerSuccess(op: OperationInput, stack: Stack, retries: RetryCounts, target: CfnReplyTarget): Promise<WorkerResult> {
    const outputs = this.outputsOf(stack);
    this.logger.info('Stack reached terminal success state', {
      stackName: op.stackName,
      outputCount: Object.keys(outputs).length,
    });
    await this.responder.succeed(target, { data: outputs });
    return WorkerResult.finished(retries);
  }

  private outputsOf(stack: Stack): Record<string, string> {
    const outputs: Record<string, string> = {};
    for (const output of stack.Outputs ?? []) {
      if (output.OutputKey && output.OutputValue !== undefined) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    }
    return outputs;
  }

  // A failed delete retry is not an answer: the next check sees the stack's state and tries again.
  private warnDeleteRetryFailed(failure: unknown): void {
    this.logger.warn('Retry DeleteStack failed (will keep polling)', { error: new CaughtError(failure).describeWithMetadata() });
  }

  // A failed recreate still counts as a retry: the next check sees the stack's state.
  private logRecreateFailed(failure: unknown): void {
    this.logger.error('Recreate CreateStack failed', { error: new CaughtError(failure).describeWithMetadata() });
  }

  private eventsDetail(failures: string[]): string {
    return failures.length > 0 ? ` Recent events: ${failures.join(' | ')}` : '';
  }

  // A fresh account can fail to create a DynamoDB table with a KMS NotFoundException before the AWS-managed
  // key exists; requiring both words keeps unrelated failures from matching.
  private matchesKmsTransientSignature(failureText: string): boolean {
    const lower = failureText.toLowerCase();
    return lower.includes('notfoundexception') && lower.includes('kms');
  }
}
