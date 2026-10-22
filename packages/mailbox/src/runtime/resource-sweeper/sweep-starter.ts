import { SFNClient, StartExecutionCommand, ListExecutionsCommand, StopExecutionCommand }            from '@aws-sdk/client-sfn';
import { CaughtError, emitManualFinalize, toStackId, type LoggerBuffer, type ParentStackStatus }    from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CloudFormationCustomResourceEvent }                                                   from 'aws-lambda';

import type { StarterConfig }                                                                       from './config';
import type { RemovalPropertiesMap }                                                                from './removal';
import type { SweepTargetPlanner }                                                                  from './sweep-target-planner';

/**
 * Starts one Step Functions execution to sweep whatever the `SweepTargetPlanner` decides needs
 * sweeping for a custom-resource request. The targets travel in the execution input as
 * `{ toSweep: { <removalId>: <entry> } }`.
 *
 * A Delete sweeps only while the parent stack itself is being deleted: CloudFormation also sends
 * Delete to a replaced custom resource of a stack that stays alive, and sweeping then would destroy
 * the live resources the targets describe.
 *
 * Starting the sweep is best-effort: a failure is logged but never thrown.
 */
export class SweepStarter {
  constructor(
    private readonly config: StarterConfig,
    private readonly sfnClient: SFNClient,
    private readonly parentStackStatus: ParentStackStatus,
    private readonly planner: SweepTargetPlanner,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Starts the sweep the request's targets call for, if any. Resolves also when the sweep could not
   * be started (logged at error level, never thrown).
   */
  public async handle(event: CloudFormationCustomResourceEvent): Promise<void> {
    this.announce(event);

    const toSweep = await this.resolveSweepTargets(event);
    await this.startSweepWhenAny(event, toSweep);
  }

  private announce(event: CloudFormationCustomResourceEvent): void {
    emitManualFinalize({ ...event, StackId: toStackId(event.StackId) }, { service: this.config.serviceName });

    console.info('resource-sweeper-starter dispatch', {
      requestType: event.RequestType,
      requestId: event.RequestId,
      logicalResourceId: event.LogicalResourceId,
    });

    this.logger.debug('Starter invoked', {
      requestType: event.RequestType,
      logicalResourceId: event.LogicalResourceId,
    });
  }

  /**
   * The planner's targets, except that a Delete yields none unless the parent stack is being
   * deleted. An unreadable stack status counts as "not being deleted"; a skipped sweep leaves
   * orphans that can be reclaimed later.
   */
  private async resolveSweepTargets(event: CloudFormationCustomResourceEvent): Promise<RemovalPropertiesMap> {
    // A Delete of a stack that stays alive must not sweep: its targets are still in use.
    if (await this.isDeleteOfLiveStack(event)) {
      this.logSkippedSweep(event);
      return {};
    }

    return this.planner.plan(event);
  }

  private async isDeleteOfLiveStack(event: CloudFormationCustomResourceEvent): Promise<boolean> {
    return event.RequestType === 'Delete' && !(await this.parentStackStatus.isBeingDeleted(toStackId(event.StackId)));
  }

  private logSkippedSweep(event: CloudFormationCustomResourceEvent): void {
    this.logger.warn('Delete received while the parent stack is not being deleted; skipping the sweep', {
      stackId: event.StackId,
    });
  }

  private async startSweepWhenAny(event: CloudFormationCustomResourceEvent, toSweep: RemovalPropertiesMap): Promise<void> {
    // Nothing to sweep means no Step Functions call at all.
    if (Object.keys(toSweep).length === 0) {
      this.logger.debug('No sweep targets for this request; nothing to trigger', {
        requestType: event.RequestType,
      });
      return;
    }

    await this.startSweep(event, toSweep);
  }

  private async startSweep(event: CloudFormationCustomResourceEvent, toSweep: RemovalPropertiesMap): Promise<void> {
    try {
      await this.stopRunningExecutions();
      await this.startExecution(event, toSweep);
    } catch (thrown) {
      this.handleStartFailure(thrown);
    }
  }

  /**
   * Stops any execution left RUNNING by a prior trigger before a fresh one starts, which caps how
   * long a stale execution can outlive the deploy that started it.
   */
  private async stopRunningExecutions(): Promise<void> {
    const running = await this.sfnClient.send(
      new ListExecutionsCommand({ stateMachineArn: this.config.sweeperStateMachineArn, statusFilter: 'RUNNING' }),
    );
    for (const execution of running.executions ?? []) {
      // An execution without an ARN cannot be addressed, so it cannot be stopped.
      if (!execution.executionArn) {
        continue;
      }
      await this.sfnClient.send(new StopExecutionCommand({ executionArn: execution.executionArn }));
    }

    if (running.executions?.length) {
      this.logger.info('Stopped stale RUNNING execution(s) before starting', {
        count: running.executions.length,
      });
    }
  }

  private async startExecution(event: CloudFormationCustomResourceEvent, toSweep: RemovalPropertiesMap): Promise<void> {
    this.logger.info('Starting SFN execution', { executionName: event.RequestId, sweepTargetIds: Object.keys(toSweep) });

    await this.sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: this.config.sweeperStateMachineArn,
        name: event.RequestId,
        input: JSON.stringify({ toSweep }),
      }),
    );

    this.logger.info('SFN execution started successfully');
  }

  private handleStartFailure(thrown: unknown): void {
    const error = new CaughtError(thrown);
    // The execution is named after the request id, so one that already exists is this request's own earlier attempt: a retry.
    if (error.is('ExecutionAlreadyExists')) {
      this.logger.info('Execution already exists (likely a retry); treating as success');
      return;
    }

    // Any other error is logged, not thrown. error() (not warn()) so a real StartExecution failure
    // (e.g. StateMachineDeleting) is written at the default emit level.
    this.logger.error('Failed to start SFN execution (best-effort, will not propagate)', {
      errorName: error.name,
      errorMessage: error.message,
    });
  }
}
