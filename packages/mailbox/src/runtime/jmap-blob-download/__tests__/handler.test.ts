/**
 * Coverage for the handler file's wiring: a CloudFront event is read and handed to the authorizer, the
 * DynamoDB client of the verifiers is built in the region the authorizer asks for, and every failure is
 * answered as a CloudFront response. Flush: an unexpected error flushes the trace once, a refusal or a
 * malformed event does not. A handler that flushed a refusal would write the trace of every denied download;
 * one that did not flush an unexpected error would leave the bug without its trace.
 */

import { DynamoDBClient }                                                                   from '@aws-sdk/client-dynamodb';
import { LoggerBuffer }                                                                     from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { handler }                                                                          from '../handler';
import { RegionBoundVerifiers }                                                             from '../verifiers/region-bound-verifiers';

import { cloudFrontEventOf, downloadQuery, encodedBlobIdOf, EU_CENTRAL_1, originRequestOf } from './jmap-blob-download-helpers';

jest.mock('../verifiers/region-bound-verifiers');

function downloadEvent(customHeaders: Record<string, string> | null): unknown {
  return cloudFrontEventOf(originRequestOf({
    customHeaders,
    querystring: downloadQuery({ accountId: 'account-1', blobId: encodedBlobIdOf('cnt:card-1:photo.jpg'), auth: 'session-token' }),
  }));
}

describe('handler', () => {
  const verifiersFactory = jest.mocked(RegionBoundVerifiers).mock.calls[0][0];
  const verifiersGet     = jest.mocked(RegionBoundVerifiers).mock.instances[0].get as jest.Mock;
  let flush: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    flush        = jest.spyOn(LoggerBuffer.prototype, 'flush');
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    verifiersGet.mockReset();
    jest.restoreAllMocks();
  });

  it('answers a CORS preflight through the authorizer without flushing', async () => {
    const preflight = cloudFrontEventOf(originRequestOf({ method: 'OPTIONS', origin: 'https://webmail.example.com' }));

    await expect(handler(preflight)).resolves.toMatchObject({ status: '200', statusDescription: 'OK' });
    expect(flush).not.toHaveBeenCalled();
  });

  it('answers a refused request with its status and does not flush', async () => {
    await expect(handler(downloadEvent(null))).resolves.toMatchObject({ status: '500', statusDescription: 'Configuration error: the custom origin headers of the S3 origin are missing' });
    expect(flush).not.toHaveBeenCalled();
  });

  it('answers an event that is not a CloudFront event with a generic 500, writes the reason and does not flush', async () => {
    await expect(handler({ Records: [] })).resolves.toMatchObject({ status: '500', statusDescription: 'Internal server error' });

    const malformedMessage: unknown = expect.stringContaining('Malformed CloudFront event');
    expect(consoleError).toHaveBeenCalledWith('Authorization error', { error: malformedMessage });
    expect(flush).not.toHaveBeenCalled();
  });

  it('asks the verifiers for the region of the configuration', async () => {
    verifiersGet.mockImplementation(() => {
      throw new Error('verifiers are not under test');
    });

    await handler(downloadEvent({ 'x-auth-key-store-table': 'auth-key-store', 'x-region': 'ap-south-1' }));

    expect(verifiersGet).toHaveBeenCalledWith('ap-south-1');
  });

  it('flushes once and answers a generic 500 when the authorizer fails unexpectedly', async () => {
    verifiersGet.mockImplementation(() => {
      throw new Error('socket hang up');
    });

    await expect(handler(downloadEvent({ 'x-auth-key-store-table': 'auth-key-store', 'x-region': 'eu-west-1' }))).resolves.toMatchObject({
      status:            '500',
      statusDescription: 'Internal server error',
    });
    expect(flush).toHaveBeenCalledTimes(1);
    const hangUpMessage: unknown = expect.stringContaining('socket hang up');
    expect(consoleError).toHaveBeenCalledWith('Authorization error', { error: hangUpMessage });
  });

  it('builds the DynamoDB client of the verifiers in the region it is asked for', async () => {
    const client = verifiersFactory(EU_CENTRAL_1);

    expect(client).toBeInstanceOf(DynamoDBClient);
    await expect(client.config.region()).resolves.toBe('eu-central-1');
  });
});
