/**
 * Coverage for the handler file when only the starter's config is invalid (the state machine ARN is
 * unset): a Delete must answer SUCCESS, since a stack stuck in DELETE_FAILED cannot be updated and
 * the bad config could never be fixed; Create and Update must answer FAILED naming the problem. The
 * worker's environment never carries the ARN, so it must keep working — a worker that demanded it
 * failed on every invocation and never reached real work.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

process.env['SERVICE_NAME'] = 'resource-sweeper-starter';
delete process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'];

import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient } from '@aws-sdk/client-sfn';
import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { starterHandler, workerHandler } from '../handler';
import { captureCfnResponse, createEvent, deleteEvent, lambdaContext } from './sweep-helpers';

jest.mock('https', () => ({ request: jest.fn() }));

const sfnMock = mockClient(SFNClient);
const acmMock = mockClient(ACMClient);

describe('handlers — starter config invalid', () => {
  let cfnResponse: ReturnType<typeof captureCfnResponse>;

  beforeEach(() => {
    sfnMock.reset();
    acmMock.reset();
    cfnResponse = captureCfnResponse();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS to a Delete without calling Step Functions, logging the config problem', async () => {
    await starterHandler(deleteEvent(), lambdaContext());

    expect(cfnResponse().Status).toBe('SUCCESS');
    expect(sfnMock.calls()).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      'Invalid starter config; answering SUCCESS to Delete without a sweep',
      { configError: expect.stringContaining('MAILBOX_SWEEPER_STATE_MACHINE_ARN') },
    );
  });

  it('answers FAILED to a Create, naming the missing variable', async () => {
    await starterHandler(createEvent(), lambdaContext());

    const response = cfnResponse();
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
  });

  it('leaves the worker working: a cert removal succeeds without the starter\'s variable', async () => {
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'test-stack' }],
    });
    acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
    acmMock.on(DeleteCertificateCommand).resolves({});

    const output = await workerHandler({
      removalType: 'cert',
      certArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
      rootStackName: 'test-stack',
      rootStackId: 'guid-1',
    });

    expect(output).toEqual({ status: 'SUCCESS' });
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(1);
  });
});
