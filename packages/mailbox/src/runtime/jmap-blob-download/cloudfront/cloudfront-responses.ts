/** A header of a CloudFront-generated response: the display `key` and its `value`. */
export interface CloudFrontResponseHeader {
  readonly key:   string;
  readonly value: string;
}

/** The headers of a CloudFront-generated response: each lower-cased header name maps to its values. */
export type CloudFrontResponseHeaders = Readonly<Record<string, readonly CloudFrontResponseHeader[]>>;

/** A response CloudFront returns to the viewer without reaching the origin. */
export interface CloudFrontResponse {
  readonly status:            string;
  readonly statusDescription: string;
  readonly headers:           CloudFrontResponseHeaders;
  readonly body?:             string;
}

/** A JSON error: the status code, with the message as both the status description and the body's `error`. */
export function errorResponse(status: number, message: string): CloudFrontResponse {
  return {
    status:            status.toString(),
    statusDescription: message,
    headers:           {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
    },
    body:              JSON.stringify({ error: message }),
  };
}

/**
 * The answer to a CORS preflight. An origin on the allowlist is echoed back with credentialed CORS; any other
 * origin, or none, gets a 200 with no CORS headers, so the browser refuses the cross-origin request.
 */
export function corsPreflightResponse(requestOrigin: string | undefined, allowedOrigins: readonly string[]): CloudFrontResponse {
  if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
    return { status: '200', statusDescription: 'OK', headers: {} };
  }

  return {
    status:            '200',
    statusDescription: 'OK',
    headers:           {
      'access-control-allow-origin':      [{
        key:   'Access-Control-Allow-Origin',
        value: requestOrigin,
      }],
      'access-control-allow-methods':     [{
        key:   'Access-Control-Allow-Methods',
        value: 'GET, HEAD, OPTIONS',
      }],
      'access-control-allow-headers':     [{
        key:   'Access-Control-Allow-Headers',
        value: 'Authorization, Content-Type, Cache-Control',
      }],
      'access-control-allow-credentials': [{
        key:   'Access-Control-Allow-Credentials',
        value: 'true',
      }],
      'access-control-max-age':           [{
        key:   'Access-Control-Max-Age',
        value: '3600',
      }],
    },
  };
}
