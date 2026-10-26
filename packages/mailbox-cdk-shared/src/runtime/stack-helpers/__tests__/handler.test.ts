/// <reference types="jest" />

/**
 * Pins what the stack-helpers handler file decides: a bad configuration is answered to CloudFormation
 * as FAILED (never a crash that leaves the resource waiting for its service timeout), the manual-finalize
 * hint is emitted, the buffered trace is flushed when the lookup fails unexpectedly, and a failed Update
 * during a rollback is answered SUCCESS. The response is read from the request the handler sends to the
 * ResponseURL.
 */

import type * as CloudFormationSdk                                              from '@aws-sdk/client-cloudformation';
import type * as Route53Sdk                                                     from '@aws-sdk/client-route-53';
import { mockClient }                                                           from 'aws-sdk-client-mock';
import type { AwsClientStub }                                                   from 'aws-sdk-client-mock';

import { captureCfnResponse }                                                   from '../../../runtime-test-support';
import type { SmokeTestProbe }                                                  from '../../handler-kit/smoke-test';
import type * as HandlerModule                                                  from '../handler';

import { fakeCreateEvent, fakeDeleteEvent, fakeLambdaContext, fakeUpdateEvent } from './cfn-helpers';
import type { FakeCfnEvent }                                                    from './cfn-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('stack-helpers handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * Loads the handler fresh under the given environment, with Route 53 faked and the CloudFormation
   * response captured, then invokes it with the event.
   */
  async function invoke(
    event: FakeCfnEvent | SmokeTestProbe,
    environment: Record<string, string>,
    arrange: (
      route53Mock: AwsClientStub<Route53Sdk.Route53Client>,
      route53Sdk: typeof Route53Sdk,
      cloudFormationMock: AwsClientStub<CloudFormationSdk.CloudFormationClient>,
      cloudFormationSdk: typeof CloudFormationSdk,
    ) => void = () => undefined,
  ) {
    jest.resetModules();
    process.env = { ...originalEnv, ...environment };

    // Required after resetModules so the faked client class is the one the handler constructs.
    const route53Sdk                              = require('@aws-sdk/client-route-53') as typeof Route53Sdk;
    const { GetHostedZoneCommand, Route53Client } = route53Sdk;
    const route53Mock                             = mockClient(Route53Client);
    route53Mock.on(GetHostedZoneCommand).resolves({
      HostedZone: { Id: '/hostedzone/Z123', Name: 'example.com.', CallerReference: 'ref' },
    });
    // The parent stack is not rolling back unless a test says so.
    const cloudFormationSdk  = require('@aws-sdk/client-cloudformation') as typeof CloudFormationSdk;
    const cloudFormationMock = mockClient(cloudFormationSdk.CloudFormationClient);
    cloudFormationMock.on(cloudFormationSdk.DescribeStacksCommand).resolves({ Stacks: [] });
    arrange(route53Mock, route53Sdk, cloudFormationMock, cloudFormationSdk);

    const readResponse = captureCfnResponse();

    const { handler } = require('../handler') as typeof HandlerModule;
    const result      = await handler(event, fakeLambdaContext());

    return {
      result,
      get response() {
        return readResponse();
      },
      hostedZoneLookups: route53Mock.commandCalls(GetHostedZoneCommand),
    };
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

  it('emits the manual-finalize hint under the configured service name', async () => {
    await invoke(fakeDeleteEvent({ HostedZoneId: 'Z123' }), { SERVICE_NAME: 'stack-helpers' });

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=stack-helpers$/));
  });

  it('answers FAILED and flushes the buffered trace when the Route 53 lookup fails unexpectedly', async () => {
    const { response } = await invoke(
      fakeCreateEvent({ HostedZoneId: 'Z123' }),
      { SERVICE_NAME: 'stack-helpers' },
      (route53Mock, sdk) => route53Mock.on(sdk.GetHostedZoneCommand).rejects(new Error('AccessDenied')),
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('AccessDenied');
    expect(console.debug).toHaveBeenCalledWith('stack_helpers_looking_up_hosted_zone', {
      hostedZoneId: 'Z123',
      service:      'stack-helpers',
    });
  });

  it('answers SUCCESS with the unchanged physical id to an Update that fails while the parent stack rolls back', async () => {
    const { response } = await invoke(
      fakeUpdateEvent({ HostedZoneId: 'Z123' }),
      { SERVICE_NAME: 'stack-helpers' },
      (route53Mock, route53Sdk, cloudFormationMock, cloudFormationSdk) => {
        route53Mock.on(route53Sdk.GetHostedZoneCommand).rejects(new Error('AccessDenied'));
        cloudFormationMock.on(cloudFormationSdk.DescribeStacksCommand).resolves({
          Stacks: [{ StackName: 'test', CreationTime: new Date(), StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS' }],
        });
      },
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'physical-id' });
  });

});
