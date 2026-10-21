/**
 * Coverage for the handler file when the worker's config is invalid (SERVICE_NAME is unset): the worker
 * throws the config problem, naming the variable, instead of running a sweep with a half-built config.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

delete process.env['SERVICE_NAME'];
delete process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'];

import { ACMClient, ListTagsForCertificateCommand } from '@aws-sdk/client-acm';
import { mockClient }                               from 'aws-sdk-client-mock';

import { workerHandler }                            from '../handler';

const acmMock = mockClient(ACMClient);

describe('workerHandler — worker config invalid', () => {
  it('throws the config problem without calling any AWS API', async () => {
    await expect(
      workerHandler({
        removalType: 'cert',
        certArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
        rootStackName: 'test-stack',
        rootStackId: 'guid-1',
      }),
    ).rejects.toThrow('SERVICE_NAME');

    expect(acmMock.commandCalls(ListTagsForCertificateCommand)).toHaveLength(0);
  });
});
