import { toPhysicalResourceId, type PhysicalResourceId } from './deployer-identifiers';
import type { CfnEnvelope, CfnRequest, RequestType, SfnInvokeEvent } from './stack-deployment';

// CloudFormation caps the size of a response reason; this leaves headroom.
const MAX_REASON_LENGTH = 3500;
const TRUNCATION_MARKER = ' …(truncated)';

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

type CfnStatus = 'SUCCESS' | 'FAILED';

/**
 * Sends the answer to a CloudFormation custom-resource request by PUT to its response URL. The deployer
 * answers CloudFormation itself, from the starter or from the worker, rather than through `wrapHandler`.
 * It does not decide the answer; callers do.
 */
export class CfnResponder {
  targetForRequest(request: CfnRequest, logStreamName: string | undefined): CfnReplyTarget {
    return {
      cfn: {
        ResponseURL: request.ResponseURL,
        StackId: request.StackId,
        RequestId: request.RequestId,
        LogicalResourceId: request.LogicalResourceId,
        ResourceType: request.ResourceType,
      },
      physicalResourceId: this.physicalIdOfRequest(request),
      logStreamName,
    };
  }

  targetForStep(event: SfnInvokeEvent, logStreamName: string | undefined): CfnReplyTarget {
    return { cfn: event.cfn, physicalResourceId: toPhysicalResourceId(event.op.stackName), logStreamName };
  }

  /** A reason cut to the size CloudFormation accepts, for the reasons that carry text of unbounded length such as stack events. */
  limitedReason(reason: string): string {
    if (reason.length <= MAX_REASON_LENGTH) {
      return reason;
    }
    return reason.slice(0, MAX_REASON_LENGTH - 20) + TRUNCATION_MARKER;
  }

  async succeed(target: CfnReplyTarget, answer?: CfnSuccessAnswer): Promise<void> {
    await this.put(target, 'SUCCESS', answer?.reason, answer?.data);
  }

  async fail(target: CfnReplyTarget, reason: string): Promise<void> {
    await this.put(target, 'FAILED', reason, undefined);
  }

  /**
   * Answers a request that could not be carried out. A Delete is answered SUCCESS, because a failed Delete
   * would leave the parent stack unable to delete or roll back; any other request is answered FAILED.
   */
  async answerFailure(target: CfnReplyTarget, requestType: RequestType, reason: string): Promise<void> {
    if (requestType === 'Delete') {
      await this.succeed(target, { reason });
      return;
    }
    await this.fail(target, reason);
  }

  private async put(target: CfnReplyTarget, status: CfnStatus, reason: string | undefined, data: Record<string, string> | undefined): Promise<void> {
    const body = {
      Status: status,
      Reason: this.reasonOf(target, reason),
      PhysicalResourceId: target.physicalResourceId,
      StackId: target.cfn.StackId,
      RequestId: target.cfn.RequestId,
      LogicalResourceId: target.cfn.LogicalResourceId,
      NoEcho: false,
      Data: data ?? {},
    };

    const response = await fetch(target.cfn.ResponseURL, {
      method: 'PUT',
      body: JSON.stringify(body),
      // CloudFormation expects an empty content-type
      headers: {
        'content-type': '',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to PUT CloudFormation response (HTTP ${response.status}): ${text}`);
    }
  }

  private physicalIdOfRequest(request: CfnRequest): PhysicalResourceId {
    const stackName = request.ResourceProperties.stackName;
    return stackName === undefined ? UNNAMED_STACK_RESOURCE_ID : toPhysicalResourceId(stackName);
  }

  private reasonOf(target: CfnReplyTarget, reason: string | undefined): string | undefined {
    if (reason !== undefined) {
      return reason;
    }
    return target.logStreamName ? `See CloudWatch Log Stream: ${target.logStreamName}` : undefined;
  }
}
