import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { wrapHandler } from 'aws-custom-resources';
import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import {
  answerRequestWithBadConfig,
  emitManualFinalize,
  isParentStackRollingBack,
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
 * is answered FAILED, except to a Delete and to an Update while the parent stack rolls back, which are answered
 * SUCCESS with the physical id CloudFormation sent. CloudFormation is answered from `handle`, so a failed cycle
 * does not fail the request: the stack's deployment goes on, and the failure is thrown afterwards for the trace.
 */
export class CfnTrigger implements UpdaterTrigger<void> {
  private readonly event: CloudFormationCustomResourceEvent;
  private readonly context: Context;
  private readonly newUpdateCycle: NewUpdateCycle;
  private readonly cloudFormation: CloudFormationClient;
  private readonly configError: string | undefined;
  private readonly serviceName: string;

  constructor(
    event: CloudFormationCustomResourceEvent,
    context: Context,
    newUpdateCycle: NewUpdateCycle,
    cloudFormation: CloudFormationClient,
    configError: string | undefined,
    serviceName: string,
  ) {
    this.event = event;
    this.context = context;
    this.newUpdateCycle = newUpdateCycle;
    this.cloudFormation = cloudFormation;
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
      return this.answerBadConfig(request, this.configError);
    }

    // A Delete also arrives when CloudFormation replaces the resource, after which another cycle would only repeat the one just run.
    if (request.RequestType === 'Delete') {
      return { Data: {} };
    }

    await this.runCycle(cycleFailures);
    return { PhysicalResourceId: request.LogicalResourceId, Data: {} };
  }

  /**
   * CloudFormation re-sends an Update while the parent stack rolls back, and answering it FAILED strands the
   * stack in UPDATE_ROLLBACK_FAILED. There is no logger before the configuration loads, so the problem goes
   * straight to the console.
   */
  private async answerBadConfig(request: CustomResourceRequest, configError: string): Promise<CustomResourceAnswer> {
    if (request.RequestType === 'Update' && (await isParentStackRollingBack(request.StackId, this.cloudFormation))) {
      console.error('Configuration error on Update during parent stack rollback; responding SUCCESS', { error: configError });
      return { PhysicalResourceId: request.PhysicalResourceId };
    }
    return answerRequestWithBadConfig(request, configError);
  }

  private async runCycle(cycleFailures: unknown[]): Promise<void> {
    try {
      await this.newUpdateCycle().run();
    } catch (thrown) {
      cycleFailures.push(thrown);
    }
  }
}
