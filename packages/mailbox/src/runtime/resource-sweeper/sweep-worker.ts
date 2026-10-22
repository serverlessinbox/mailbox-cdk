import { ExpectedFailure, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import {
  isWorkerInput,
  type CertRemovalInput,
  type EdgeFunctionRemovalInput,
  type StackFailureDetectorRemovalInput,
  type TargetResult,
  type TargetSweeper,
  type WorkerInput,
  type WorkerOutput,
} from './removal';

/**
 * Sweeps one removal per invocation: dispatches the removal's payload on `removalType` to the
 * sweeper of that type and reports the sweep's outcome. Idempotent — every invocation re-checks and
 * deletes whatever is still pending.
 */
export class SweepWorker {
  constructor(
    private readonly logger: LoggerBuffer,
    private readonly certSweeper: TargetSweeper<CertRemovalInput>,
    private readonly edgeFunctionSweeper: TargetSweeper<EdgeFunctionRemovalInput>,
    private readonly stackFailureDetectorSweeper: TargetSweeper<StackFailureDetectorRemovalInput>,
  ) {}

  /**
   * Sweeps the removal `payload` describes and answers Step Functions with the outcome: `SUCCESS` when
   * the target is gone, `RETRY` when it is not deletable yet, `FAILED` when a retry would not help.
   * Rejects with an `ExpectedFailure` for a payload that is not a removal of a known type, and otherwise
   * only when a sweeper rejects.
   */
  public async handle(payload: unknown): Promise<WorkerOutput> {
    const input  = this.readInput(payload);
    const result = await this.sweep(input);

    return this.toWorkerOutput(result);
  }

  private readInput(payload: unknown): WorkerInput {
    const errors: string[] = [];
    if (!isWorkerInput(payload, { errors })) {
      throw new ExpectedFailure(`Invalid worker payload: ${errors.join('; ')}`);
    }
    return payload;
  }

  private sweep(input: WorkerInput): Promise<TargetResult> {
    this.logger.debug('Worker invoked', { removalType: input.removalType, rootStackName: input.rootStackName });

    switch (input.removalType) {
      case 'cert':
        return this.certSweeper.sweep(input);
      case 'edge-fn':
        return this.edgeFunctionSweeper.sweep(input);
      case 'detector':
        return this.stackFailureDetectorSweeper.sweep(input);
    }
  }

  private toWorkerOutput(result: TargetResult): WorkerOutput {
    if (result.status === 'SUCCESS') {
      this.logger.info('Worker completed successfully', { target: result.target });
    } else if (result.status === 'RETRY') {
      this.logger.info('Worker needs retry', { target: result.target, reason: result.reason });
    } else {
      this.logger.error('Worker failed', { target: result.target, reason: result.reason });
    }

    return { status: result.status, reason: result.reason };
  }
}
