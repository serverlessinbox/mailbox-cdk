import { SFNClient, StartExecutionCommand }          from '@aws-sdk/client-sfn';
import { mockClient }                                from 'aws-sdk-client-mock';

import { CfnResponder }                              from '../answers/cfn-responder';
import { StackDeployerStarterRequestHandler }        from '../stack-deployer-starter-request-handler';
import { StackDeployerStarter }                      from '../stack-deployer-starter';
import { StackDeploymentEventReader }                from '../stack/stack-deployment-event-reader';

import {
  cfnRequest,
  defaultLevelLogger,
  LOG_STREAM_NAME,
  noPause,
  silenceConsole,
  STATE_MACHINE_ARN,
  type ConsoleSpies,
} from './stack-deployer-helpers';

/**
 * Pins what happens to an event before the starter acts on it: it is read, the dispatch line and the
 * break-glass lines that release a resource whose function never answers are written, and a malformed event
 * stops everything. The break-glass lines are the only way to release a resource whose function hangs, so
 * they must be written before the execution is started.
 */
describe('StackDeployerStarterRequestHandler', () => {
  const sfn = mockClient(SFNClient);
  let consoleSpies: ConsoleSpies;

  function requestHandler(): StackDeployerStarterRequestHandler {
    const events    = new StackDeploymentEventReader();
    const responder = new CfnResponder(noPause);
    const starter   = new StackDeployerStarter(STATE_MACHINE_ARN, new SFNClient({}), events, responder, defaultLevelLogger());
    return new StackDeployerStarterRequestHandler(events, responder, starter);
  }

  beforeEach(() => {
    sfn.reset();
    sfn.on(StartExecutionCommand).resolves({});
    consoleSpies = silenceConsole();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts the execution of the request it read', async () => {
    await requestHandler().handle(cfnRequest(), LOG_STREAM_NAME);

    const calls = sfn.commandCalls(StartExecutionCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.name).toBe('request-123');
  });

  it('writes the dispatch line of the request', async () => {
    await requestHandler().handle(cfnRequest(), LOG_STREAM_NAME);

    expect(consoleSpies.info).toHaveBeenCalledWith('stack-deployer-starter dispatch', { requestType: 'Create', logicalResourceId: 'MailboxDeployer' });
  });

  it('writes the break-glass finalization lines, with the physical id the answer would carry', async () => {
    await requestHandler().handle(cfnRequest(), LOG_STREAM_NAME);

    const written = consoleSpies.log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(written).toContain('MANUAL_FINALIZE stack=test-data-stack logical=MailboxDeployer type=Create requestId=request-123');
    expect(written).toContain('MANUAL_FINALIZE responseUrl=https://example.com/cfn-response');
  });

  it('throws for an event that is not a request, writing nothing and starting nothing', async () => {
    await expect(requestHandler().handle({ ...cfnRequest(), RequestType: 'Replace' }, LOG_STREAM_NAME)).rejects.toThrow('Invalid event');

    expect(consoleSpies.info).not.toHaveBeenCalled();
    expect(consoleSpies.log).not.toHaveBeenCalled();
    expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
  });
});
