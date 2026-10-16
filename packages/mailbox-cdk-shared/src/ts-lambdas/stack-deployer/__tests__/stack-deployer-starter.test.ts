import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import { ExpectedFailure } from '../../shared/expected-failure';
import { CfnResponder } from '../cfn-responder';
import { toStateMachineArn, type StateMachineArn } from '../deployer-identifiers';
import { StackDeployerStarter } from '../stack-deployer-starter';
import { StackOperationFailure } from '../stack-operation-failure';
import { StackDeploymentEventReader } from '../stack-deployment-event-reader';
import {
  BUCKET_ARN_AS_STACK_ID,
  cfnRequest,
  DEPLOYER_RESOURCE_PROPERTIES,
  defaultLevelLogger,
  deployerRequest,
  fakeCfnEndpoint,
  MALFORMED_STACK_ID,
  noPause,
  replyTarget,
  silenceConsole,
  stackDeployerProperties,
  stackIdOf,
  STATE_MACHINE_ARN,
  type FakeCfnEndpoint,
} from './stack-deployer-helpers';

const ALREADY_EXISTS = { name: 'ExecutionAlreadyExists', message: 'Execution already exists' };
const ACCESS_DENIED = { name: 'AccessDeniedException', message: 'not allowed' };
const EXISTING_EXECUTION_ARN = 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123';

/**
 * Pins how the starter turns a CloudFormation request into a Step Functions execution, and what it does when
 * CloudFormation retries a request whose execution already exists. A request that gets no execution and no
 * answer hangs the custom resource until its service timeout, so every outcome here is either a started
 * execution or a thrown failure for the handler to answer.
 */
describe('StackDeployerStarter', () => {
  const sfn = mockClient(SFNClient);
  let endpoint: FakeCfnEndpoint;

  function starterFor(stateMachineArn: StateMachineArn = STATE_MACHINE_ARN): StackDeployerStarter {
    return new StackDeployerStarter(stateMachineArn, new SFNClient({}), new StackDeploymentEventReader(), new CfnResponder(noPause), defaultLevelLogger());
  }

  async function failureOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (failure) {
      return failure;
    }
    return undefined;
  }

  beforeEach(() => {
    sfn.reset();
    sfn.on(StartExecutionCommand).resolves({});
    silenceConsole();
    endpoint = fakeCfnEndpoint();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('starting the execution', () => {
    it('starts an execution named after the request id, with the envelope and the operation as input', async () => {
      const request = cfnRequest({}, stackDeployerProperties({ parameters: { nameBase: 'mail' } }));

      await starterFor().start(request, replyTarget());

      const calls = sfn.commandCalls(StartExecutionCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        stateMachineArn: STATE_MACHINE_ARN,
        name: 'request-123',
        input: JSON.stringify({
          cfn: replyTarget().cfn,
          op: { stackName: 'test-data-stack', templateUrl: 'https://example.com/template.json', parameters: { nameBase: 'mail' }, requestType: 'Create' },
        }),
      });
      expect(endpoint.answers()).toEqual([]);
    });

    it.each(['edge', 'data', 'cognito'] as const)('starts the execution for a request carrying the real keys of the %s deployer resource', async (resource) => {
      await starterFor().start(deployerRequest(resource), replyTarget());

      const sent = JSON.parse(String(sfn.commandCalls(StartExecutionCommand)[0].args[0].input.input));
      expect(sent.op).toEqual({ ...DEPLOYER_RESOURCE_PROPERTIES[resource], requestType: 'Create' });
      expect(endpoint.answers()).toEqual([]);
    });

    it('hands the worker the flags as they arrived and the request type of the request', async () => {
      const properties = { ...stackDeployerProperties(), preserveOnDelete: 'false', terminationProtection: 'true' };

      await starterFor().start(cfnRequest({ RequestType: 'Update' }, properties), replyTarget());

      const sent = JSON.parse(String(sfn.commandCalls(StartExecutionCommand)[0].args[0].input.input));
      expect(sent.op).toMatchObject({ requestType: 'Update', preserveOnDelete: 'false', terminationProtection: 'true' });
    });

    it('rejects properties it cannot run as an ExpectedFailure and starts nothing', async () => {
      const failure = await failureOf(starterFor().start(cfnRequest({}, { templateUrl: 'https://example.com/template.json' }), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('Invalid ResourceProperties'));
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it('rejects a Delete whose preserveOnDelete is not a switch as an ExpectedFailure, and starts nothing that could delete the stack', async () => {
      const unreadable = { ...stackDeployerProperties(), preserveOnDelete: 'sometimes' };

      const failure = await failureOf(starterFor().start(cfnRequest({ RequestType: 'Delete' }, unreadable), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('preserveOnDelete'));
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it('starts a Delete with the properties it needs when the others are not valid', async () => {
      const invalid = { ...stackDeployerProperties(), preserveOnDelete: 'true', parameters: { count: 3 } };

      await starterFor().start(cfnRequest({ RequestType: 'Delete' }, invalid), replyTarget());

      const sent = JSON.parse(String(sfn.commandCalls(StartExecutionCommand)[0].args[0].input.input));
      expect(sent.op).toEqual({ stackName: 'test-data-stack', preserveOnDelete: 'true', requestType: 'Delete' });
    });
  });

  describe('the root stack name', () => {
    it('rejects a Create whose root stack name is longer than 24 characters, and starts nothing', async () => {
      const request = cfnRequest({ StackId: stackIdOf('this-is-a-very-long-names') });

      const failure = await failureOf(starterFor().start(request, replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty(
        'message',
        'Root stack name "this-is-a-very-long-names" exceeds maximum length of 24 characters (got 25). ' +
          'CloudFormation truncates auto-generated resource names to 64 characters, which can break name-based IAM lookups. Please use a shorter stack name.',
      );
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it('accepts a Create whose root stack name has exactly 24 characters', async () => {
      await starterFor().start(cfnRequest({ StackId: stackIdOf('exactly-twenty-four-char') }), replyTarget());

      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(1);
    });

    it('rejects a Create whose stack id is not an ARN as an ExpectedFailure, and starts nothing', async () => {
      const failure = await failureOf(starterFor().start(cfnRequest({ StackId: MALFORMED_STACK_ID }), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'StackId is malformed: Invalid ARN "not-a-stack-arn": expected arn:partition:service:region:account:resource');
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it('rejects a Create whose stack id is the ARN of something other than a CloudFormation stack, and starts nothing', async () => {
      const failure = await failureOf(starterFor().start(cfnRequest({ StackId: BUCKET_ARN_AS_STACK_ID }), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'StackId "arn:aws:s3:::mail-bucket" is not a CloudFormation stack ARN');
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it.each(['Update', 'Delete'] as const)('does not reject a %s, which keeps working with the name it has', async (requestType) => {
      await starterFor().start(cfnRequest({ RequestType: requestType, StackId: stackIdOf('this-is-a-very-long-names') }), replyTarget());

      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(1);
    });
  });

  describe('the state machine ARN', () => {
    it('rejects the slash form of the ARN as an ExpectedFailure and starts nothing', async () => {
      const slashForm = 'arn:aws:states:us-east-1:123456789012:stateMachine/MailboxDataDeployer-abc123';

      const failure = await failureOf(starterFor(toStateMachineArn(slashForm)).start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty(
        'message',
        `MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is invalid (expected ':stateMachine:{name}', got ':stateMachine/{name}'): ${slashForm}`,
      );
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });
  });

  describe('an execution that cannot be started', () => {
    it('throws a StackOperationFailure, not an ExpectedFailure, naming what Step Functions reported', async () => {
      sfn.on(StartExecutionCommand).rejects(ACCESS_DENIED);

      const failure = await failureOf(starterFor().start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(StackOperationFailure);
      expect(failure).not.toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Failed to start Step Functions execution: AccessDeniedException: not allowed');
    });

    it('says the failure is ignored when the request is a Delete', async () => {
      sfn.on(StartExecutionCommand).rejects(ACCESS_DENIED);

      const failure = await failureOf(starterFor().start(cfnRequest({ RequestType: 'Delete' }), replyTarget()));

      expect(failure).toHaveProperty('message', 'Failed to start Step Functions execution (ignored for Delete): AccessDeniedException: not allowed');
    });
  });

  describe('an execution that already exists', () => {
    it('answers a Delete SUCCESS without looking at the execution', async () => {
      sfn.on(StartExecutionCommand).rejects(ALREADY_EXISTS);

      await starterFor().start(cfnRequest({ RequestType: 'Delete' }), replyTarget());

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'SUCCESS', Reason: 'Delete already in progress (ExecutionAlreadyExists); continuing without waiting' }),
      ]);
      expect(sfn.commandCalls(DescribeExecutionCommand)).toHaveLength(0);
    });

    it('recognises the error by its message when it carries no name', async () => {
      sfn.on(StartExecutionCommand).rejects({ name: 'Error', message: 'ExecutionAlreadyExists: Execution already exists' });

      await starterFor().start(cfnRequest({ RequestType: 'Delete' }), replyTarget());

      expect(endpoint.answers()).toHaveLength(1);
    });

    it('leaves a running execution to answer CloudFormation and starts no second one', async () => {
      sfn.on(StartExecutionCommand).rejects(ALREADY_EXISTS);
      sfn.on(DescribeExecutionCommand).resolves({ status: 'RUNNING' });

      await starterFor().start(cfnRequest(), replyTarget());

      expect(sfn.commandCalls(DescribeExecutionCommand)[0].args[0].input).toEqual({ executionArn: EXISTING_EXECUTION_ARN });
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(1);
      expect(endpoint.answers()).toEqual([]);
    });

    it.each(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'] as const)('starts a new execution named -r2 when the earlier one is %s', async (status) => {
      sfn.on(StartExecutionCommand).rejectsOnce(ALREADY_EXISTS).resolves({});
      sfn.on(DescribeExecutionCommand).resolves({ status });

      await starterFor().start(cfnRequest(), replyTarget());

      expect(sfn.commandCalls(StartExecutionCommand).map((call) => call.args[0].input.name)).toEqual(['request-123', 'request-123-r2']);
      expect(endpoint.answers()).toEqual([]);
    });

    it('tries the next name when the suffixed name is taken too', async () => {
      sfn.on(StartExecutionCommand).rejectsOnce(ALREADY_EXISTS).rejectsOnce(ALREADY_EXISTS).resolves({});
      sfn.on(DescribeExecutionCommand).resolves({ status: 'SUCCEEDED' });

      await starterFor().start(cfnRequest(), replyTarget());

      expect(sfn.commandCalls(StartExecutionCommand).map((call) => call.args[0].input.name)).toEqual(['request-123', 'request-123-r2', 'request-123-r3']);
    });

    it('rejects the request as an ExpectedFailure when every name up to -r5 is taken', async () => {
      sfn.on(StartExecutionCommand).rejects(ALREADY_EXISTS);
      sfn.on(DescribeExecutionCommand).resolves({ status: 'FAILED' });

      const failure = await failureOf(starterFor().start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Could not start execution after 5 retries: all suffixed names exhausted');
      expect(sfn.commandCalls(StartExecutionCommand).map((call) => call.args[0].input.name)).toEqual([
        'request-123',
        'request-123-r2',
        'request-123-r3',
        'request-123-r4',
        'request-123-r5',
      ]);
    });

    it('stops trying names when a retry fails for a reason other than the name being taken', async () => {
      sfn.on(StartExecutionCommand).rejectsOnce(ALREADY_EXISTS).rejects(ACCESS_DENIED);
      sfn.on(DescribeExecutionCommand).resolves({ status: 'FAILED' });

      const failure = await failureOf(starterFor().start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(2);
    });

    it('treats an execution it cannot describe as ended and starts a new one named -r2', async () => {
      sfn.on(StartExecutionCommand).rejectsOnce(ALREADY_EXISTS).resolves({});
      sfn.on(DescribeExecutionCommand).rejects({ name: 'ExecutionDoesNotExist', message: 'gone' });

      await starterFor().start(cfnRequest(), replyTarget());

      expect(sfn.commandCalls(StartExecutionCommand).map((call) => call.args[0].input.name)).toEqual(['request-123', 'request-123-r2']);
    });

    it('rejects the request as an ExpectedFailure naming the describe error when the execution cannot be described or restarted', async () => {
      sfn.on(StartExecutionCommand).rejectsOnce(ALREADY_EXISTS).rejects(ACCESS_DENIED);
      sfn.on(DescribeExecutionCommand).rejects({ name: 'ExecutionDoesNotExist', message: 'gone' });

      const failure = await failureOf(starterFor().start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'DescribeExecution failed and could not start retry: ExecutionDoesNotExist: gone');
    });

    it('throws the start failure when the earlier execution has a status it does not know', async () => {
      sfn.on(StartExecutionCommand).rejects(ALREADY_EXISTS);
      sfn.on(DescribeExecutionCommand).resolves({ status: 'PENDING_REDRIVE' });

      const failure = await failureOf(starterFor().start(cfnRequest(), replyTarget()));

      expect(failure).toBeInstanceOf(StackOperationFailure);
      expect(failure).toHaveProperty('message', 'Failed to start Step Functions execution: ExecutionAlreadyExists: Execution already exists');
      expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(1);
    });
  });
});
