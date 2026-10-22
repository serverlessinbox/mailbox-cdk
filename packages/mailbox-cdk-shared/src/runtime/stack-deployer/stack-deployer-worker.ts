import type { Stack }                          from '@aws-sdk/client-cloudformation';

import { CaughtError }                         from '../../runtime/handler-kit/errors/caught-error';
import type { LoggerBuffer }                   from '../../runtime/handler-kit/logger-buffer';

import type { CfnReplyTarget, CfnResponder }   from './answers/cfn-responder';
import type { StackFailureAnswerer }           from './answers/failure-answerer';
import type { UpdateRollbackAnswers }          from './answers/update-rollback-answerer';
import type { CloudFormationStacks }           from './cloudformation-stacks';
import type { OperationInput, SfnInvokeEvent } from './stack/stack-deployment';
import { isSwitchedOn }                        from './stack/stack-flag';
import { StackOperationFailure }               from './stack/stack-operation-failure';
import { StackStatus }                         from './stack/stack-status';
import { WorkerResult, type RetryCounts }      from './worker-result';

// Polling stops so the worker answers CloudFormation before the service timeout of the custom resource, on
// every path including the retries of a DELETE_FAILED stack.
const MAX_POLL_ATTEMPTS = 135;

const MAX_KMS_CREATE_RETRIES = 3;

const START_FAILED_STEP = 'Stack deployer start failed';
const CHECK_FAILED_STEP = 'Stack deployer check failed (DescribeStacks)';

/**
 * Carries out one invocation of the Step Functions workflow that deploys, updates or deletes a stack: it
 * starts the stack operation, or checks how far it got and answers CloudFormation once it is over. Whether
 * to keep polling is returned to the workflow as a WorkerResult. An Update it would answer FAILED is first
 * offered to the rollback answerer.
 */
export class StackDeployerWorker implements StackFailureAnswerer {
  private readonly stacks: CloudFormationStacks;
  private readonly responder: CfnResponder;
  private readonly rollback: UpdateRollbackAnswers;
  private readonly logger: LoggerBuffer;

  constructor(stacks: CloudFormationStacks, responder: CfnResponder, rollback: UpdateRollbackAnswers, logger: LoggerBuffer) {
    this.stacks    = stacks;
    this.responder = responder;
    this.rollback  = rollback;
    this.logger    = logger;
  }

  /**
   * A stack operation that ends in a failed or unfinished stack is answered to CloudFormation here and
   * returns normally. A Delete is always answered SUCCESS, so that it never blocks the parent stack from
   * deleting or rolling back. An AWS call that fails to start the operation or to describe the stack throws a
   * StackOperationFailure, which is answered with `answerFailure`; any other failure throws as it is.
   * Nothing it does answers CloudFormation twice: the one answer is sent after the AWS calls, outside the
   * step that wraps them in a StackOperationFailure.
   */
  async handle(event: SfnInvokeEvent, target: CfnReplyTarget): Promise<WorkerResult> {
    this.logInvocation(event);

    if (event.mode === 'start') {
      return this.startOperation(event.op, target);
    }
    return this.checkOperation(event, target);
  }

  /** Answers CloudFormation that the stack operation failed, with the recent stack events as detail, and ends the workflow. */
  async answerFailure(op: OperationInput, failure: StackOperationFailure, target: CfnReplyTarget): Promise<WorkerResult> {
    this.logFailure(failure);

    if (await this.rollback.answerSuccess(op, target, failure.message)) {
      return WorkerResult.finished();
    }

    const failures = await this.stacks.describeRecentFailures(op);
    await this.responder.answerFailure(target, op.requestType, `${failure.message}${this.eventsDetail(failures)}`);
    return WorkerResult.finished();
  }

  private logInvocation(event: SfnInvokeEvent): void {
    this.logger.info('Stack deployer op', {
      mode:                  event.mode,
      requestType:           event.op.requestType,
      stackName:             event.op.stackName,
      templateUrl:           event.op.templateUrl,
      terminationProtection: event.op.terminationProtection,
      parameterKeys:         Object.keys(event.op.parameters ?? {}),
    });
  }

  private logFailure(failure: StackOperationFailure): void {
    this.logger.error('Stack deployer failed', { errorMessage: failure.message });
  }

  private async startOperation(op: OperationInput, target: CfnReplyTarget): Promise<WorkerResult> {
    // preserveOnDelete leaves the stack in place and answers SUCCESS.
    if (op.requestType === 'Delete' && isSwitchedOn(op.preserveOnDelete)) {
      await this.responder.succeed(target);
      return WorkerResult.finished();
    }

    await this.startStackOperation(op);
    return WorkerResult.pollAgain();
  }

  private async startStackOperation(op: OperationInput): Promise<void> {
    try {
      if (op.requestType === 'Delete') {
        await this.stacks.deleteIfExists(op);
      } else {
        await this.stacks.startOrUpdate(op);
      }
    } catch (failure) {
      throw new StackOperationFailure(START_FAILED_STEP, failure);
    }
  }

  private async checkOperation(event: SfnInvokeEvent, target: CfnReplyTarget): Promise<WorkerResult> {
    const retries: RetryCounts = {
      deleteRetryCount: event.deleteRetryCount ?? 0,
      createRetryCount: event.createRetryCount ?? 0,
    };
    const attempt              = event.attempt ?? 0;

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

    // Once the attempts run out a DELETE_FAILED stack falls through to the failed-deployment answer below.
    if (status.isDeleteFailed() && attempt < MAX_POLL_ATTEMPTS) {
      return this.retryDeletion(op, stack, retries, attempt);
    }

    if (status.isDeploymentFailed()) {
      const failures = await this.stacks.describeRecentFailures(op);
      const reason   = stack.StackStatusReason ?? `Stack delete failed with status ${status.value}`;
      await this.responder.succeed(target, { reason: `${reason}${this.eventsDetail(failures)}` });
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

  private async retryDeletion(op: OperationInput, stack: Stack, retries: RetryCounts, attempt: number): Promise<WorkerResult> {
    this.logger.info('Stack delete failed (DELETE_FAILED); retrying delete', {
      deleteRetryCount: retries.deleteRetryCount,
      attempt,
      MAX_POLL_ATTEMPTS,
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
      await this.answerFailed(op, target, `Stack ${op.stackName} does not exist`);
      return WorkerResult.finished(retries);
    }

    this.logger.info('Stack status check', {
      stackName:    op.stackName,
      stackId:      stack.StackId,
      status:       stack.StackStatus,
      statusReason: stack.StackStatusReason,
      outputCount:  (stack.Outputs ?? []).length,
    });

    const status   = new StackStatus(stack.StackStatus);
    const failures = await this.stacks.describeRecentFailures(op);
    const detail   = this.eventsDetail(failures);

    // A stack being torn down can never satisfy a create or an update, and polling it would not end.
    if (status.isDeleting()) {
      await this.answerFailed(op, target, `Stack ${op.stackName} is being deleted (status ${status.value}); cannot deploy into a deleting stack.${detail}`);
      return WorkerResult.finished(retries);
    }

    const kmsRace = this.matchesKmsTransientSignature(failures.join(' '));

    // A Create that fails on a KMS key that is not available yet succeeds when tried again: wait for the rollback to end.
    if (op.requestType === 'Create' && status.isRollbackInProgress() && kmsRace) {
      this.logger.info('Stack in ROLLBACK_IN_PROGRESS with KMS transient error; waiting for rollback', {
        stackName:        op.stackName,
        createRetryCount: retries.createRetryCount,
      });
      return WorkerResult.pollAgain(retries);
    }

    if (op.requestType === 'Create' && status.requiresRecreate() && kmsRace && retries.createRetryCount < MAX_KMS_CREATE_RETRIES) {
      return this.recreateAfterKmsRace(op, retries);
    }

    if (status.isDeploymentFailed()) {
      const reason = stack.StackStatusReason ?? `Stack failed with status ${status.value}`;
      await this.answerFailed(op, target, `${reason}${detail}`);
      return WorkerResult.finished(retries);
    }

    if (status.isTerminalSuccess()) {
      return this.answerSuccess(op, stack, retries, target);
    }

    // The cap answers before the workflow's own timeout does, so CloudFormation is told why.
    if (attempt >= MAX_POLL_ATTEMPTS) {
      await this.answerFailed(op, target, `Stack ${op.stackName} did not reach a terminal state after ${attempt} attempts (last status ${status.value})`);
      return WorkerResult.finished(retries);
    }

    return WorkerResult.pollAgain(retries);
  }

  private async recreateAfterKmsRace(op: OperationInput, retries: RetryCounts): Promise<WorkerResult> {
    this.logger.info('Stack requires recreation due to KMS transient error', {
      stackName:        op.stackName,
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
    const outputs = this.stacks.outputsOf(stack);
    this.logger.info('Stack reached terminal success state', {
      stackName:   op.stackName,
      outputCount: Object.keys(outputs).length,
    });
    await this.responder.succeed(target, { data: outputs });
    return WorkerResult.finished(retries);
  }

  private async answerFailed(op: OperationInput, target: CfnReplyTarget, reason: string): Promise<void> {
    if (await this.rollback.answerSuccess(op, target, reason)) {
      return;
    }
    await this.responder.fail(target, reason);
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
