import { toPhysicalResourceId, type PhysicalResourceId }                              from '../../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { CaughtError }                                                                from '../../../runtime/handler-kit/errors/caught-error';
import type { AnswerableEvent, CfnEnvelope, CfnRequest, RequestType, SfnInvokeEvent } from '../stack/stack-deployment';

import { AnswerDeliveryFailure }                                                      from './answer-delivery-failure';

// CloudFormation caps the size of a response reason; this leaves headroom.
const MAX_REASON_LENGTH = 3500;
const TRUNCATION_MARKER = ' …(truncated)';

// A response URL is a presigned S3 URL, and S3 answers a request now and then with a 5xx that a second try
// passes. Four attempts with 250, 500 and 1000 ms between them add under two seconds to an answer and bound
// how long a failing answer holds the invocation.
const MAX_ANSWER_ATTEMPTS  = 4;
const FIRST_RETRY_DELAY_MS = 250;

const UNNAMED_STACK_RESOURCE_ID = toPhysicalResourceId('MailboxStack');

/** Where an answer goes and which resource it concerns: the CloudFormation envelope, the physical id and the log stream a reason can point to. */
export interface CfnReplyTarget {
  readonly cfn: CfnEnvelope;
  readonly physicalResourceId: PhysicalResourceId;
  readonly logStreamName: string | undefined;
}

/** What a SUCCESS answer carries besides the status: a reason, and the stack outputs the resource exposes as attributes. */
export interface CfnSuccessAnswer {
  readonly reason?: string;
  readonly data?: Record<string, string>;
}

/** The two statuses CloudFormation accepts in an answer. */
type CfnStatus ='SUCCESS' | 'FAILED';

/** Why one PUT of an answer did not succeed, and whether another attempt can. */
interface PutRejection {
  readonly retryable: boolean;
  readonly message: string;
}

/**
 * Sends the answer to a CloudFormation custom-resource request by PUT to its response URL. The deployer
 * answers CloudFormation itself, from the starter or from the worker, rather than through `wrapHandler`.
 * It does not decide the answer; callers do. Every reason is cut to the size CloudFormation accepts, and a PUT
 * that fails with a network error or a 5xx is tried again a bounded number of times before the
 * AnswerDeliveryFailure.
 */
export class CfnResponder {
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(pause: (milliseconds: number) => Promise<void>) {
    this.pause = pause;
  }

  targetForRequest(request: CfnRequest, logStreamName: string | undefined): CfnReplyTarget {
    return {
      cfn: {
        ResponseURL: request.ResponseURL,
        StackId: request.StackId,
        RequestId: request.RequestId,
        LogicalResourceId: request.LogicalResourceId,
        ResourceType: request.ResourceType,
        PhysicalResourceId: request.PhysicalResourceId,
      },
      physicalResourceId: request.PhysicalResourceId ?? this.physicalIdOfNewResource(request.ResourceProperties.stackName),
      logStreamName,
    };
  }

  targetForStep(event: SfnInvokeEvent, logStreamName: string | undefined): CfnReplyTarget {
    return {
      cfn: event.cfn,
      physicalResourceId: event.cfn.PhysicalResourceId ?? this.physicalIdOfNewResource(event.op.stackName),
      logStreamName,
    };
  }

  /**
   * The target of an event that could not be read in full. The physical id is the one CloudFormation sent; a
   * different one on an Update would make CloudFormation replace the resource. The stack name names a resource
   * that has no id yet.
   */
  targetForAnswerable(event: AnswerableEvent, logStreamName: string | undefined): CfnReplyTarget {
    return {
      cfn: event.cfn,
      physicalResourceId: event.physicalResourceId ?? this.physicalIdOfNewResource(event.stackName),
      logStreamName,
    };
  }

  async succeed(target: CfnReplyTarget, answer?: CfnSuccessAnswer): Promise<void> {
    await this.put(target, 'SUCCESS', answer?.reason, answer?.data);
  }

  async fail(target: CfnReplyTarget, reason: string): Promise<void> {
    await this.put(target, 'FAILED', reason, undefined);
  }

  /**
   * Answers a request that could not be carried out. A Delete is answered SUCCESS, because a failed Delete
   * would leave the parent stack unable to delete or roll back; any other request, and a request whose type
   * is unknown, is answered FAILED.
   */
  async answerFailure(target: CfnReplyTarget, requestType: RequestType | undefined, reason: string): Promise<void> {
    if (requestType === 'Delete') {
      await this.succeed(target, { reason });
      return;
    }
    await this.fail(target, reason);
  }

  private async put(target: CfnReplyTarget, status: CfnStatus, reason: string | undefined, data: Record<string, string> | undefined): Promise<void> {
    const body = JSON.stringify({
      Status: status,
      Reason: this.reasonOf(target, reason),
      PhysicalResourceId: target.physicalResourceId,
      StackId: target.cfn.StackId,
      RequestId: target.cfn.RequestId,
      LogicalResourceId: target.cfn.LogicalResourceId,
      NoEcho: false,
      Data: data ?? {},
    });

    for (let attempt = 1; ; attempt++) {
      const rejection = await this.tryPut(target.cfn.ResponseURL, body);
      if (!rejection) {
        return;
      }
      if (!rejection.retryable || attempt === MAX_ANSWER_ATTEMPTS) {
        throw new AnswerDeliveryFailure(`${rejection.message} (attempts: ${attempt})`);
      }
      await this.pause(FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  private async tryPut(responseUrl: string, body: string): Promise<PutRejection | undefined> {
    let response: Response;
    try {
      response = await fetch(responseUrl, {
        method: 'PUT',
        body,
        // CloudFormation expects an empty content-type
        headers: {
          'content-type': '',
        },
      });
    } catch (failure) {
      return { retryable: true, message: `Failed to PUT CloudFormation response: ${new CaughtError(failure).describeWithMetadata()}` };
    }

    if (response.ok) {
      return undefined;
    }
    const text = await response.text().catch(() => '');
    return { retryable: response.status >= 500, message: `Failed to PUT CloudFormation response (HTTP ${response.status}): ${text}` };
  }

  private physicalIdOfNewResource(stackName: string | undefined): PhysicalResourceId {
    return stackName === undefined ? UNNAMED_STACK_RESOURCE_ID : toPhysicalResourceId(stackName);
  }

  private reasonOf(target: CfnReplyTarget, reason: string | undefined): string | undefined {
    if (reason !== undefined) {
      return this.limitedReason(reason);
    }
    return target.logStreamName ? `See CloudWatch Log Stream: ${target.logStreamName}` : undefined;
  }

  private limitedReason(reason: string): string {
    if (reason.length <= MAX_REASON_LENGTH) {
      return reason;
    }
    return reason.slice(0, MAX_REASON_LENGTH - 20) + TRUNCATION_MARKER;
  }
}
