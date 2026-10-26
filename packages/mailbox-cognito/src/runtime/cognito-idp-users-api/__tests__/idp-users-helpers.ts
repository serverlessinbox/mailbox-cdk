import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';

/** The authorizer context of an admin caller, as the lookup authorizer writes it: every value is a string. */
export const ADMIN_CONTEXT: Readonly<Record<string, string>> = {
  tenantId:      'tenant-1',
  principalId:   'principal-1',
  principalName: 'jane',
  displayName:   'Jane Doe',
  groups:        '["admin"]',
};

/** The payload of a Lambda invoke answer: the AWS SDK types it as a byte array that can also decode itself. */
export function payloadOf(response: object): Uint8Array & { transformToString(encoding?: string): string } {
  const bytes = new TextEncoder().encode(JSON.stringify(response));
  return Object.assign(bytes, {
    transformToString: (): string => new TextDecoder().decode(bytes),
  });
}

/** An API Gateway HTTP API event that went through the lookup authorizer, posting `body` to `path`. */
export function authorizedEvent(path: string, body: object, authorizerContext: Readonly<Record<string, string>> = ADMIN_CONTEXT): APIGatewayProxyEventV2WithLambdaAuthorizer<Readonly<Record<string, string>>> {
  return {
    version:         '2.0',
    routeKey:        'POST /idp-users/{proxy+}',
    rawPath:         path,
    rawQueryString:  '',
    headers:         {},
    isBase64Encoded: false,
    body:            JSON.stringify(body),
    requestContext:  {
      accountId:    '123456789012',
      apiId:        'api-id',
      authorizer:   { lambda: authorizerContext },
      domainName:   'api.example.com',
      domainPrefix: 'api',
      http:         { method: 'POST', path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.7', userAgent: 'jest' },
      requestId:    'request-1',
      routeKey:     'POST /idp-users/{proxy+}',
      stage:        '$default',
      time:         '25/Oct/2026:13:00:00 +0000',
      timeEpoch:    1793019600000,
    },
  };
}
