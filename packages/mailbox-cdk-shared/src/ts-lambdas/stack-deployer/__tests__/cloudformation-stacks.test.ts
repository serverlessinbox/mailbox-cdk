import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  type StackEvent,
} from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudFormationStacks } from '../cloudformation-stacks';
import { defaultLevelLogger, EU_WEST_1, operation, silenceConsole, stack, STACK_NAME, US_EAST_1 } from './stack-deployer-helpers';

// A status the SDK's enum does not list, as CloudFormation could send it: the wire is JSON, so the fixture is too.
function cancelledEventFromWire(): StackEvent {
  return JSON.parse(
    '{"StackId":"s","EventId":"6","StackName":"test-data-stack","Timestamp":"2026-01-01T00:00:00Z","LogicalResourceId":"Key","ResourceType":"AWS::KMS::Key","ResourceStatus":"CREATE_CANCELLED"}',
  );
}

/**
 * Pins the CloudFormation calls behind a stack operation: what is sent to create, update, delete and recreate
 * a stack, and how the races between those calls resolve. A wrong call here deploys the wrong stack or leaves
 * a deployment failed that CloudFormation would have accepted.
 */
describe('CloudFormationStacks', () => {
  const cfn = mockClient(CloudFormationClient);
  const regions: string[] = [];
  let stacks: CloudFormationStacks;

  beforeEach(() => {
    cfn.reset();
    regions.length = 0;
    silenceConsole();
    stacks = new CloudFormationStacks(
      (region) => {
        regions.push(region);
        return new CloudFormationClient({ region });
      },
      EU_WEST_1,
      defaultLevelLogger(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function commandNames(): string[] {
    return cfn.calls().map((call) => call.args[0].constructor.name);
  }

  describe('describe', () => {
    it('returns the stack CloudFormation describes', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      const described = await stacks.describe(operation());

      expect(described?.StackStatus).toBe('CREATE_COMPLETE');
      expect(cfn.commandCalls(DescribeStacksCommand)[0].args[0].input).toEqual({ StackName: STACK_NAME });
    });

    it('returns undefined for a stack that does not exist', async () => {
      cfn.on(DescribeStacksCommand).rejects({ name: 'ValidationError', message: `Stack with id ${STACK_NAME} does not exist` });

      await expect(stacks.describe(operation())).resolves.toBeUndefined();
    });

    it('rethrows a validation error that is not about a missing stack', async () => {
      cfn.on(DescribeStacksCommand).rejects({ name: 'ValidationError', message: 'Stack name is malformed' });

      await expect(stacks.describe(operation())).rejects.toMatchObject({ message: 'Stack name is malformed' });
    });

    it('rethrows an error that is not a validation error, even when its message says the stack does not exist', async () => {
      cfn.on(DescribeStacksCommand).rejects({ name: 'AccessDenied', message: 'the stack does not exist for you' });

      await expect(stacks.describe(operation())).rejects.toMatchObject({ name: 'AccessDenied' });
    });
  });

  describe('region', () => {
    it('calls CloudFormation in the region of the operation', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      await stacks.describe(operation({ region: US_EAST_1 }));

      expect(regions).toEqual(['us-east-1']);
    });

    it('calls CloudFormation in the default region when the operation names none', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      await stacks.describe(operation());

      expect(regions).toEqual(['eu-west-1']);
    });
  });

  describe('describeRecentFailures', () => {
    it('lists the failed, rolled-back and cancelled events and skips the others', async () => {
      cfn.on(DescribeStackEventsCommand).resolves({
        StackEvents: [
          { StackId: 's', EventId: '1', StackName: STACK_NAME, Timestamp: new Date(), LogicalResourceId: 'Bucket', ResourceType: 'AWS::S3::Bucket', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'Access Denied' },
          { StackId: 's', EventId: '2', StackName: STACK_NAME, Timestamp: new Date(), LogicalResourceId: 'Table', ResourceType: 'AWS::DynamoDB::Table', ResourceStatus: 'UPDATE_ROLLBACK_IN_PROGRESS', ResourceStatusReason: 'rolling back' },
          { StackId: 's', EventId: '3', StackName: STACK_NAME, Timestamp: new Date(), LogicalResourceId: 'Queue', ResourceType: 'AWS::SQS::Queue', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'Resource creation cancelled' },
          { StackId: 's', EventId: '4', StackName: STACK_NAME, Timestamp: new Date(), LogicalResourceId: 'Role', ResourceType: 'AWS::IAM::Role', ResourceStatus: 'CREATE_IN_PROGRESS' },
          { StackId: 's', EventId: '5', StackName: STACK_NAME, Timestamp: new Date(), LogicalResourceId: 'Topic', ResourceType: 'AWS::SNS::Topic', ResourceStatus: 'DELETE_SKIPPED' },
          cancelledEventFromWire(),
        ],
      });

      await expect(stacks.describeRecentFailures(operation())).resolves.toEqual([
        'Bucket (AWS::S3::Bucket) CREATE_FAILED: Access Denied',
        'Table (AWS::DynamoDB::Table) UPDATE_ROLLBACK_IN_PROGRESS: rolling back',
        'Queue (AWS::SQS::Queue) CREATE_FAILED: Resource creation cancelled',
        'Key (AWS::KMS::Key) CREATE_CANCELLED: Unknown reason',
      ]);
    });

    it('names an event without a logical id, type or reason as unknown', async () => {
      cfn.on(DescribeStackEventsCommand).resolves({
        StackEvents: [{ StackId: 's', EventId: '1', StackName: STACK_NAME, Timestamp: new Date(), ResourceStatus: 'CREATE_FAILED' }],
      });

      await expect(stacks.describeRecentFailures(operation())).resolves.toEqual(['UnknownLogicalId (UnknownType) CREATE_FAILED: Unknown reason']);
    });

    it('lists at most eight events', async () => {
      const failed = Array.from({ length: 10 }, (_, index) => ({
        StackId: 's',
        EventId: String(index),
        StackName: STACK_NAME,
        Timestamp: new Date(),
        LogicalResourceId: `Resource${index}`,
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED' as const,
        ResourceStatusReason: 'failed',
      }));
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: failed });

      const lines = await stacks.describeRecentFailures(operation());

      expect(lines).toHaveLength(8);
      expect(lines[7]).toBe('Resource7 (AWS::S3::Bucket) CREATE_FAILED: failed');
    });

    it('returns no events when the events cannot be read', async () => {
      cfn.on(DescribeStackEventsCommand).rejects({ name: 'AccessDenied', message: 'no events for you' });

      await expect(stacks.describeRecentFailures(operation())).resolves.toEqual([]);
    });
  });

  describe('startOrUpdate', () => {
    it('creates a stack that does not exist, with its template, parameters, tags and capabilities', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      await stacks.startOrUpdate(operation({ parameters: { nameBase: 'mail', unset: undefined, empty: '' }, tags: { owner: 'team', blank: '' }, terminationProtection: true }));

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'CreateStackCommand']);
      expect(cfn.commandCalls(CreateStackCommand)[0].args[0].input).toEqual({
        StackName: STACK_NAME,
        TemplateURL: 'https://example.com/template.json',
        Parameters: [{ ParameterKey: 'nameBase', ParameterValue: 'mail' }],
        Tags: [{ Key: 'owner', Value: 'team' }],
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
        EnableTerminationProtection: true,
      });
    });

    it('creates the stack without termination protection and without parameters or tags when the operation gives none', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      await stacks.startOrUpdate(operation());

      expect(cfn.commandCalls(CreateStackCommand)[0].args[0].input).toMatchObject({ Parameters: [], Tags: [], EnableTerminationProtection: false });
    });

    it.each([
      [true, true],
      ['true', true],
      [false, false],
      ['false', false],
    ] as const)('creates the stack with termination protection %p as %p', async (given, sent) => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      await stacks.startOrUpdate(operation({ terminationProtection: given }));

      expect(cfn.commandCalls(CreateStackCommand)[0].args[0].input.EnableTerminationProtection).toBe(sent);
    });

    it('updates a stack that exists, with the same template, parameters and tags', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      await stacks.startOrUpdate(operation({ requestType: 'Update', parameters: { nameBase: 'mail' }, tags: { owner: 'team' } }));

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'UpdateStackCommand']);
      expect(cfn.commandCalls(UpdateStackCommand)[0].args[0].input).toEqual({
        StackName: STACK_NAME,
        TemplateURL: 'https://example.com/template.json',
        Parameters: [{ ParameterKey: 'nameBase', ParameterValue: 'mail' }],
        Tags: [{ Key: 'owner', Value: 'team' }],
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      });
    });

    it('treats an update that changes nothing as done', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
      cfn.on(UpdateStackCommand).rejects({ name: 'ValidationError', message: 'No updates are to be performed.' });

      await expect(stacks.startOrUpdate(operation({ requestType: 'Update' }))).resolves.toBeUndefined();
    });

    it('rethrows an update that fails for another reason', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
      cfn.on(UpdateStackCommand).rejects({ name: 'ValidationError', message: 'Template format error' });

      await expect(stacks.startOrUpdate(operation({ requestType: 'Update' }))).rejects.toMatchObject({ message: 'Template format error' });
    });

    it('rethrows an update that fails with a different error that mentions no updates', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
      cfn.on(UpdateStackCommand).rejects({ name: 'AccessDenied', message: 'No updates are to be performed.' });

      await expect(stacks.startOrUpdate(operation({ requestType: 'Update' }))).rejects.toMatchObject({ name: 'AccessDenied' });
    });

    it('deletes and creates again a stack that CloudFormation can no longer update', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });

      await stacks.startOrUpdate(operation());

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'DescribeStacksCommand', 'DeleteStackCommand', 'CreateStackCommand']);
    });

    it('updates the stack that appeared between the describe and the create', async () => {
      cfn.on(DescribeStacksCommand).resolvesOnce({ Stacks: [] }).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
      cfn.on(CreateStackCommand).rejects({ name: 'AlreadyExistsException', message: 'Stack [x] already exists' });

      await stacks.startOrUpdate(operation());

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'CreateStackCommand', 'DescribeStacksCommand', 'UpdateStackCommand']);
    });

    it('recognises a stack that already exists by the message when the error carries no name', async () => {
      cfn.on(DescribeStacksCommand).resolvesOnce({ Stacks: [] }).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
      cfn.on(CreateStackCommand).rejects({ name: 'Error', message: 'Stack [x] already exists' });

      await stacks.startOrUpdate(operation());

      expect(commandNames()).toContain('UpdateStackCommand');
    });

    it('rethrows the create error when the stack it collided with cannot be found', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });
      cfn.on(CreateStackCommand).rejects({ name: 'AlreadyExistsException', message: 'Stack [x] already exists' });

      await expect(stacks.startOrUpdate(operation())).rejects.toMatchObject({ name: 'AlreadyExistsException' });
    });

    it('rethrows a create that fails for another reason without describing again', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });
      cfn.on(CreateStackCommand).rejects({ name: 'InsufficientCapabilitiesException', message: 'needs capabilities' });

      await expect(stacks.startOrUpdate(operation())).rejects.toMatchObject({ name: 'InsufficientCapabilitiesException' });

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'CreateStackCommand']);
    });
  });

  describe('deleteIfExists', () => {
    it('deletes the stack when it exists', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      await stacks.deleteIfExists(operation({ requestType: 'Delete' }));

      expect(cfn.commandCalls(DeleteStackCommand)[0].args[0].input).toEqual({ StackName: STACK_NAME });
    });

    it('does nothing when the stack does not exist', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      await stacks.deleteIfExists(operation({ requestType: 'Delete' }));

      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
    });
  });

  describe('recreate', () => {
    it('deletes the stack and creates it again, in that order', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });

      await stacks.recreate(operation({ terminationProtection: true }));

      expect(commandNames()).toEqual(['DescribeStacksCommand', 'DeleteStackCommand', 'CreateStackCommand']);
      expect(cfn.commandCalls(CreateStackCommand)[0].args[0].input).toMatchObject({ StackName: STACK_NAME, EnableTerminationProtection: true });
    });

    it('rethrows a create that fails', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });
      cfn.on(CreateStackCommand).rejects({ name: 'LimitExceededException', message: 'too many stacks' });

      await expect(stacks.recreate(operation())).rejects.toMatchObject({ name: 'LimitExceededException' });
    });
  });
});
