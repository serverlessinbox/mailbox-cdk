import type { AuthorizedEvent } from '../caller/authorized-event';

/** The authorizer context of an admin caller, as the authorizer writes it: every value is a string. */
export const ADMIN_CONTEXT: Readonly<Record<string, string>> = {
  tenantId:      'tenant-1',
  principalId:   'principal-1',
  principalName: 'jane',
  displayName:   'Jane Doe',
  groups:        '["admin"]',
};

/** What a test sets on the event; everything else is a fixed, valid value. */
export interface EventOptions {
  readonly path?:      string;
  readonly method?:    string;
  readonly body?:      string;
  readonly requestId?: string;
  readonly context?:   Readonly<Record<string, unknown>>;
}

/** An API Gateway HTTP API event that went through a Lambda authorizer. */
export function authorizedEvent(options: EventOptions = {}): AuthorizedEvent {
  const path = options.path ?? '/idp-users/ListIdpUsers';
  return {
    version:         '2.0',
    routeKey:        'ANY /idp-users/{proxy+}',
    rawPath:         path,
    rawQueryString:  '',
    headers:         {},
    isBase64Encoded: false,
    body:            options.body,
    requestContext:  {
      accountId:    '123456789012',
      apiId:        'api-id',
      authorizer:   { lambda: options.context ?? ADMIN_CONTEXT },
      domainName:   'api.example.com',
      domainPrefix: 'api',
      http:         { method: options.method ?? 'POST', path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.7', userAgent: 'jest' },
      requestId:    options.requestId ?? 'request-1',
      routeKey:     'ANY /idp-users/{proxy+}',
      stage:        '$default',
      time:         '25/Oct/2026:13:00:00 +0000',
      timeEpoch:    1793019600000,
    },
  };
}
