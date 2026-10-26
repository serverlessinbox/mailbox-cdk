/**
 * Coverage for the starter handler's answer to a request the starter could not carry out: an unexpected
 * failure flushes the logger, then `FailedRequestAnswerer.answer` decides with the request and the thrown
 * error. A suppressed answer is returned to CloudFormation as SUCCESS, which is what keeps a parent rollback
 * from stranding the stack in UPDATE_ROLLBACK_FAILED; no suppressed answer leaves the failure to stand as FAILED.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

const STATE_MACHINE_ARN                          = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';
process.env['SERVICE_NAME']                      = 'resource-sweeper';
process.env['AWS_REGION']                        = 'us-west-2';
process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = STATE_MACHINE_ARN;

import { FailedRequestAnswerer, LoggerBuffer }                                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { captureCfnResponse }                                                                    from '@serverlessinbox/mailbox-cdk-shared/runtime-test-support';

import { starterHandler }                                                                        from '../handler';
import { SweepStarter }                                                                          from '../sweep-starter';

import { lambdaContext, updateEvent }                                                            from './sweep-helpers';

// wrapHandler PUTs the CFN response over real `https`; captureCfnResponse routes it into memory.
jest.mock('https', () => ({ request: jest.fn() }));

const PHYSICAL_ID = 'mailbox-deferred-removal';

describe('starterHandler on a failed request', () => {
  const failure = new Error('planner blew up');
  let answer: jest.SpyInstance;
  let flush: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(SweepStarter.prototype, 'handle').mockRejectedValue(failure);
    flush  = jest.spyOn(LoggerBuffer.prototype, 'flush');
    answer = jest.spyOn(FailedRequestAnswerer.prototype, 'answer');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS with the suppressed answer when the answerer returns one, after flushing', async () => {
    answer.mockResolvedValue({ PhysicalResourceId: PHYSICAL_ID, Data: {} });
    const cfnResponse = captureCfnResponse();
    const event       = updateEvent();

    await starterHandler(event, lambdaContext());

    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ RequestType: 'Update', StackId: event.StackId }), failure);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: PHYSICAL_ID });
  });

  it('answers FAILED with the error when the answerer returns no suppressed answer', async () => {
    answer.mockResolvedValue(undefined);
    const cfnResponse = captureCfnResponse();

    await starterHandler(updateEvent(), lambdaContext());

    expect(answer).toHaveBeenCalledTimes(1);
    const response = cfnResponse();
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('planner blew up');
  });
});
