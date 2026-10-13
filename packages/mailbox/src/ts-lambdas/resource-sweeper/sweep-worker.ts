import type { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type {
  CertRemovalInput,
  EdgeFunctionRemovalInput,
  StackFailureDetectorRemovalInput,
  TargetResult,
  TargetSweeper,
  WorkerInput,
  WorkerOutput,
} from './removal';

/**
 * Sweeps one removal per invocation: dispatches the removal's payload on `removalType` to the
 * sweeper of that type and reports the sweep's outcome. Idempotent — every invocation re-checks and
 * deletes whatever is still pending.
 *
 * A retry or failed outcome is an answer to Step Functions, not a throw.
 */
export class SweepWorker {
  constructor(
    private readonly logger: LoggerBuffer,
    private readonly certSweeper: TargetSweeper<CertRemovalInput>,
    private readonly edgeFunctionSweeper: TargetSweeper<EdgeFunctionRemovalInput>,
    private readonly stackFailureDetectorSweeper: TargetSweeper<StackFailureDetectorRemovalInput>,
  ) {}

  /**
   * Sweeps the removal `input` describes and answers Step Functions with the outcome: `SUCCESS` when
   * the target is gone, `RETRY` when it is not deletable yet, `FAILED` when a retry would not help.
   * Rejects only when a sweeper rejects.
   */
  public async handle(input: WorkerInput): Promise<WorkerOutput> {
    const result = await this.sweep(input);

    this.logOutcome(result);
    return this.toWorkerOutput(result);
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

  private logOutcome(result: TargetResult): void {
    if (result.status === 'done') {
      this.logger.info('Worker completed successfully', { target: result.target });
    } else if (result.status === 'retry') {
      this.logger.info('Worker needs retry', { target: result.target, reason: result.reason });
    } else {
      this.logger.error('Worker failed', { target: result.target, reason: result.reason });
    }
  }

  private toWorkerOutput(result: TargetResult): WorkerOutput {
    if (result.status === 'done') {
      return { status: 'SUCCESS' };
    }
    if (result.status === 'retry') {
      return { status: 'RETRY', reason: result.reason };
    }
    return { status: 'FAILED', reason: result.reason };
  }
}
