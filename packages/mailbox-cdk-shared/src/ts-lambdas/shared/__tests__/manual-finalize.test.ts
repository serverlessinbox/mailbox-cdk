/**
 * Pins the MANUAL_FINALIZE block an operator copies from CloudWatch to release a hung custom resource: the greppable
 * lines, the curl that answers SUCCESS to the ResponseURL, and the silence for an event that is not a real request.
 * A changed line format breaks the operator's grep, and a wrong body leaves the resource hung.
 */

import { toStackId } from '../custom-resource-identifiers';
import { emitManualFinalize } from '../manual-finalize';

describe('emitManualFinalize', () => {
  const cfnEvent = {
    ResponseURL: 'https://example.com/response',
    StackId: toStackId('arn:aws:cloudformation:us-east-1:123456789012:stack/mail/guid'),
    RequestId: 'request-1',
    LogicalResourceId: 'MyResource',
    RequestType: 'Delete',
    ResourceProperties: { stackName: 'mail-data' },
  };
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loggedLines(): string[] {
    return consoleLogSpy.mock.calls.map(([line]) => line);
  }

  it('writes the request, the response url, the body and the curl hint as separate lines', () => {
    emitManualFinalize(cfnEvent, { physicalResourceId: 'physical-1' });

    const body = '{"Status":"SUCCESS","PhysicalResourceId":"physical-1","StackId":"arn:aws:cloudformation:us-east-1:123456789012:stack/mail/guid","RequestId":"request-1","LogicalResourceId":"MyResource"}';
    expect(loggedLines()).toEqual([
      'MANUAL_FINALIZE stack=mail-data logical=MyResource type=Delete requestId=request-1',
      'MANUAL_FINALIZE responseUrl=https://example.com/response',
      `MANUAL_FINALIZE body=${body}`,
      `MANUAL_FINALIZE hint=curl -X PUT -H "Content-Type:" --data-binary '${body}' 'https://example.com/response'`,
    ]);
  });

  it('names the service on the request line when one is given', () => {
    emitManualFinalize(cfnEvent, { service: 'stack-deployer' });

    expect(loggedLines()[0]).toBe('MANUAL_FINALIZE stack=mail-data logical=MyResource type=Delete requestId=request-1 service=stack-deployer');
  });

  it('answers with the logical resource id when no physical resource id is given', () => {
    emitManualFinalize(cfnEvent);

    expect(loggedLines()[2]).toContain('"PhysicalResourceId":"MyResource"');
  });

  it('falls back to the logical resource id for the stack and to unknown for fields the event lacks', () => {
    emitManualFinalize({ ResponseURL: 'https://example.com/response', LogicalResourceId: 'MyResource' });

    expect(loggedLines()[0]).toBe('MANUAL_FINALIZE stack=MyResource logical=MyResource type=unknown requestId=unknown');
  });

  it('writes nothing for an event without a ResponseURL', () => {
    emitManualFinalize({ ...cfnEvent, ResponseURL: undefined });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
