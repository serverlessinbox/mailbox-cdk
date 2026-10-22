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

/** The answer to a CORS preflight: any origin is echoed back, or `*` when the request names none. */
export function corsPreflightResponse(requestOrigin: string | undefined): CloudFrontResponse {
  return {
    status:            '200',
    statusDescription: 'OK',
    headers:           {
      'access-control-allow-origin':      [{
        key:   'Access-Control-Allow-Origin',
        value: requestOrigin || '*',
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
