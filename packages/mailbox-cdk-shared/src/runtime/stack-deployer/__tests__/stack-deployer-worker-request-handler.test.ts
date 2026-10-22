import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { mockClient }                                  from 'aws-sdk-client-mock';

import { CfnResponder }                                from '../answers/cfn-responder';
import { CloudFormationStacks }                        from '../cloudformation-stacks';
import { StackDeployerWorkerRequestHandler }           from '../stack-deployer-worker-request-handler';
import { StackDeployerWorker }                         from '../stack-deployer-worker';
import { StackDeploymentEventReader }                  from '../stack/stack-deployment-event-reader';

import {
  defaultLevelLogger,
  fakeCfnEndpoint,
  LOG_STREAM_NAME,
  noPause,
  rollbackAnswering,
  sfnEvent,
  silenceConsole,
  stack,
  US_EAST_1,
  type ConsoleSpies,
  type FakeCfnEndpoint,
} from './stack-deployer-helpers';

/**
 * Pins what happens to an input before the worker acts on it: it is read, the dispatch line is written, the
 * answer is aimed at the CloudFormation request the workflow carries, and a malformed input stops the worker
 * before it touches a stack.
 */
describe('StackDeployerWorkerRequestHandler', () => {
  const cfn = mockClient(CloudFormationClient);
  let consoleSpies: ConsoleSpies;
  let endpoint: FakeCfnEndpoint;

  function requestHandler(): StackDeployerWorkerRequestHandler {
    const logger    = defaultLevelLogger();
    const events    = new StackDeploymentEventReader();
    const responder = new CfnResponder(noPause);
    const stacks    = new CloudFormationStacks(() => new CloudFormationClient({}), US_EAST_1, logger);
    const worker    = new StackDeployerWorker(stacks, responder, rollbackAnswering(false), logger);
    return new StackDeployerWorkerRequestHandler(events, responder, worker);
  }

  beforeEach(() => {
    cfn.reset();
    cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });
    consoleSpies = silenceConsole();
    endpoint     = fakeCfnEndpoint();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the dispatch line of the input', async () => {
    await requestHandler().handle(sfnEvent(), LOG_STREAM_NAME);

    expect(consoleSpies.info).toHaveBeenCalledWith('stack-deployer-worker dispatch', { mode: 'check', attempt: 1 });
  });

  it('hands the input to the worker and answers the CloudFormation request the input carries', async () => {
    const result = await requestHandler().handle(sfnEvent(), LOG_STREAM_NAME);

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
    expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', PhysicalResourceId: 'test-data-stack', RequestId: 'request-123' })]);
  });

  it('throws for an input that is not a workflow input, writing nothing and touching no stack', async () => {
    await expect(requestHandler().handle({ ...sfnEvent(), mode: 'abort' }, LOG_STREAM_NAME)).rejects.toThrow('Invalid event');

    expect(consoleSpies.info).not.toHaveBeenCalled();
    expect(cfn.commandCalls(DescribeStacksCommand)).toHaveLength(0);
    expect(endpoint.answers()).toEqual([]);
  });
});
