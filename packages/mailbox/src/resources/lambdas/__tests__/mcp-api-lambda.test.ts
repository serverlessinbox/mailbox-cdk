/// <reference types="jest" />

/**
 * McpApiLambda wrapper tests.
 *
 * Pins the environment names the MCP handler reads by name: the JMAP API endpoint it is pointed at and
 * the OAuth scope map, serialized as JSON. The wrapper makes no grant of its own.
 */

import { Template }                                  from 'aws-cdk-lib/assertions';
import { HttpApi }                                   from 'aws-cdk-lib/aws-apigatewayv2';

import { McpApiLambda }                              from '../mcp-api-lambda';

import { arrangeWrapperStack, onlyLambdaOf }         from './lambda-wrapper-helpers';

const SCOPE_MAP: Record<string, string[]> = {
  'mail.read':  ['MAIL_READ'],
  'mail.write': ['MAIL_WRITE'],
};

function synthesize(): { environment: Record<string, unknown>; jmapEndpoint: unknown } {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const jmapApiGateway              = new HttpApi(stack, 'jmap-api');

  new McpApiLambda(stack, 'mcp-api', { jmapApiGateway, scopeMap: SCOPE_MAP, artifactResolver });

  return {
    environment:  onlyLambdaOf(Template.fromStack(stack)).environment,
    jmapEndpoint: stack.resolve(jmapApiGateway.apiEndpoint),
  };
}

describe('McpApiLambda', () => {
  it('points JMAP_API_URL at the endpoint of the JMAP API gateway', () => {
    const { environment, jmapEndpoint } = synthesize();

    expect(environment.JMAP_API_URL).toEqual(jmapEndpoint);
  });

  it('serializes the scope map into OAUTH_SCOPE_MAP', () => {
    expect(synthesize().environment.OAUTH_SCOPE_MAP).toBe(JSON.stringify(SCOPE_MAP));
  });
});
