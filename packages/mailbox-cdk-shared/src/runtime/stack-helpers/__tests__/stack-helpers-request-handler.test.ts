/**
 * Pins how a Custom::StackHelpers request is answered: Delete is answered with nothing and without a Route 53
 * lookup, because the resource creates nothing to undo, and every other request is answered with the attributes
 * the resolver derives from the request's properties and stack id. Route 53 is the faked boundary.
 */

import { GetHostedZoneCommand, Route53Client } from '@aws-sdk/client-route-53';
import { mockClient }                          from 'aws-sdk-client-mock';

import { cfnRequest }                          from '../../handler-kit/custom-resource/__tests__/custom-resource-request-helpers';
import { LoggerBuffer }                        from '../../handler-kit/logger-buffer';
import { StackHelpersRequestHandler }          from '../stack-helpers-request-handler';
import { StackHelpersResolver }                from '../stack-helpers-resolver';

const PROPERTIES = { HostedZoneId: 'Z123', DataStackName: 'Data_Stack' };

describe('StackHelpersRequestHandler', () => {
  const route53Mock = mockClient(Route53Client);
  const handler     = new StackHelpersRequestHandler(new StackHelpersResolver(new Route53Client({}), new LoggerBuffer('test-service', 'error')));

  beforeEach(() => {
    route53Mock.reset();
    route53Mock.on(GetHostedZoneCommand).resolves({
      HostedZone: { Id: '/hostedzone/Z123', Name: 'example.com.', CallerReference: 'ref' },
    });
  });

  it('answers Delete with nothing and without looking anything up', async () => {
    const answer = await handler.handle(cfnRequest('Delete', PROPERTIES));

    expect(answer).toEqual({});
    expect(route53Mock.commandCalls(GetHostedZoneCommand)).toHaveLength(0);
  });

  it.each(['Create', 'Update'] as const)('answers %s with the attributes the resolver derives from the properties', async (requestType) => {
    const answer = await handler.handle(cfnRequest(requestType, PROPERTIES));

    expect(answer).toEqual({
      Data: { domainName: 'example.com', s3SafeDataStackName: 'data-stack', cognitoDomainPrefix: 'example-com' },
    });
  });
});
