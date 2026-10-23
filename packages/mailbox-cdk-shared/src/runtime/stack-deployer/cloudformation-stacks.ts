import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  type Capability,
  type Parameter,
  type Stack,
  type StackEvent,
  type Tag,
} from '@aws-sdk/client-cloudformation';

import type { Region }         from '../../runtime/handler-kit/aws-identifiers';
import { CaughtError }         from '../../runtime/handler-kit/errors/caught-error';
import type { LoggerBuffer }   from '../../runtime/handler-kit/logger-buffer';

import type { OperationInput } from './stack/stack-deployment';
import { isSwitchedOn }        from './stack/stack-flag';
import { StackStatus }         from './stack/stack-status';

const STACK_CAPABILITIES: Capability[] = ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'];

const FAILURE_EVENT_LIMIT = 8;

/**
 * The CloudFormation calls that deploy and delete the stack of one operation. It issues the calls and
 * resolves the races between them; where an operation goes next is the worker's decision. The client comes
 * from the region of the operation, or from the default region when the operation names none.
 */
export class CloudFormationStacks {
  private readonly clientForRegion: (region: Region) => CloudFormationClient;
  private readonly defaultRegion: Region;
  private readonly logger: LoggerBuffer;

  constructor(clientForRegion: (region: Region) => CloudFormationClient, defaultRegion: Region, logger: LoggerBuffer) {
    this.clientForRegion = clientForRegion;
    this.defaultRegion   = defaultRegion;
    this.logger          = logger;
  }

  /** The stack of the operation, or undefined when it does not exist. */
  async describe(operation: OperationInput): Promise<Stack | undefined> {
    try {
      const response = await this.clientFor(operation).send(new DescribeStacksCommand({ StackName: operation.stackName }));
      return response.Stacks?.[0];
    } catch (failure) {
      return this.missingStackOrRethrow(failure);
    }
  }

  /** One line per failed, rolled-back or cancelled event, newest first; empty when the events cannot be read. */
  async describeRecentFailures(operation: OperationInput): Promise<string[]> {
    try {
      const response = await this.clientFor(operation).send(new DescribeStackEventsCommand({ StackName: operation.stackName }));
      return this.failureLines(response.StackEvents ?? []);
    } catch (failure) {
      this.logger.warn(`Failed to describe stack events for ${operation.stackName}`, { error: CaughtError.readableMessage(failure) });
      return [];
    }
  }

  /** The outputs of a stack as the data of an answer to CloudFormation: those with both a key and a value. */
  outputsOf(stack: Stack): Record<string, string> {
    const outputs: Record<string, string> = {};
    for (const output of stack.Outputs ?? []) {
      if (output.OutputKey && output.OutputValue !== undefined) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    }
    return outputs;
  }

  /** The outputs the stack of the operation has now; undefined when the stack does not exist or cannot be read. */
  async currentOutputs(operation: OperationInput): Promise<Record<string, string> | undefined> {
    try {
      const stack = await this.describe(operation);
      return stack ? this.outputsOf(stack) : undefined;
    } catch (failure) {
      this.logger.warn(`Failed to read the outputs of stack ${operation.stackName}`, { error: CaughtError.readableMessage(failure) });
      return undefined;
    }
  }

  /**
   * Creates the stack, or updates it when it exists. A stack whose status refuses every update is deleted and
   * created again. An update that changes nothing is not a failure.
   */
  async startOrUpdate(operation: OperationInput): Promise<void> {
    // Parameter keys only: the values may be sensitive, such as an admin username.
    this.logger.debug('CloudFormation parameters', { parameterKeys: this.parameters(operation).map((parameter) => parameter.ParameterKey) });
    this.logger.debug('CloudFormation tags', { tags: this.tags(operation) });
    this.logger.debug('Stack operation', {
      stackName:             operation.stackName,
      templateUrl:           operation.templateUrl,
      terminationProtection: operation.terminationProtection,
    });

    const existing = await this.describeOrCreate(operation);
    if (!existing) {
      return;
    }

    if (StackStatus.requiresRecreate(existing.StackStatus)) {
      await this.recreateStuck(operation, existing);
      return;
    }

    await this.update(operation);
  }

  async deleteIfExists(operation: OperationInput): Promise<void> {
    const existing = await this.describe(operation);
    if (!existing) {
      return;
    }
    await this.clientFor(operation).send(new DeleteStackCommand({ StackName: operation.stackName }));
  }

  async recreate(operation: OperationInput): Promise<void> {
    await this.deleteForRecreate(operation);
    await this.createAfterDelete(operation);
  }

  private clientFor(operation: OperationInput): CloudFormationClient {
    return this.clientForRegion(operation.region ?? this.defaultRegion);
  }

  private missingStackOrRethrow(failure: unknown): undefined {
    const caught = new CaughtError(failure);
    if (caught.is('ValidationError') && caught.messageIncludes('does not exist')) {
      return undefined;
    }
    throw failure;
  }

  private failureLines(events: StackEvent[]): string[] {
    const lines: string[] = [];
    for (const event of events) {
      if (lines.length >= FAILURE_EVENT_LIMIT) {
        break;
      }

      // CloudFormation records the actionable reason on the FAILED event; a rollback or cancel event is
      // often all that is reported for the resources it took down with it.
      const status = event.ResourceStatus ?? '';
      if (!(status.includes('FAILED') || status.includes('ROLLBACK') || status.includes('CANCEL'))) {
        continue;
      }

      const logicalId = event.LogicalResourceId ?? 'UnknownLogicalId';
      const type      = event.ResourceType ?? 'UnknownType';
      const reason    = event.ResourceStatusReason ?? 'Unknown reason';
      lines.push(`${logicalId} (${type}) ${status}: ${reason}`);
    }
    return lines;
  }

  private async describeOrCreate(operation: OperationInput): Promise<Stack | undefined> {
    const existing = await this.describe(operation);
    if (existing) {
      return existing;
    }
    return this.createUnlessExists(operation);
  }

  private async recreateStuck(operation: OperationInput, existing: Stack): Promise<void> {
    this.logger.debug(`Stack ${operation.stackName} is in ${existing.StackStatus}; deleting and recreating.`);
    await this.recreate(operation);
  }

  private async deleteForRecreate(operation: OperationInput): Promise<void> {
    this.logger.debug(`Stack ${operation.stackName} requires recreation; deleting and recreating.`);
    await this.deleteIfExists(operation);
  }

  private async createAfterDelete(operation: OperationInput): Promise<void> {
    try {
      await this.createStack(operation);
    } catch (failure) {
      this.logger.error('Recreate CreateStack failed', { error: this.stringify(failure) });
      throw failure;
    }
  }

  private async createUnlessExists(operation: OperationInput): Promise<Stack | undefined> {
    try {
      await this.createStack(operation);
      return undefined;
    } catch (failure) {
      return this.existingStackOrRethrow(operation, failure);
    }
  }

  private async existingStackOrRethrow(operation: OperationInput, failure: unknown): Promise<Stack> {
    const caught = new CaughtError(failure);
    if (!caught.is('AlreadyExistsException') && !caught.messageIncludes('already exists')) {
      this.logger.error('CreateStack failed', { error: this.stringify(failure) });
      throw failure;
    }

    // Race: the stack appeared between the describe and the create.
    this.logger.debug(`Stack ${operation.stackName} AlreadyExistsException on CreateStack; re-describing to resolve.`);
    const existing = await this.describe(operation);
    if (!existing) {
      this.logger.error('CreateStack AlreadyExistsException but stack not found on re-describe', { error: this.stringify(failure) });
      throw failure;
    }
    return existing;
  }

  private async createStack(operation: OperationInput): Promise<void> {
    await this.clientFor(operation).send(
      new CreateStackCommand({
        StackName:                   operation.stackName,
        TemplateURL:                 operation.templateUrl,
        Parameters:                  this.parameters(operation),
        Tags:                        this.tags(operation),
        Capabilities:                STACK_CAPABILITIES,
        EnableTerminationProtection: isSwitchedOn(operation.terminationProtection),
      }),
    );
  }

  private async update(operation: OperationInput): Promise<void> {
    try {
      await this.clientFor(operation).send(
        new UpdateStackCommand({
          StackName:    operation.stackName,
          TemplateURL:  operation.templateUrl,
          Parameters:   this.parameters(operation),
          Tags:         this.tags(operation),
          Capabilities: STACK_CAPABILITIES,
        }),
      );
    } catch (failure) {
      this.ignoreNoUpdatesOrRethrow(failure);
    }
  }

  private ignoreNoUpdatesOrRethrow(failure: unknown): void {
    const caught = new CaughtError(failure);
    if (caught.is('ValidationError') && caught.messageIncludes('No updates are to be performed')) {
      return;
    }
    this.logger.error('UpdateStack failed', { error: this.stringify(failure) });
    throw failure;
  }

  private parameters(operation: OperationInput): Parameter[] {
    return this.nonEmptyEntries(operation.parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
  }

  private tags(operation: OperationInput): Tag[] {
    return this.nonEmptyEntries(operation.tags).map(([Key, Value]) => ({ Key, Value }));
  }

  private nonEmptyEntries(values: Record<string, string | undefined> | undefined): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(values ?? {})) {
      if (value !== undefined && value !== '') {
        entries.push([key, value]);
      }
    }
    return entries;
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
