import type * as CloudFormationSdk        from '@aws-sdk/client-cloudformation';
import type * as SfnSdk                   from '@aws-sdk/client-sfn';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

import { toPhysicalResourceId }           from '../../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import type * as HandlerModule            from '../handler';

import {
  cfnRequest,
  fakeCfnEndpoint,
  LOG_STREAM_NAME,
  operation,
  sfnEvent,
  silenceConsole,
  stack,
  STACK_ID,
  stackIdOf,
  STATE_MACHINE_ARN,
  US_WEST_2,
  type ConsoleSpies,
  type FakeCfnEndpoint,
} from './stack-deployer-helpers';

interface LoadedHandlers {
  readonly handlers: typeof HandlerModule;
  readonly sfn: AwsClientStub<SfnSdk.SFNClient>;
  readonly cloudFormation: AwsClientStub<CloudFormationSdk.CloudFormationClient>;
}

const CONTEXT        = { logStreamName: LOG_STREAM_NAME };
const ACCESS_DENIED  = { name: 'AccessDeniedException', message: 'not allowed' };
const ALREADY_EXISTS = { name: 'ExecutionAlreadyExists', message: 'Execution already exists' };

/**
 * Pins the entry wiring of the two deployed functions that share this bundle: each loads its own config, a
 * config problem is answered to CloudFormation rather than thrown at load, and a failure is answered by its
 * kind. The handler loads its config when the module loads, so every scenario loads a fresh module. The
 * classes the handlers hand events to have their own tests.
 */
describe('stack-deployer handlers', () => {
  const originalEnvironment = { ...process.env };
  let endpoint: FakeCfnEndpoint;
  let consoleSpies: ConsoleSpies;

  function loadHandlers(environment: Record<string, string | undefined>): LoadedHandlers {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    let loaded: LoadedHandlers | undefined;
    jest.isolateModules(() => {
      const sfnSdk: typeof SfnSdk                       = require('@aws-sdk/client-sfn');
      const cloudFormationSdk: typeof CloudFormationSdk = require('@aws-sdk/client-cloudformation');
      loaded                                            = {
        handlers: require('../handler'),
        sfn: mockClient(sfnSdk.SFNClient),
        cloudFormation: mockClient(cloudFormationSdk.CloudFormationClient),
      };
    });
    if (!loaded) {
      throw new Error('the handler module did not load');
    }
    return loaded;
  }

  const starterEnvironment = { SERVICE_NAME: 'stack-deployer-data-starter', AWS_REGION: 'us-east-1', MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: STATE_MACHINE_ARN, LOG_LEVEL: undefined };
  const workerEnvironment  = { SERVICE_NAME: 'stack-deployer-data-worker', AWS_REGION: 'us-east-1', MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: undefined, LOG_LEVEL: undefined };

  /** CloudFormation as it is while the parent stack rolls back: the parent says so, and the stack of the operation has outputs. */
  const rollingBackParent = async (input: { StackName?: string }) =>
    input.StackName === STACK_ID
      ? { Stacks: [stack('UPDATE_ROLLBACK_IN_PROGRESS')], StackEvents: [] }
      : { Stacks: [stack('UPDATE_ROLLBACK_COMPLETE', { Outputs: [{ OutputKey: 'TableName', OutputValue: 'items-old' }] })], StackEvents: [] };

  beforeEach(() => {
    consoleSpies = silenceConsole();
    endpoint     = fakeCfnEndpoint();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env = { ...originalEnvironment };
  });

  describe('starterHandler', () => {
    it('starts the execution, writes the break-glass finalization lines and answers nothing', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);
      sfn.callsFake(async () => ({}));

      await handlers.starterHandler(cfnRequest(), CONTEXT);

      expect(sfn.calls()).toHaveLength(1);
      expect(endpoint.answers()).toEqual([]);
      const written = consoleSpies.log.mock.calls.map((call) => String(call[0])).join('\n');
      expect(written).toContain('MANUAL_FINALIZE stack=test-data-stack logical=MailboxDeployer type=Create requestId=request-123');
      expect(written).toContain(`MANUAL_FINALIZE responseUrl=https://example.com/cfn-response`);
      expect(consoleSpies.info).toHaveBeenCalledWith('stack-deployer-starter dispatch', { requestType: 'Create', logicalResourceId: 'MailboxDeployer' });
    });

    it('starts the execution with a Step Functions client of the region the function runs in', async () => {
      const { handlers, sfn } = loadHandlers({ ...starterEnvironment, AWS_REGION: 'eu-west-1' });
      sfn.callsFake(async () => ({}));

      await handlers.starterHandler(cfnRequest(), CONTEXT);

      await expect(sfn.calls()[0].thisValue.config.region()).resolves.toBe('eu-west-1');
    });

    it.each([
      ['Create', 'FAILED'],
      ['Delete', 'SUCCESS'],
      ['Update', 'FAILED'],
    ] as const)('answers a %s %s when the config is bad, and starts nothing', async (requestType, status) => {
      const { handlers, sfn } = loadHandlers({ ...starterEnvironment, MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: undefined });

      await handlers.starterHandler(cfnRequest({ RequestType: requestType }), CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({
          Status: status,
          Reason: 'Configuration error: MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is not set',
          PhysicalResourceId: 'test-data-stack',
        }),
      ]);
      expect(sfn.calls()).toHaveLength(0);
      expect(consoleSpies.log).not.toHaveBeenCalled();
    });

    it('answers an event it cannot read, from the response target it still carries, and starts nothing', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);

      await handlers.starterHandler({ ...cfnRequest(), RequestType: 'Replace' }, CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: expect.stringContaining('Unexpected error: Error: Invalid event') }),
      ]);
      expect(sfn.calls()).toHaveLength(0);
    });

    it('throws for an event with no response target, which no answer can reach', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);

      await expect(handlers.starterHandler({ RequestType: 'Create' }, CONTEXT)).rejects.toThrow(/CloudFormation was not answered/);

      expect(endpoint.answers()).toEqual([]);
      expect(sfn.calls()).toHaveLength(0);
    });

    it('answers a bad config on an event it cannot read, from the response target it still carries', async () => {
      const { handlers } = loadHandlers({ ...starterEnvironment, MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: undefined });

      await handlers.starterHandler({ ...cfnRequest(), RequestType: 'Replace' }, CONTEXT);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Configuration error: MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is not set' })]);
    });

    it('answers FAILED with the reason of an expected failure and writes none of the buffered trace', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);
      const request           = cfnRequest({ StackId: stackIdOf('this-is-a-very-long-names') });

      await handlers.starterHandler(request, CONTEXT);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: expect.stringContaining('Root stack name "this-is-a-very-long-names" exceeds maximum length') })]);
      expect(sfn.calls()).toHaveLength(0);
      expect(consoleSpies.debug).not.toHaveBeenCalled();
    });

    it('answers a Delete SUCCESS with the reason of an expected failure', async () => {
      const { handlers } = loadHandlers({ ...starterEnvironment, MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine/deployer' });

      await handlers.starterHandler(cfnRequest({ RequestType: 'Delete' }), CONTEXT);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Reason: expect.stringContaining(':stateMachine/{name}') })]);
    });

    it('answers properties it cannot run FAILED, naming the resource MailboxStack when they name no stack', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);

      await handlers.starterHandler(cfnRequest({}, {}), CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', PhysicalResourceId: 'MailboxStack', Reason: expect.stringContaining('Invalid ResourceProperties') }),
      ]);
      expect(sfn.calls()).toHaveLength(0);
    });

    it('writes the buffered trace and answers FAILED when the execution cannot be started', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);
      sfn.callsFake(async () => {
        throw Object.assign(new Error(ACCESS_DENIED.message), { name: ACCESS_DENIED.name });
      });

      await handlers.starterHandler(cfnRequest(), CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: 'Failed to start Step Functions execution: AccessDeniedException: not allowed' }),
      ]);
      expect(consoleSpies.debug).toHaveBeenCalledWith('Starting Step Functions execution', expect.objectContaining({ executionName: 'request-123' }));
    });

    it('answers an Update SUCCESS with the outputs of the stack when the execution cannot be started while the parent stack rolls back', async () => {
      const { handlers, sfn, cloudFormation } = loadHandlers(starterEnvironment);
      sfn.callsFake(async () => {
        throw Object.assign(new Error(ACCESS_DENIED.message), { name: ACCESS_DENIED.name });
      });
      cloudFormation.callsFake(rollingBackParent);

      await handlers.starterHandler(cfnRequest({ RequestType: 'Update', PhysicalResourceId: toPhysicalResourceId('sent-by-cloudformation') }), CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'SUCCESS', PhysicalResourceId: 'sent-by-cloudformation', Data: { TableName: 'items-old' } }),
      ]);
    });

    it('answers a Delete SUCCESS when the execution cannot be started', async () => {
      const { handlers, sfn } = loadHandlers(starterEnvironment);
      sfn.callsFake(async () => {
        throw Object.assign(new Error(ACCESS_DENIED.message), { name: ACCESS_DENIED.name });
      });

      await handlers.starterHandler(cfnRequest({ RequestType: 'Delete' }), CONTEXT);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'SUCCESS', Reason: 'Failed to start Step Functions execution (ignored for Delete): AccessDeniedException: not allowed' }),
      ]);
    });

    it('writes the buffered trace and throws the delivery failure, without answering a second time, when the answer cannot be delivered', async () => {
      jest.useFakeTimers();
      const { handlers, sfn } = loadHandlers(starterEnvironment);
      sfn.callsFake(async () => {
        throw Object.assign(new Error(ALREADY_EXISTS.message), { name: ALREADY_EXISTS.name });
      });
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rejected', { status: 403 }));

      const outcome = handlers.starterHandler(cfnRequest({ RequestType: 'Delete' }), CONTEXT).catch((thrown: unknown) => thrown);
      await jest.advanceTimersByTimeAsync(5000);

      expect(await outcome).toHaveProperty('message', 'Failed to PUT CloudFormation response (HTTP 403): rejected (attempts: 1)');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpies.debug).toHaveBeenCalledWith('Starting Step Functions execution', expect.objectContaining({ executionName: 'request-123' }));
    });

    it('reports a probe unhealthy when the starter config is bad, and healthy when it is good', async () => {
      const bad = loadHandlers({ ...starterEnvironment, MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: undefined });
      await expect(bad.handlers.starterHandler({ serverlessInboxSmokeTest: true })).resolves.toEqual({ serverlessInboxSmokeTestOk: false });

      const good = loadHandlers(starterEnvironment);
      await expect(good.handlers.starterHandler({ serverlessInboxSmokeTest: true })).resolves.toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });

  describe('workerHandler', () => {
    it('runs a check without the starter state machine ARN, which the worker function is never given', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(async () => ({ Stacks: [stack('CREATE_COMPLETE')], StackEvents: [] }));

      const result = await handlers.workerHandler(sfnEvent(), CONTEXT);

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS' })]);
      expect(consoleSpies.info).toHaveBeenCalledWith('stack-deployer-worker dispatch', { mode: 'check', attempt: 1 });
    });

    it.each([
      ['Create', 'FAILED'],
      ['Delete', 'SUCCESS'],
    ] as const)('answers a %s %s and ends the workflow when the config is bad', async (requestType, status) => {
      const { handlers, cloudFormation } = loadHandlers({ ...workerEnvironment, SERVICE_NAME: undefined });

      const result = await handlers.workerHandler(sfnEvent({ op: operation({ requestType }) }), CONTEXT);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: status, Reason: 'Configuration error: SERVICE_NAME is not set', PhysicalResourceId: 'test-data-stack' }),
      ]);
      expect(cloudFormation.calls()).toHaveLength(0);
    });

    describe('the CloudFormation client of a stack operation', () => {
      const inProgress = async () => ({ Stacks: [stack('UPDATE_IN_PROGRESS')], StackEvents: [] });

      it('is built for the region the operation names', async () => {
        const { handlers, cloudFormation } = loadHandlers({ ...workerEnvironment, AWS_REGION: 'eu-west-1' });
        cloudFormation.callsFake(inProgress);

        await handlers.workerHandler(sfnEvent({ op: operation({ region: US_WEST_2 }) }), CONTEXT);

        await expect(cloudFormation.calls()[0].thisValue.config.region()).resolves.toBe('us-west-2');
      });

      it('is built for the region the function runs in when the operation names none', async () => {
        const { handlers, cloudFormation } = loadHandlers({ ...workerEnvironment, AWS_REGION: 'eu-west-1' });
        cloudFormation.callsFake(inProgress);

        await handlers.workerHandler(sfnEvent(), CONTEXT);

        await expect(cloudFormation.calls()[0].thisValue.config.region()).resolves.toBe('eu-west-1');
      });

      it('is never built when the function reports no region: the operation is answered as a configuration error', async () => {
        const { handlers, cloudFormation } = loadHandlers({ ...workerEnvironment, AWS_REGION: undefined });

        await handlers.workerHandler(sfnEvent(), CONTEXT);

        expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Configuration error: AWS_REGION is not set' })]);
        expect(cloudFormation.calls()).toHaveLength(0);
      });

      it('is built once per region and reused by later operations', async () => {
        const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
        cloudFormation.callsFake(inProgress);

        await handlers.workerHandler(sfnEvent(), CONTEXT);
        await handlers.workerHandler(sfnEvent(), CONTEXT);

        const clients = new Set(cloudFormation.calls().map((call) => call.thisValue));
        expect(cloudFormation.calls().length).toBeGreaterThan(1);
        expect(clients.size).toBe(1);
      });
    });

    it('answers an input it cannot read, from the response target it still carries, and ends the workflow', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);

      const result = await handlers.workerHandler({ cfn: sfnEvent().cfn, mode: 'check' }, CONTEXT);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: expect.stringContaining('Unexpected error: Error: Invalid event') }),
      ]);
      expect(cloudFormation.calls()).toHaveLength(0);
    });

    it('throws for an input with no response target, which no answer can reach', async () => {
      const { handlers } = loadHandlers(workerEnvironment);

      await expect(handlers.workerHandler({ mode: 'check' }, CONTEXT)).rejects.toThrow(/CloudFormation was not answered/);

      expect(endpoint.answers()).toEqual([]);
    });

    it('answers a bad config on an input it cannot read, from the response target it still carries', async () => {
      const { handlers } = loadHandlers({ ...workerEnvironment, SERVICE_NAME: undefined });

      const result = await handlers.workerHandler({ cfn: sfnEvent().cfn, mode: 'check' }, CONTEXT);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Configuration error: SERVICE_NAME is not set' })]);
    });

    it('writes the buffered trace, answers FAILED and ends the workflow when a stack call fails', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(async () => {
        throw Object.assign(new Error('cannot describe'), { name: 'AccessDenied' });
      });

      const result = await handlers.workerHandler(sfnEvent(), CONTEXT);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: 'Stack deployer check failed (DescribeStacks): AccessDenied: cannot describe' }),
      ]);
      expect(consoleSpies.info).toHaveBeenCalledWith('Stack deployer op', expect.objectContaining({ mode: 'check' }));
    });

    it('writes the buffered trace and throws the delivery failure, without answering a second time, when the answer cannot be delivered', async () => {
      jest.useFakeTimers();
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(async () => ({ Stacks: [stack('CREATE_COMPLETE')], StackEvents: [] }));
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('rejected', { status: 500 }));

      const outcome = handlers.workerHandler(sfnEvent(), CONTEXT).catch((thrown: unknown) => thrown);
      await jest.advanceTimersByTimeAsync(5000);

      expect(await outcome).toHaveProperty('message', 'Failed to PUT CloudFormation response (HTTP 500): rejected (attempts: 4)');
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(consoleSpies.info).toHaveBeenCalledWith('Stack deployer op', expect.objectContaining({ mode: 'check' }));
    });

    it('answers an Update SUCCESS with the outputs of the stack when its stack ended in a failed state while the parent stack rolls back', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(rollingBackParent);

      const result = await handlers.workerHandler(sfnEvent({ op: operation({ requestType: 'Update' }), cfn: { ...sfnEvent().cfn, PhysicalResourceId: toPhysicalResourceId('sent-by-cloudformation') } }), CONTEXT);

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'SUCCESS', PhysicalResourceId: 'sent-by-cloudformation', Data: { TableName: 'items-old' } }),
      ]);
    });

    it('answers an Update SUCCESS with the outputs of the stack when its input cannot be read in full while the parent stack rolls back', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(rollingBackParent);
      const unreadable = { ...sfnEvent({ op: operation({ requestType: 'Update' }) }), mode: 'abort' };

      const result = await handlers.workerHandler(unreadable, CONTEXT);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Data: { TableName: 'items-old' } })]);
    });

    it('answers a Delete SUCCESS when a stack call fails', async () => {
      const { handlers, cloudFormation } = loadHandlers(workerEnvironment);
      cloudFormation.callsFake(async () => {
        throw Object.assign(new Error('cannot describe'), { name: 'AccessDenied' });
      });

      await handlers.workerHandler(sfnEvent({ op: operation({ requestType: 'Delete' }) }), CONTEXT);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS' })]);
    });

    it('reports a probe healthy without the starter ARN, and unhealthy when the worker config is bad', async () => {
      const good = loadHandlers(workerEnvironment);
      await expect(good.handlers.workerHandler({ serverlessInboxSmokeTest: true })).resolves.toEqual({ serverlessInboxSmokeTestOk: true });

      const bad = loadHandlers({ ...workerEnvironment, SERVICE_NAME: undefined });
      await expect(bad.handlers.workerHandler({ serverlessInboxSmokeTest: true })).resolves.toEqual({ serverlessInboxSmokeTestOk: false });
    });
  });
});
