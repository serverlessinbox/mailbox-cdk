/// <reference types="jest" />

/**
 * Pins what the stack-helpers handler file decides: a bad configuration is answered to CloudFormation
 * as FAILED (never a crash that leaves the resource waiting for its service timeout), Delete does no
 * lookup, and a Create hands its resource properties to the resolver and returns the result as the
 * resource's attributes. The response is read from the request the handler sends to the ResponseURL.
 */

import { Writable } from 'stream';
import { mockClient } from 'aws-sdk-client-mock';
import { fakeCreateEvent, fakeDeleteEvent, fakeLambdaContext } from './cfn-helpers';
import type { FakeCfnEvent } from './cfn-helpers';
import type * as Https from 'https';
import type * as Route53Sdk from '@aws-sdk/client-route-53';
import type * as HandlerModule from '../handler';
import type { SmokeTestProbe } from '../../shared/with-smoke-test';

jest.mock('https', () => ({
  request: jest.fn(),
}));

interface CfnResponseBody {
  Status: string;
  Reason?: string;
  Data?: Record<string, string>;
}

describe('stack-helpers handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * Loads the handler fresh under the given environment, with Route 53 faked and the CloudFormation
   * response captured, then invokes it with the event.
   */
  async function invoke(event: FakeCfnEvent | SmokeTestProbe, environment: Record<string, string>) {
    jest.resetModules();
    process.env = { ...originalEnv, ...environment };

    // Required after resetModules so the faked client class is the one the handler constructs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GetHostedZoneCommand, Route53Client } = require('@aws-sdk/client-route-53') as typeof Route53Sdk;
    const route53Mock = mockClient(Route53Client);
    route53Mock.on(GetHostedZoneCommand).resolves({
      HostedZone: { Id: '/hostedzone/Z123', Name: 'example.com.', CallerReference: 'ref' },
    });

    let responseJson = '';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof Https;
    jest.mocked(https.request).mockImplementation(((_options: unknown, callback: (res: object) => void) => {
      callback({ statusCode: 200 });
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          responseJson += chunk.toString();
          done();
        },
      });
    }) as typeof https.request);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handler } = require('../handler') as typeof HandlerModule;
    const result = await handler(event, fakeLambdaContext());
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response: CfnResponseBody = responseJson === '' ? { Status: 'NOT SENT' } : JSON.parse(responseJson);
    return { result, response, hostedZoneLookups: route53Mock.commandCalls(GetHostedZoneCommand) };
  }

  it('reports the smoke-test probe unhealthy when the configuration is bad', async () => {
    const { result } = await invoke({ serverlessInboxSmokeTest: true }, { SERVICE_NAME: '' });

    expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('answers FAILED naming the variable when the configuration is bad', async () => {
    const { response, hostedZoneLookups } = await invoke(
      fakeCreateEvent({ HostedZoneId: 'Z123' }),
      { SERVICE_NAME: '' },
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('SERVICE_NAME');
    expect(hostedZoneLookups).toHaveLength(0);
  });

  it('answers SUCCESS to Delete with the physical id CloudFormation sent when the configuration is bad', async () => {
    const { response, hostedZoneLookups } = await invoke(
      fakeDeleteEvent({ HostedZoneId: 'Z123' }),
      { SERVICE_NAME: '' },
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'physical-id' });
    expect(hostedZoneLookups).toHaveLength(0);
  });

  it('answers SUCCESS to Delete without looking anything up', async () => {
    const { response, hostedZoneLookups } = await invoke(
      fakeDeleteEvent({ HostedZoneId: 'Z123' }),
      { SERVICE_NAME: 'stack-helpers' },
    );

    expect(response.Status).toBe('SUCCESS');
    expect(hostedZoneLookups).toHaveLength(0);
  });

  it('answers a Create with the resolver result as the resource attributes', async () => {
    const { response, hostedZoneLookups } = await invoke(
      fakeCreateEvent({ HostedZoneId: 'Z123', DataStackName: 'Data_Stack' }),
      { SERVICE_NAME: 'stack-helpers' },
    );

    expect(hostedZoneLookups[0].args[0].input).toEqual({ Id: 'Z123' });
    expect(response).toMatchObject({
      Status: 'SUCCESS',
      Data: { domainName: 'example.com', s3SafeDataStackName: 'data-stack', cognitoDomainPrefix: 'example-com' },
    });
  });

  it('answers FAILED when the resource properties are invalid', async () => {
    const { response } = await invoke(
      fakeCreateEvent({ HostedZoneId: 5 }),
      { SERVICE_NAME: 'stack-helpers' },
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Invalid ResourceProperties');
  });
});
