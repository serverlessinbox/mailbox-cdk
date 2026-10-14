import { wrapHandler } from 'aws-custom-resources';
import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import {
  answerRequestWithBadConfig,
  emitManualFinalize,
  type CustomResourceAnswer,
  type CustomResourceRequest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { NewUpdateCycle, UpdaterTrigger } from './updater-trigger';

/** The answer to CloudFormation: the physical id when this resource sets one, and no attributes. A type alias, because `wrapHandler` requires `Data` to be a `Record<string, string>`. */
export type CfnTriggerAnswer = {
  readonly PhysicalResourceId?: string;
  readonly Data: Record<string, never>;
};

/**
 * Answers the custom-resource request of the deploy-end trigger. Create and Update run the update cycle before
 * they answer, Delete answers without running it and with no physical id of its own, and a bad configuration
 * is answered FAILED, except to a Delete. CloudFormation is answered from `handle`, so a failed cycle does not
 * fail the request: the stack's deployment goes on, and the failure is thrown afterwards for the trace.
 */
export class CfnTrigger implements UpdaterTrigger<void> {
  private readonly event: CloudFormationCustomResourceEvent;
  private readonly context: Context;
  private readonly newUpdateCycle: NewUpdateCycle;
  private readonly configError: string | undefined;
  private readonly serviceName: string;

  constructor(
    event: CloudFormationCustomResourceEvent,
    context: Context,
    newUpdateCycle: NewUpdateCycle,
    configError: string | undefined,
    serviceName: string,
  ) {
    this.event = event;
    this.context = context;
    this.newUpdateCycle = newUpdateCycle;
    this.configError = configError;
    this.serviceName = serviceName;
  }

  /** Answers CloudFormation, then throws what the update cycle threw. */
  public async handle(): Promise<void> {
    const cycleFailures: unknown[] = [];
    const answerCloudFormation = wrapHandler(async (event) => {
      const request: CustomResourceRequest = event;

      emitManualFinalize(event, { service: this.serviceName });
      return this.answerRequest(request, cycleFailures);
    });
    await answerCloudFormation(this.event, this.context, () => undefined);

    if (cycleFailures.length > 0) {
      throw cycleFailures[0];
    }
  }

  public answerFailure(): void {
    // CloudFormation was answered from `handle` before the failure surfaced; nothing is left to answer.
  }

  private async answerRequest(
    request: CustomResourceRequest,
    cycleFailures: unknown[],
  ): Promise<CfnTriggerAnswer | CustomResourceAnswer> {
    if (this.configError !== undefined) {
      return answerRequestWithBadConfig(request, this.configError);
    }

    // A Delete also arrives when CloudFormation replaces the resource, after which another cycle would only repeat the one just run.
    if (request.RequestType === 'Delete') {
      return { Data: {} };
    }

    await this.runCycle(cycleFailures);
    return { PhysicalResourceId: request.LogicalResourceId, Data: {} };
  }

  private async runCycle(cycleFailures: unknown[]): Promise<void> {
    try {
      await this.newUpdateCycle().run();
    } catch (thrown) {
      cycleFailures.push(thrown);
    }
  }
}
