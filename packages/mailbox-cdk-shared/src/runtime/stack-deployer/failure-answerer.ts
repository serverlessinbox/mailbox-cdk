import { CaughtError }                          from '../../runtime/handler-kit/errors/caught-error';
import { ExpectedFailure }                      from '../../runtime/handler-kit/errors/expected-failure';

import { AnswerDeliveryFailure }                from './answer-delivery-failure';
import type { CfnReplyTarget, CfnResponder }    from './cfn-responder';
import type { StackDeploymentEventReader }      from './stack-deployment-event-reader';
import type { AnswerableEvent, OperationInput } from './stack-deployment';
import { StackOperationFailure }                from './stack-operation-failure';
import type { UpdateRollbackAnswers }           from './update-rollback-answerer';
import { WorkerResult }                         from './worker-result';

/** Answers CloudFormation for a stack operation that failed, with the detail only the stack operation can add. */
export interface StackFailureAnswerer {
  answerFailure(op: OperationInput, failure: StackOperationFailure, target: CfnReplyTarget): Promise<WorkerResult>;
}

/**
 * Answers the CloudFormation request of an invocation that ended in a failure, whatever the failure and
 * however much of the event could be read: a Delete is answered SUCCESS, any other request FAILED, with the
 * failure as the reason. The one request that cannot be answered is an event with no usable response
 * target; that throws, after writing a line that says so. A failure to deliver an answer is never answered
 * again; it is thrown as it is. An Update is first offered to the rollback answerer, which is absent when the
 * function has no usable configuration to build it from.
 */
export class FailureAnswerer {
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;
  private readonly rollback: UpdateRollbackAnswers | undefined;

  constructor(events: StackDeploymentEventReader, responder: CfnResponder, rollback: UpdateRollbackAnswers | undefined) {
    this.events    = events;
    this.responder = responder;
    this.rollback  = rollback;
  }

  /** Answers the CloudFormation request the starter received. */
  async answerCfnRequest(event: unknown, failure: unknown, logStreamName: string | undefined): Promise<void> {
    this.rejectUndeliverable(failure);

    const answerable = this.events.readAnswerableCfnRequest(event);
    if (!answerable) {
      throw this.unanswerable(failure);
    }
    await this.answerReadable(answerable, failure, logStreamName);
  }

  /**
   * Answers the CloudFormation request behind a workflow input and ends the workflow. A failure of a stack
   * operation is answered by `stackFailures` when it is given, which adds the recent stack events.
   */
  async answerSfnInput(event: unknown, failure: unknown, logStreamName: string | undefined, stackFailures?: StackFailureAnswerer): Promise<WorkerResult> {
    this.rejectUndeliverable(failure);

    if (stackFailures && failure instanceof StackOperationFailure) {
      const invoke = this.events.readSfnInvokeEvent(event);
      return stackFailures.answerFailure(invoke.op, failure, this.responder.targetForStep(invoke, logStreamName));
    }

    const answerable = this.events.readAnswerableSfnInput(event);
    if (!answerable) {
      throw this.unanswerable(failure);
    }
    await this.answerReadable(answerable, failure, logStreamName);
    return WorkerResult.finished();
  }

  private async answerReadable(answerable: AnswerableEvent, failure: unknown, logStreamName: string | undefined): Promise<void> {
    const target = this.responder.targetForAnswerable(answerable, logStreamName);
    const reason = this.reasonOf(failure);

    if (await this.rollback?.answerSuccess(answerable, target, reason)) {
      return;
    }
    await this.responder.answerFailure(target, answerable.requestType, reason);
  }

  private rejectUndeliverable(failure: unknown): void {
    if (failure instanceof AnswerDeliveryFailure) {
      throw failure;
    }
  }

  private reasonOf(failure: unknown): string {
    if (failure instanceof ExpectedFailure || failure instanceof StackOperationFailure) {
      return failure.message;
    }
    return `Unexpected error: ${new CaughtError(failure).describeWithMetadata()}`;
  }

  // This class holds no logger, and the line must be written whatever the log level is.
  private unanswerable(failure: unknown): Error {
    const description = new CaughtError(failure).describeWithMetadata();
    console.error('CloudFormation cannot be answered: the event carries no usable response target', { error: description });
    return new Error(`CloudFormation was not answered: the event carries no usable response target. Failure: ${description}`);
  }
}
