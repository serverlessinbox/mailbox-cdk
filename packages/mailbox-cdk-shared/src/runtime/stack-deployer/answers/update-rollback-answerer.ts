import type { Region }                       from '../../../runtime/handler-kit/aws-identifiers';
import type { StackName }                    from '../../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import type { ParentStackStatus }            from '../../../runtime/handler-kit/custom-resource/parent-stack-status';
import type { LoggerBuffer }                 from '../../../runtime/handler-kit/logger-buffer';
import type { OperationInput, RequestType }  from '../stack/stack-deployment';

import type { CfnReplyTarget, CfnResponder } from './cfn-responder';

/** The request that failed, as far as it could be read. */
export interface FailedRequest {
  readonly requestType: RequestType | undefined;
  readonly stackName:   StackName | undefined;
  readonly region?:     Region | undefined;
}

/** Answers an Update that failed while the parent stack rolls back, so that the failure does not strand the rollback. */
export interface UpdateRollbackAnswers {
  /** Answers SUCCESS and returns true when the failure of this request is suppressed; false leaves the failure to the caller. */
  answerSuccess(request: FailedRequest, target: CfnReplyTarget, failureReason: string): Promise<boolean>;
}

/** Reads the outputs a stack has now. */
export interface SubStackOutputs {
  currentOutputs(operation: OperationInput): Promise<Record<string, string> | undefined>;
}

/**
 * Suppresses the failure of an Update that CloudFormation re-sends with the old properties while the parent stack
 * rolls back: a FAILED answer to it ends the rollback in UPDATE_ROLLBACK_FAILED. The answer is SUCCESS with the
 * physical id CloudFormation sent and the outputs the sub-stack has now, the same data a successful Update
 * answers with. Every other request, and an Update the outputs of which cannot be read, is left to fail.
 */
export class UpdateRollbackAnswerer implements UpdateRollbackAnswers {
  private readonly parentStackStatus: ParentStackStatus;
  private readonly subStacks: SubStackOutputs;
  private readonly responder: CfnResponder;
  private readonly logger: LoggerBuffer;

  constructor(parentStackStatus: ParentStackStatus, subStacks: SubStackOutputs, responder: CfnResponder, logger: LoggerBuffer) {
    this.parentStackStatus = parentStackStatus;
    this.subStacks         = subStacks;
    this.responder         = responder;
    this.logger            = logger;
  }

  async answerSuccess(request: FailedRequest, target: CfnReplyTarget, failureReason: string): Promise<boolean> {
    if (request.requestType !== 'Update') {
      return false;
    }

    if (!(await this.parentStackStatus.isRollingBack(target.cfn.StackId))) {
      return false;
    }

    const outputs = await this.readOutputs(request, failureReason);

    // The parent consumes the attributes of this resource, so an answer without the outputs is never given.
    if (!outputs) {
      return false;
    }

    await this.succeedDuringRollback(target, outputs, failureReason);
    return true;
  }

  private async readOutputs(request: FailedRequest, failureReason: string): Promise<Record<string, string> | undefined> {
    const outputs = request.stackName === undefined
      ? undefined
      : await this.subStacks.currentOutputs({ requestType: 'Update', stackName: request.stackName, region: request.region });
    if (!outputs) {
      this.logger.error('An Update failed while the parent stack rolls back, and the outputs of the stack cannot be read', { reason: failureReason });
    }
    return outputs;
  }

  private async succeedDuringRollback(target: CfnReplyTarget, outputs: Record<string, string>, failureReason: string): Promise<void> {
    this.logger.error('Answering SUCCESS to an Update that failed while the parent stack rolls back', { reason: failureReason });
    await this.responder.succeed(target, { reason: `Answered SUCCESS because the parent stack is rolling back. The Update failed: ${failureReason}`, data: outputs });
  }
}
