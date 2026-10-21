import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  type Capability,
  type Stack,
  type StackEvent,
} from '@aws-sdk/client-cloudformation';

import { CaughtError }         from '../../runtime/handler-kit/errors/caught-error';
import type { Region }         from '../../runtime/handler-kit/aws-identifiers';
import type { LoggerBuffer }   from '../../runtime/handler-kit/logger-buffer';

import type { OperationInput } from './stack-deployment';
import { isSwitchedOn }        from './stack-flag';
import { StackStatus }         from './stack-status';

const STACK_CAPABILITIES: Capability[] = ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'];

const FAILURE_EVENT_LIMIT = 8;

interface CfnParameter {
  readonly ParameterKey: string;
  readonly ParameterValue: string;
}

interface CfnTag {
  readonly Key: string;
  readonly Value: string;
}

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
  async describe(op: OperationInput): Promise<Stack | undefined> {
    try {
      const response = await this.clientFor(op).send(new DescribeStacksCommand({ StackName: op.stackName }));
      return response.Stacks?.[0];
    } catch (failure) {
      return this.missingStackOrRethrow(failure);
    }
  }

  /** One line per failed, rolled-back or cancelled event, newest first; empty when the events cannot be read. */
  async describeRecentFailures(op: OperationInput): Promise<string[]> {
    try {
      const response = await this.clientFor(op).send(new DescribeStackEventsCommand({ StackName: op.stackName }));
      return this.failureLines(response.StackEvents ?? []);
    } catch (failure) {
      this.logger.warn(`Failed to describe stack events for ${op.stackName}`, { error: new CaughtError(failure).message ?? String(failure) });
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
  async currentOutputs(op: OperationInput): Promise<Record<string, string> | undefined> {
    try {
      const stack = await this.describe(op);
      return stack ? this.outputsOf(stack) : undefined;
    } catch (failure) {
      return this.warnOutputsUnreadable(op, failure);
    }
  }

  /**
   * Creates the stack, or updates it when it exists. A stack in a state CloudFormation can no longer update
   * is deleted and created again. An update that changes nothing is not a failure.
   */
  async startOrUpdate(op: OperationInput): Promise<void> {
    this.logOperation(op);

    let existing = await this.describe(op);
    if (!existing) {
      existing = await this.createUnlessExists(op);
      if (!existing) {
        return;
      }
    }

    if (new StackStatus(existing.StackStatus).requiresRecreate()) {
      this.logger.debug(`Stack ${op.stackName} is in ${existing.StackStatus}; deleting and recreating.`);
      await this.recreate(op);
      return;
    }

    await this.update(op);
  }

  async deleteIfExists(op: OperationInput): Promise<void> {
    const existing = await this.describe(op);
    if (!existing) {
      return;
    }
    await this.clientFor(op).send(new DeleteStackCommand({ StackName: op.stackName }));
  }

  async recreate(op: OperationInput): Promise<void> {
    this.logger.debug(`Stack ${op.stackName} requires recreation; deleting and recreating.`);
    await this.deleteIfExists(op);
    try {
      await this.createStack(op);
    } catch (failure) {
      this.logger.error('Recreate CreateStack failed', { error: this.stringify(failure) });
      throw failure;
    }
  }

  private clientFor(op: OperationInput): CloudFormationClient {
    return this.clientForRegion(op.region ?? this.defaultRegion);
  }

  private warnOutputsUnreadable(op: OperationInput, failure: unknown): undefined {
    this.logger.warn(`Failed to read the outputs of stack ${op.stackName}`, { error: new CaughtError(failure).message ?? String(failure) });
    return undefined;
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

  private logOperation(op: OperationInput): void {
    // Parameter keys only: the values may be sensitive, such as an admin username.
    const parameterKeys = this.parameters(op).map((parameter) => parameter.ParameterKey);
    this.logger.debug('CloudFormation parameters', { parameterKeys });
    this.logger.debug('CloudFormation tags', { tags: this.tags(op) });
    this.logger.debug('Stack operation', {
      stackName: op.stackName,
      templateUrl: op.templateUrl,
      terminationProtection: op.terminationProtection,
    });
  }

  private async createUnlessExists(op: OperationInput): Promise<Stack | undefined> {
    try {
      await this.createStack(op);
      return undefined;
    } catch (failure) {
      return this.existingStackOrRethrow(op, failure);
    }
  }

  private async existingStackOrRethrow(op: OperationInput, failure: unknown): Promise<Stack> {
    const caught = new CaughtError(failure);
    if (!caught.is('AlreadyExistsException') && !caught.messageIncludes('already exists')) {
      this.logger.error('CreateStack failed', { error: this.stringify(failure) });
      throw failure;
    }

    // Race: the stack appeared between the describe and the create.
    this.logger.debug(`Stack ${op.stackName} AlreadyExistsException on CreateStack; re-describing to resolve.`);
    const existing = await this.describe(op);
    if (!existing) {
      this.logger.error('CreateStack AlreadyExistsException but stack not found on re-describe', { error: this.stringify(failure) });
      throw failure;
    }
    return existing;
  }

  private async createStack(op: OperationInput): Promise<void> {
    await this.clientFor(op).send(
      new CreateStackCommand({
        StackName: op.stackName,
        TemplateURL: op.templateUrl,
        Parameters: this.parameters(op),
        Tags: this.tags(op),
        Capabilities: STACK_CAPABILITIES,
        EnableTerminationProtection: isSwitchedOn(op.terminationProtection),
      }),
    );
  }

  private async update(op: OperationInput): Promise<void> {
    try {
      await this.clientFor(op).send(
        new UpdateStackCommand({
          StackName: op.stackName,
          TemplateURL: op.templateUrl,
          Parameters: this.parameters(op),
          Tags: this.tags(op),
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

  private parameters(op: OperationInput): CfnParameter[] {
    const parameters: CfnParameter[] = [];
    for (const [key, value] of Object.entries(op.parameters ?? {})) {
      if (value !== undefined && value !== '') {
        parameters.push({ ParameterKey: key, ParameterValue: value });
      }
    }
    return parameters;
  }

  private tags(op: OperationInput): CfnTag[] {
    const tags: CfnTag[] = [];
    for (const [key, value] of Object.entries(op.tags ?? {})) {
      if (value !== undefined && value !== '') {
        tags.push({ Key: key, Value: value });
      }
    }
    return tags;
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
