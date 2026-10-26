/// <reference types="jest" />

/**
 * McpApiLambda wrapper tests.
 *
 * Pins the environment names the MCP handler reads by name: the JMAP API URL it is pointed at and
 * the OAuth scope map, serialized as JSON. The wrapper makes no grant of its own.
 */

import { Template }                                  from 'aws-cdk-lib/assertions';

import { McpApiLambda }                              from '../mcp-api-lambda';

import { arrangeWrapperStack, onlyLambdaOf }         from './lambda-wrapper-helpers';

const JMAP_API_URL = 'https://jmap.example.com';

const SCOPE_MAP: Record<string, string[]> = {
  'mail.read':  ['MAIL_READ'],
  'mail.write': ['MAIL_WRITE'],
};

function synthesize(): Record<string, unknown> {
  const { stack, artifactResolver } = arrangeWrapperStack();

  new McpApiLambda(stack, 'mcp-api', { jmapApiUrl: JMAP_API_URL, scopeMap: SCOPE_MAP, artifactResolver });

  return onlyLambdaOf(Template.fromStack(stack)).environment;
}

describe('McpApiLambda', () => {
  it('points JMAP_API_URL at the given JMAP API URL', () => {
    expect(synthesize().JMAP_API_URL).toBe(JMAP_API_URL);
  });

  it('serializes the scope map into OAUTH_SCOPE_MAP', () => {
    expect(synthesize().OAUTH_SCOPE_MAP).toBe(JSON.stringify(SCOPE_MAP));
  });
});
