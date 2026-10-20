import { toAccountId, toIssuer, toRegion, toTableName, toTenantId }                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as crypto                                                                  from 'crypto';

import { toAudience }                                                               from '../auth-identifiers';
import { toDecodedBlobId, toEncodedBlobId, type DecodedBlobId, type EncodedBlobId } from '../blob-id';
import { readOriginRequest, type CloudFrontRequest }                                from '../cloudfront-event';

export const AUTH_KEY_STORE_TABLE = toTableName('auth-key-store');
export const OTHER_AUTH_KEY_STORE_TABLE = toTableName('other-auth-key-store');
export const EU_CENTRAL_1 = toRegion('eu-central-1');
export const EU_WEST_1 = toRegion('eu-west-1');
export const US_EAST_1 = toRegion('us-east-1');
export const TENANT_ID = toTenantId('tenant-1');
export const ACCOUNT_ID = toAccountId('account-1');
export const ISSUER = toIssuer('https://idp.example.com/pool');
export const AUDIENCE = toAudience('client-1');
export const ANOTHER_ISSUER = toIssuer('https://another-idp.example.com');
export const ANOTHER_AUDIENCE = toAudience('client-2');
export const NO_AUDIENCE = toAudience('');

/** The unpadded base64url form of a decoded blob id, as a download URL carries it. */
export function encodedBlobIdOf(decoded: string): EncodedBlobId {
  return toEncodedBlobId(Buffer.from(decoded, 'utf-8').toString('base64url'));
}

export function decodedBlobIdOf(raw: string): DecodedBlobId {
  return toDecodedBlobId(raw);
}

/** A session token as the Go signer builds it: `base64RawURL(payload).base64RawURL(HMAC-SHA256(key, payload))`. */
export function sessionTokenSignedBy(key: Buffer, tenantId: string, issuer: string, audience: string, accountIds: string[]): string {
  return sessionTokenOverPayload(key, `${tenantId}|${issuer}|${audience}|${accountIds.join(',')}`);
}

/** A session token signing an arbitrary payload string, for payloads the Go signer would not build. */
export function sessionTokenOverPayload(key: Buffer, payload: string): string {
  const payloadBytes = Buffer.from(payload, 'utf-8');
  const signature    = crypto.createHmac('sha256', key).update(payloadBytes).digest();
  return `${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`;
}

/** A blob id MAC as the Go signer builds it: `base64url(HMAC-SHA256(key, "{tenantId}|{accountId}|{emailId}"))`. */
export function blobMacSignedBy(key: Buffer, tenantId: string, accountId: string, emailId: string): string {
  return crypto.createHmac('sha256', key).update(`${tenantId}|${accountId}|${emailId}`).digest('base64url');
}

export interface OriginRequestOptions {
  readonly method?: string;
  /** The raw query string; `undefined` leaves the request without one. */
  readonly querystring?: string;
  /** The `Authorization` header value; `null` leaves the request without the header. */
  readonly authorization?: string | null;
  /** The `Origin` header value; absent leaves the request without the header. */
  readonly origin?: string;
  /** The custom origin headers of the S3 origin; `null` leaves the request without an origin. */
  readonly customHeaders?: Record<string, string> | null;
}

const DEFAULT_CUSTOM_HEADERS: Record<string, string> = {
  'x-auth-key-store-table': AUTH_KEY_STORE_TABLE,
  'x-region': 'eu-west-1',
};

/** The query string of a JMAP download URL; a parameter left `undefined` is not in it. */
export function downloadQuery(parameters: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }
  return query.toString();
}

/** A CloudFront origin-request event carrying `request`, as CloudFront delivers it. */
export function cloudFrontEventOf(request: unknown): unknown {
  return { Records: [{ cf: { config: { eventType: 'origin-request' }, request } }] };
}

/** An origin request as CloudFront sends it, read through the same validation the handler applies. */
export function originRequestOf(options: OriginRequestOptions = {}): CloudFrontRequest {
  const headers: Record<string, Array<{ key: string; value: string }>> = {};
  if (options.authorization !== null) {
    headers['authorization'] = [{ key: 'Authorization', value: options.authorization ?? 'Bearer jwt-token' }];
  }
  if (options.origin !== undefined) {
    headers['origin'] = [{ key: 'Origin', value: options.origin }];
  }

  const customHeaders = options.customHeaders === undefined ? DEFAULT_CUSTOM_HEADERS : options.customHeaders;
  const origin        = customHeaders === null
    ? undefined
    : {
      s3: {
        customHeaders: Object.fromEntries(
          Object.entries(customHeaders).map(([name, value]) => [name, [{ key: name, value }]]),
        ),
      },
    };

  return readOriginRequest(cloudFrontEventOf({
    method: options.method ?? 'GET',
    uri: '/download',
    querystring: options.querystring,
    headers,
    origin,
  }));
}
