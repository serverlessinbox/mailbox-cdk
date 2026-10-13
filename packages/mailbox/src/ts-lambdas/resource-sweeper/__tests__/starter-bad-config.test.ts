/**
 * Coverage for the starter's behaviour when its config is invalid (see `handler.ts`,
 * `starterHandler`). A Delete must answer SUCCESS: a stack stuck in DELETE_FAILED cannot be updated,
 * so the bad config could never be fixed. Create and Update must answer FAILED naming the problem.
 *
 * The state-machine ARN is deliberately left unset: config is loaded when the handler module loads.
 */

process.env['SERVICE_NAME'] = 'resource-sweeper-starter';
delete process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'];

import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient } from '@aws-sdk/client-sfn';
import { starterHandler } from '../handler';
import { captureCfnResponse, createEvent, deleteEvent, lambdaContext } from './starter-test-helpers';

jest.mock('https', () => ({ request: jest.fn() }));

const sfnMock = mockClient(SFNClient);

describe('starterHandler — invalid config', () => {
  let cfnResponse: ReturnType<typeof captureCfnResponse>;

  beforeEach(() => {
    sfnMock.reset();
    cfnResponse = captureCfnResponse();
  });

  it('answers SUCCESS to a Delete without calling Step Functions', async () => {
    await starterHandler(deleteEvent(), lambdaContext());

    expect(cfnResponse().Status).toBe('SUCCESS');
    expect(sfnMock.calls()).toHaveLength(0);
  });

  it('answers FAILED to a Create, naming the missing variable', async () => {
    await starterHandler(createEvent(), lambdaContext());

    const response = cfnResponse();
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
  });
});
