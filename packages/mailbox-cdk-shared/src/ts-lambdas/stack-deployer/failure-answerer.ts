import { CaughtError } from '../shared/caught-error';
import { ExpectedFailure } from '../shared/expected-failure';
import { AnswerDeliveryFailure } from './answer-delivery-failure';
import type { CfnReplyTarget, CfnResponder } from './cfn-responder';
import type { OperationInput } from './stack-deployment';
import type { StackDeploymentEventReader } from './stack-deployment-event-reader';
import { StackOperationFailure } from './stack-operation-failure';
import { WorkerResult } from './worker-result';

/** Answers CloudFormation for a stack operation that failed, with the detail only the stack operation can add. */
export interface StackFailureAnswerer {
  answerFailure(op: OperationInput, failure: StackOperationFailure, target: CfnReplyTarget): Promise<WorkerResult>;
}

/**
 * Answers the CloudFormation request of an invocation that ended in a failure, whatever the failure and
 * however much of the event could be read: a Delete is answered SUCCESS, any other request FAILED, with the
 * failure as the reason. The one request that cannot be answered is an event with no usable response
 * target; that throws, after writing a line that says so. A failure to deliver an answer is never answered
 * again; it is thrown as it is.
 */
export class FailureAnswerer {
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;

  constructor(events: StackDeploymentEventReader, responder: CfnResponder) {
    this.events = events;
    this.responder = responder;
  }

  /** Answers the CloudFormation request the starter received. */
  async answerCfnRequest(event: unknown, failure: unknown, logStreamName: string | undefined): Promise<void> {
    this.rejectUndeliverable(failure);

    const answerable = this.events.readAnswerableCfnRequest(event);
    if (!answerable) {
      throw this.unanswerable(failure);
    }
    await this.responder.answerFailure(this.responder.targetForAnswerable(answerable, logStreamName), answerable.requestType, this.reasonOf(failure));
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
    await this.responder.answerFailure(this.responder.targetForAnswerable(answerable, logStreamName), answerable.requestType, this.reasonOf(failure));
    return WorkerResult.finished();
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
