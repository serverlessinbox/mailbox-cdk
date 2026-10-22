import type { CfnResponder }               from './answers/cfn-responder';
import type { StackDeployerWorker }        from './stack-deployer-worker';
import type { StackDeploymentEventReader } from './stack/stack-deployment-event-reader';
import type { WorkerResult }               from './worker-result';

/**
 * Turns the input the worker function receives from the Step Functions workflow into the invocation the
 * worker carries out: it reads the input and works out where the answer to CloudFormation goes. How the
 * invocation ends, and how a failure is answered, is not its concern.
 */
export class StackDeployerWorkerRequestHandler {
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;
  private readonly worker: StackDeployerWorker;

  constructor(events: StackDeploymentEventReader, responder: CfnResponder, worker: StackDeployerWorker) {
    this.events    = events;
    this.responder = responder;
    this.worker    = worker;
  }

  /** A malformed input throws before the worker does anything. */
  async handle(event: unknown, logStreamName: string | undefined): Promise<WorkerResult> {
    const invoke = this.events.readSfnInvokeEvent(event);
    console.info('stack-deployer-worker dispatch', {
      mode: invoke.mode,
      attempt: invoke.attempt,
    });

    return this.worker.handle(invoke, this.responder.targetForStep(invoke, logStreamName));
  }
}
