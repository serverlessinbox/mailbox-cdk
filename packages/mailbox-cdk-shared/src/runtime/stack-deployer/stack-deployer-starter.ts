import { DescribeExecutionCommand, StartExecutionCommand, type ExecutionStatus, type SFNClient }         from '@aws-sdk/client-sfn';

import { formatArn, parseArn, type ParsedArn }                                                           from '../../runtime/handler-kit/arn';
import type { StackId }                                                                                  from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { CaughtError }                                                                                   from '../../runtime/handler-kit/errors/caught-error';
import { ExpectedFailure }                                                                               from '../../runtime/handler-kit/errors/expected-failure';
import type { LoggerBuffer }                                                                             from '../../runtime/handler-kit/logger-buffer';

import type { CfnReplyTarget, CfnResponder }                                                             from './answers/cfn-responder';
import { STATE_MACHINE_ARN_VARIABLE }                                                                    from './config';
import { toExecutionArn, toExecutionName, type ExecutionArn, type ExecutionName, type StateMachineArn }  from './deployer-identifiers';
import type { StackDeploymentEventReader }                                                               from './stack/stack-deployment-event-reader';
import type { BrandedStackDeployerProperties, CfnRequest, RequestType, WorkflowInput }                   from './stack/stack-deployment';
import { StackOperationFailure }                                                                         from './stack/stack-operation-failure';

// CloudFormation truncates auto-generated physical names to 64 characters; the root stack name is limited so
// that the names built from it stay inside that.
const MAX_ROOT_STACK_NAME_LENGTH = 24;

// The execution name is the request id, and a rejected name is retried as `-r2` up to `-r5`.
const LAST_EXECUTION_NAME_ATTEMPT = 5;

const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'];

type NameAttempt = 'started' | 'nameTaken' | 'failed';

/**
 * Starts the Step Functions execution that deploys, updates or deletes a stack. It runs for a CloudFormation
 * custom-resource request and answers it only when no execution will: the worker of a started execution
 * answers CloudFormation when the stack operation ends. A request it cannot start an execution for throws,
 * an ExpectedFailure for a rejected request and a StackOperationFailure for a failed AWS call.
 */
export class StackDeployerStarter {
  private readonly stateMachineArn: StateMachineArn;
  private readonly stepFunctions: SFNClient;
  private readonly events: StackDeploymentEventReader;
  private readonly responder: CfnResponder;
  private readonly logger: LoggerBuffer;

  constructor(
    stateMachineArn: StateMachineArn,
    stepFunctions: SFNClient,
    events: StackDeploymentEventReader,
    responder: CfnResponder,
    logger: LoggerBuffer,
  ) {
    this.stateMachineArn = stateMachineArn;
    this.stepFunctions   = stepFunctions;
    this.events          = events;
    this.responder       = responder;
    this.logger          = logger;
  }

  /**
   * Starts an execution named after the request id, which CloudFormation keeps when it retries a request, so
   * a retry finds the execution that is already running. A rejected request throws an ExpectedFailure; an
   * execution that cannot be started for any other reason throws a StackOperationFailure.
   */
  async start(request: CfnRequest, target: CfnReplyTarget): Promise<void> {
    const properties = this.readProperties(request);

    this.rejectTooLongRootStackName(request);
    this.rejectSlashStateMachineArn();

    const input: WorkflowInput = { cfn: target.cfn, op: { ...properties, requestType: request.RequestType } };
    await this.startExecution(toExecutionName(request.RequestId), input, target);
  }

  private readProperties(request: CfnRequest): BrandedStackDeployerProperties {
    const properties = this.events.readProperties(request.ResourceProperties, request.RequestType);
    this.logger.debug('CFN handler invoked', {
      requestType:       request.RequestType,
      logicalResourceId: request.LogicalResourceId,
      stackName:         properties.stackName,
    });
    return properties;
  }

  private rejectTooLongRootStackName(request: CfnRequest): void {
    // Only a Create is rejected: an existing stack keeps working with its name.
    if (request.RequestType !== 'Create') {
      return;
    }

    const rootStackName = this.rootStackNameOf(request.StackId);
    if (rootStackName.length > MAX_ROOT_STACK_NAME_LENGTH) {
      throw new ExpectedFailure(
        `Root stack name "${rootStackName}" exceeds maximum length of ${MAX_ROOT_STACK_NAME_LENGTH} characters (got ${rootStackName.length}). ` +
        'CloudFormation truncates auto-generated resource names to 64 characters, which can break name-based IAM lookups. Please use a shorter stack name.',
      );
    }
  }

  // A stack id is `arn:{partition}:cloudformation:{region}:{account}:stack/{name}/{guid}`; anything else is rejected.
  private rootStackNameOf(stackId: StackId): string {
    const parsed = this.parseStackId(stackId);
    if (parsed.service !== 'cloudformation' || parsed.resourceType !== 'stack') {
      throw new ExpectedFailure(`StackId "${stackId}" is not a CloudFormation stack ARN`);
    }
    return parsed.resourceId.split('/')[0];
  }

  private parseStackId(stackId: StackId): ParsedArn {
    try {
      return parseArn(stackId);
    } catch (failure) {
      throw this.malformedStackId(failure);
    }
  }

  private malformedStackId(failure: unknown): ExpectedFailure {
    return new ExpectedFailure(`StackId is malformed: ${CaughtError.readableMessage(failure)}`);
  }

  private rejectSlashStateMachineArn(): void {
    // Step Functions state machine ARNs put a colon before the name; the slash form is a configuration error.
    if (this.stateMachineArn.includes(':stateMachine/')) {
      throw new ExpectedFailure(
        `${STATE_MACHINE_ARN_VARIABLE} is invalid (expected ':stateMachine:{name}', got ':stateMachine/{name}'): ${this.stateMachineArn}`,
      );
    }
  }

  private async startExecution(executionName: ExecutionName, input: WorkflowInput, target: CfnReplyTarget): Promise<void> {
    try {
      this.logger.debug('Starting Step Functions execution', { executionName, stateMachineArn: this.stateMachineArn });
      await this.sendStart(executionName, input);
      this.logger.info('Step Functions execution started successfully', { executionName });
    } catch (failure) {
      await this.handleStartFailure(failure, executionName, input, target);
    }
  }

  private async handleStartFailure(failure: unknown, executionName: ExecutionName, input: WorkflowInput, target: CfnReplyTarget): Promise<void> {
    const caught = new CaughtError(failure);
    if (!this.isExecutionAlreadyExists(caught)) {
      this.logger.error('Failed to start Step Functions execution', {
        errorName:    caught.name,
        errorMessage: caught.describeWithMetadata(),
      });
      throw this.startFailure(input.op.requestType, failure);
    }

    this.logger.debug('ExecutionAlreadyExists on start', { executionName });

    // The same request id was retried by CloudFormation, and the earlier execution is handling, or has
    // handled, the answer. A Delete needs no more than that.
    if (input.op.requestType === 'Delete') {
      this.logger.debug('ExecutionAlreadyExists on Delete; responding SUCCESS');
      await this.responder.succeed(target, { reason: 'Delete already in progress (ExecutionAlreadyExists); continuing without waiting' });
      return;
    }

    await this.resumeAfterExistingExecution(executionName, input, failure);
  }

  private async resumeAfterExistingExecution(executionName: ExecutionName, input: WorkflowInput, alreadyExistsFailure: unknown): Promise<void> {
    const executionArn = this.executionArn(executionName);

    let status: ExecutionStatus | undefined;
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

    if (status !== undefined && TERMINAL_EXECUTION_STATUSES.includes(status)) {
      this.logger.info('Existing execution is terminal; attempting retry with suffixed name', { executionArn, status });
      await this.startAfterTerminalExecution(executionName, input);
      return;
    }

    throw this.startFailure(input.op.requestType, alreadyExistsFailure);
  }

  private async existingExecutionStatus(executionArn: ExecutionArn): Promise<ExecutionStatus | undefined> {
    this.logger.debug('Checking existing execution status', { executionArn });
    const response = await this.stepFunctions.send(new DescribeExecutionCommand({ executionArn }));
    return response.status;
  }

  private async startAfterTerminalExecution(executionName: ExecutionName, input: WorkflowInput): Promise<void> {
    if (await this.startWithSuffixedNames(executionName, input)) {
      return;
    }
    this.logger.error(`Could not start execution after ${LAST_EXECUTION_NAME_ATTEMPT} retries`);
    throw new ExpectedFailure(`Could not start execution after ${LAST_EXECUTION_NAME_ATTEMPT} retries: all suffixed names exhausted`);
  }

  private async startAfterDescribeFailure(executionName: ExecutionName, input: WorkflowInput, describeFailure: unknown): Promise<void> {
    // The earlier execution cannot be inspected, so it is treated as ended.
    const describeMessage = CaughtError.describeWithMetadata(describeFailure);
    this.logger.warn('DescribeExecution failed; attempting retry with suffixed name', { error: describeMessage });
    if (await this.startWithSuffixedNames(executionName, input)) {
      return;
    }
    this.logger.error('All retries exhausted after DescribeExecution failure');
    throw new ExpectedFailure(`DescribeExecution failed and could not start retry: ${describeMessage}`);
  }

  private async startWithSuffixedNames(executionName: ExecutionName, input: WorkflowInput): Promise<boolean> {
    for (let attempt = 2; attempt <= LAST_EXECUTION_NAME_ATTEMPT; attempt++) {
      const outcome = await this.tryStart(toExecutionName(`${executionName}-r${attempt}`), input);
      if (outcome === 'started') {
        return true;
      }
      if (outcome === 'failed') {
        return false;
      }
    }
    return false;
  }

  private async tryStart(suffixedName: ExecutionName, input: WorkflowInput): Promise<NameAttempt> {
    try {
      await this.sendStart(suffixedName, input);
      this.logger.info('Retry execution started successfully', { suffixedName });
      return 'started';
    } catch (failure) {
      return this.classifySuffixedStartFailure(failure, suffixedName);
    }
  }

  private classifySuffixedStartFailure(failure: unknown, suffixedName: ExecutionName): NameAttempt {
    const caught = new CaughtError(failure);
    if (this.isExecutionAlreadyExists(caught)) {
      this.logger.warn('Suffixed name also exists (retry)', { suffixedName, error: caught.describeWithMetadata() });
      return 'nameTaken';
    }
    this.logger.error('Retry execution failed (non-ExecutionAlreadyExists)', { suffixedName, error: caught.describeWithMetadata() });
    return 'failed';
  }

  private async sendStart(executionName: ExecutionName, input: WorkflowInput): Promise<void> {
    await this.stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn,
        name:            executionName,
        input:           JSON.stringify(input),
      }),
    );
  }

  private isExecutionAlreadyExists(caught: CaughtError): boolean {
    return caught.is('ExecutionAlreadyExists') || caught.messageIncludes('ExecutionAlreadyExists');
  }

  // An execution lives in the account and region of its state machine, as `execution:{state machine name}:{execution name}`.
  private executionArn(executionName: ExecutionName): ExecutionArn {
    const stateMachine = parseArn(this.stateMachineArn);
    return toExecutionArn(formatArn({ ...stateMachine, resource: `execution:${stateMachine.resourceId}:${executionName}` }));
  }

  private startFailure(requestType: RequestType, failure: unknown): StackOperationFailure {
    const ignoredNote = requestType === 'Delete' ? ' (ignored for Delete)' : '';
    return new StackOperationFailure(`Failed to start Step Functions execution${ignoredNote}`, failure);
  }
}
