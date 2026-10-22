import { emitManualFinalize }                from '../../runtime/handler-kit/custom-resource/custom-resource-manual-finalize';

import type { CfnResponder }                 from './answers/cfn-responder';
import type { StackDeployerStarter }         from './stack-deployer-starter';
import type { StackDeploymentEventReader }   from './stack/stack-deployment-event-reader';

/**
 * Turns the event the starter function receives into a request the starter can act on: it reads the event,
 * works out where the answer goes and writes the lines an operator needs to release a resource whose
 * function never answers. Whether the request is carried out, and how a failure is answered, is not its concern.
 */
export class StackDeployerStarterRequestHandler {
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;
  private readonly starter: StackDeployerStarter;

  constructor(events: StackDeploymentEventReader, responder: CfnResponder, starter: StackDeployerStarter) {
    this.events    = events;
    this.responder = responder;
    this.starter   = starter;
  }

  /** A malformed event throws before anything is written or started. */
  async handle(event: unknown, logStreamName: string | undefined): Promise<void> {
    const request = this.events.readCfnRequest(event);
    console.info('stack-deployer-starter dispatch', {
      requestType: request.RequestType,
      logicalResourceId: request.LogicalResourceId,
    });
    const target = this.responder.targetForRequest(request, logStreamName);

    emitManualFinalize(request, { physicalResourceId: target.physicalResourceId });

    await this.starter.start(request, target);
  }
}
