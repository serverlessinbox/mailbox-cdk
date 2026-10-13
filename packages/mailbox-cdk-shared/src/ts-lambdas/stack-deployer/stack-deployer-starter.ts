import { DescribeExecutionCommand, StartExecutionCommand, type SFNClient } from '@aws-sdk/client-sfn';
import { CaughtError } from '../shared/caught-error';
import { ExpectedFailure } from '../shared/expected-failure';
import type { LoggerBuffer } from '../shared/logger-buffer';
import type { CfnReplyTarget, CfnResponder } from './cfn-responder';
import { StackOperationFailure } from './stack-operation-failure';
import type { StackDeploymentEventReader } from './stack-deployment-event-reader';
import type { CfnRequest, RequestType, WorkflowInput } from './stack-deployment';

// CloudFormation truncates auto-generated physical names to 64 characters, and the names of the IAM roles
// built from the root stack name need room beside it.
const MAX_ROOT_STACK_NAME_LENGTH = 24;

// The execution name is the request id, and a rejected name is retried as `-r2` up to `-r5`.
const LAST_EXECUTION_NAME_ATTEMPT = 5;

const TERMINAL_EXECUTION_STATUSES = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'];

type NameAttempt = 'started' | 'nameTaken' | 'failed';

/**
 * Starts the Step Functions execution that deploys, updates or deletes a stack. It runs for a CloudFormation
 * custom-resource request and answers it only when no execution will: the worker of a started execution
 * answers CloudFormation when the stack operation ends. A request it cannot start an execution for throws.
 * The failures that are answered to CloudFormation are the ExpectedFailure and the StackOperationFailure.
 */
export class StackDeployerStarter {
  private readonly stateMachineArn: string;
  private readonly stepFunctions: SFNClient;
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;
  private readonly logger: LoggerBuffer;

  constructor(
    stateMachineArn: string,
    stepFunctions: SFNClient,
    events: StackDeploymentEventReader,
    responder: CfnResponder,
    logger: LoggerBuffer,
  ) {
    this.stateMachineArn = stateMachineArn;
    this.stepFunctions = stepFunctions;
    this.events = events;
    this.responder = responder;
    this.logger = logger;
  }

  /**
   * Starts an execution named after the request id, which CloudFormation keeps when it retries a request, so
   * a retry finds the execution that is already running. A rejected request throws an ExpectedFailure; an
   * execution that cannot be started for any other reason throws a StackOperationFailure.
   */
  async start(request: CfnRequest, target: CfnReplyTarget): Promise<void> {
    const properties = this.events.readProperties(request.ResourceProperties, request.RequestType);
    this.logger.debug('CFN handler invoked', {
      requestType: request.RequestType,
      logicalResourceId: request.LogicalResourceId,
      stackName: properties.stackName,
    });

    this.rejectTooLongRootStackName(request);
    this.rejectSlashStateMachineArn();

    const input: WorkflowInput = { cfn: target.cfn, op: { ...properties, requestType: request.RequestType } };
    await this.startExecution(request.RequestId, input, target);
  }

  private rejectTooLongRootStackName(request: CfnRequest): void {
    // Only a Create is rejected: an existing stack keeps working with its name.
    if (request.RequestType !== 'Create') {
      return;
    }

    // A stack id is `arn:…:stack/{name}/{guid}`; one that does not split that way is not checked.
    const stackIdParts = request.StackId.split('/');
    if (stackIdParts.length < 2) {
      return;
    }

    const rootStackName = stackIdParts[1];
    if (rootStackName.length > MAX_ROOT_STACK_NAME_LENGTH) {
      throw new ExpectedFailure(
        `Root stack name "${rootStackName}" exceeds maximum length of ${MAX_ROOT_STACK_NAME_LENGTH} characters (got ${rootStackName.length}). ` +
        'CloudFormation truncates auto-generated resource names to 64 characters, which can break name-based IAM lookups. Please use a shorter stack name.',
      );
    }
  }

  private rejectSlashStateMachineArn(): void {
    // Step Functions state machine ARNs put a colon before the name; the slash form is a configuration error.
    if (this.stateMachineArn.includes(':stateMachine/')) {
      throw new ExpectedFailure(
        `MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is invalid (expected ':stateMachine:{name}', got ':stateMachine/{name}'): ${this.stateMachineArn}`,
      );
    }
  }

  private async startExecution(executionName: string, input: WorkflowInput, target: CfnReplyTarget): Promise<void> {
    try {
      this.logger.debug('Starting Step Functions execution', { executionName, stateMachineArn: this.stateMachineArn });
      await this.sendStart(executionName, input);
      this.logger.info('Step Functions execution started successfully', { executionName });
    } catch (failure) {
      await this.handleStartFailure(failure, executionName, input, target);
    }
  }

  private async handleStartFailure(failure: unknown, executionName: string, input: WorkflowInput, target: CfnReplyTarget): Promise<void> {
    const caught = new CaughtError(failure);
    this.logger.error('Failed to start Step Functions execution', {
      errorName: caught.name,
      errorMessage: caught.describeWithMetadata(),
    });

    if (!this.isExecutionAlreadyExists(caught)) {
      throw this.startFailure(input.op.requestType, failure);
    }

    // The same request id was retried by CloudFormation, and the earlier execution is handling, or has
    // handled, the answer. A Delete needs no more than that.
    if (input.op.requestType === 'Delete') {
      this.logger.debug('ExecutionAlreadyExists on Delete; responding SUCCESS');
      await this.responder.succeed(target, { reason: 'Delete already in progress (ExecutionAlreadyExists); continuing without waiting' });
      return;
    }

    await this.resumeAfterExistingExecution(executionName, input, failure);
  }

  private async resumeAfterExistingExecution(executionName: string, input: WorkflowInput, alreadyExistsFailure: unknown): Promise<void> {
    const executionArn = this.executionArn(executionName);

    let status: string;
    try {
      status = await this.existingExecutionStatus(executionArn);
    } catch (describeFailure) {
      await this.startAfterDescribeFailure(executionName, input, describeFailure);
      return;
    }

    // A running execution sends the CloudFormation answer on its own.
    if (status === 'RUNNING') {
      this.logger.info('Existing execution is RUNNING; returning without response', { executionArn, status });
      return;
    }

    if (TERMINAL_EXECUTION_STATUSES.includes(status)) {
      this.logger.info('Existing execution is terminal; attempting retry with suffixed name', { executionArn, status });
      await this.startAfterTerminalExecution(executionName, input);
      return;
    }

    throw this.startFailure(input.op.requestType, alreadyExistsFailure);
  }

  private async existingExecutionStatus(executionArn: string): Promise<string> {
    this.logger.debug('Checking existing execution status', { executionArn });
    const response = await this.stepFunctions.send(new DescribeExecutionCommand({ executionArn }));
    return response.status ?? '';
  }

  private async startAfterTerminalExecution(executionName: string, input: WorkflowInput): Promise<void> {
    if (await this.startWithSuffixedNames(executionName, input)) {
      return;
    }
    this.logger.error(`Could not start execution after ${LAST_EXECUTION_NAME_ATTEMPT} retries`);
    throw new ExpectedFailure(this.responder.limitedReason(`Could not start execution after ${LAST_EXECUTION_NAME_ATTEMPT} retries: all suffixed names exhausted`));
  }

  private async startAfterDescribeFailure(executionName: string, input: WorkflowInput, describeFailure: unknown): Promise<void> {
    // The earlier execution cannot be inspected, so it is treated as ended.
    const describeMessage = new CaughtError(describeFailure).describeWithMetadata();
    this.logger.warn('DescribeExecution failed; attempting retry with suffixed name', { error: describeMessage });
    if (await this.startWithSuffixedNames(executionName, input)) {
      return;
    }
    this.logger.error('All retries exhausted after DescribeExecution failure');
    throw new ExpectedFailure(this.responder.limitedReason(`DescribeExecution failed and could not start retry: ${describeMessage}`));
  }

  private async startWithSuffixedNames(executionName: string, input: WorkflowInput): Promise<boolean> {
    for (let attempt = 2; attempt <= LAST_EXECUTION_NAME_ATTEMPT; attempt++) {
      const outcome = await this.tryStart(`${executionName}-r${attempt}`, input);
      if (outcome === 'started') {
        return true;
      }
      if (outcome === 'failed') {
        return false;
      }
    }
    return false;
  }

  private async tryStart(suffixedName: string, input: WorkflowInput): Promise<NameAttempt> {
    try {
      await this.sendStart(suffixedName, input);
      this.logger.info('Retry execution started successfully', { suffixedName });
      return 'started';
    } catch (failure) {
      return this.classifySuffixedStartFailure(failure, suffixedName);
    }
  }

  private classifySuffixedStartFailure(failure: unknown, suffixedName: string): NameAttempt {
    const caught = new CaughtError(failure);
    if (this.isExecutionAlreadyExists(caught)) {
      this.logger.warn('Suffixed name also exists (retry)', { suffixedName, error: caught.describeWithMetadata() });
      return 'nameTaken';
    }
    this.logger.error('Retry execution failed (non-ExecutionAlreadyExists)', { suffixedName, error: caught.describeWithMetadata() });
    return 'failed';
  }

  private async sendStart(executionName: string, input: WorkflowInput): Promise<void> {
    await this.stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn,
        name: executionName,
        input: JSON.stringify(input),
      }),
    );
  }

  private isExecutionAlreadyExists(caught: CaughtError): boolean {
    return caught.is('ExecutionAlreadyExists') || caught.messageIncludes('ExecutionAlreadyExists');
  }

  // State machine ARNs and execution ARNs differ in the resource type only: `…:stateMachine:{name}` and `…:execution:{name}:{executionName}`.
  private executionArn(executionName: string): string {
    return `${this.stateMachineArn.replace(':stateMachine:', ':execution:')}:${executionName}`;
  }

  private startFailure(requestType: RequestType, failure: unknown): StackOperationFailure {
    const ignoredNote = requestType === 'Delete' ? ' (ignored for Delete)' : '';
    return new StackOperationFailure(`Failed to start Step Functions execution${ignoredNote}`, failure);
  }
}
