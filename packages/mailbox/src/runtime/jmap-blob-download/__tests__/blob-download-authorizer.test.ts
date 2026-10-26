/**
 * Pins every decision the JMAP blob download function makes about a download request: each denial with its status and
 * answer, in the order the checks run, and each allowed blob type with the S3 key and headers it is rewritten
 * to. The verifiers are faked at their entry points, because their own suites pin the cryptography; what is
 * pinned here is what the authorizer asks them and what it does with their answers. A check that stopped
 * denying would serve a blob to a caller who must not read it, and a denial written at error level would put
 * every refused request in the log.
 */

import { DynamoDBClient }                          from '@aws-sdk/client-dynamodb';
import { ExpectedFailure, LoggerBuffer, toIssuer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { BlobDownloadAuthorizer }                  from '../blob-download-authorizer';
import { BlobRequestRejected }                     from '../blob-id/blob-request-rejected';
import type { CloudFrontRequest }                  from '../cloudfront/cloudfront-event';
import { corsPreflightResponse, errorResponse }    from '../cloudfront/cloudfront-responses';
import type { HmacTokenPayload, VerifiedJwt }      from '../verifiers/auth-tokens';
import { HmacVerifier }                            from '../verifiers/hmac-verifier';
import { JwtVerifier }                             from '../verifiers/jwt-verifier';

import {
  ACCOUNT_ID,
  ANOTHER_AUDIENCE,
  ANOTHER_ISSUER,
  AUDIENCE,
  AUTH_KEY_STORE_TABLE,
  downloadQuery,
  encodedBlobIdOf,
  ISSUER,
  NO_AUDIENCE,
  originRequestOf,
  TENANT_ID,
  type OriginRequestOptions,
} from './jmap-blob-download-helpers';

const VERIFIED_JWT: VerifiedJwt = { sub: 'user-1', issuer: ISSUER, audience: AUDIENCE };
const SESSION: HmacTokenPayload = { tenantId: TENANT_ID, issuer: ISSUER, audience: AUDIENCE, sub: 'user-1', accountIds: [ACCOUNT_ID] };

interface DownloadOptions {
  readonly blob?:      string;
  readonly accountId?: string | undefined;
  readonly type?:      string | undefined;
  readonly name?:      string | undefined;
  readonly auth?:      string | undefined;
  readonly blobId?:    string | undefined;
  readonly request?:   OriginRequestOptions;
}

function downloadRequest(options: DownloadOptions = {}): CloudFrontRequest {
  const has = (key: keyof DownloadOptions): boolean => key in options;
  return originRequestOf({
    querystring: downloadQuery({
      accountId: has('accountId') ? options.accountId : 'account-1',
      blobId:    has('blobId') ? options.blobId : encodedBlobIdOf(options.blob ?? 'eml:email-1:document.pdf:mac-value'),
      type:      has('type') ? options.type : 'application/pdf',
      name:      has('name') ? options.name : 'test.pdf',
      auth:      has('auth') ? options.auth : 'session-token',
    }),
    ...options.request,
  });
}

describe('BlobDownloadAuthorizer', () => {
  let logger: LoggerBuffer;
  let authorizer: BlobDownloadAuthorizer;
  let verifiersFor: jest.Mock;
  let verifySignatureOnly: jest.SpyInstance;
  let verifySessionToken: jest.SpyInstance;
  let verifyBlobMac: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  let flush: jest.SpyInstance;

  async function expectRejected(request: CloudFrontRequest, status: number, answer: string): Promise<void> {
    const rejection = authorizer.authorize(request);

    await expect(rejection).rejects.toBeInstanceOf(BlobRequestRejected);
    await expect(rejection).rejects.toMatchObject({ status, message: answer });
  }

  beforeEach(() => {
    const dynamodb      = new DynamoDBClient({});
    verifySignatureOnly = jest.spyOn(JwtVerifier.prototype, 'verifySignatureOnly').mockResolvedValue(VERIFIED_JWT);
    verifySessionToken  = jest.spyOn(HmacVerifier.prototype, 'verifySessionToken').mockResolvedValue(SESSION);
    verifyBlobMac       = jest.spyOn(HmacVerifier.prototype, 'verifyBlobMac').mockResolvedValue(true);
    consoleError        = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    flush = jest.spyOn(LoggerBuffer.prototype, 'flush');

    logger       = new LoggerBuffer();
    verifiersFor = jest.fn(() => ({ jwt: new JwtVerifier(dynamodb), hmac: new HmacVerifier(dynamodb) }));
    authorizer   = new BlobDownloadAuthorizer(logger, verifiersFor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a CORS preflight', () => {
    const ALLOWED_ORIGINS_HEADERS = { 'x-allowed-origins': 'https://webmail.example.com,https://admin.example.com' };

    it('is answered from the request origin and the allowlist header, before any credential is looked at', async () => {
      const request = originRequestOf({ method: 'OPTIONS', origin: 'https://admin.example.com', customHeaders: ALLOWED_ORIGINS_HEADERS, authorization: null });

      const answer = await authorizer.authorize(request);

      expect(answer).toEqual(corsPreflightResponse('https://admin.example.com', ['https://webmail.example.com', 'https://admin.example.com']));
      expect(verifiersFor).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('rejects with a 500 that names the broken header, as an expected answer that writes no error', async () => {
      const request = downloadRequest({ request: { customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE } } });

      await expectRejected(request, 500, 'Configuration error: header x-region is missing or empty');

      expect(consoleError).not.toHaveBeenCalled();
    });

    it('takes the verifiers of the region the configuration names', async () => {
      await authorizer.authorize(downloadRequest({ request: { customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': 'ap-south-1' } } }));

      expect(verifiersFor).toHaveBeenCalledWith('ap-south-1');
    });
  });

  describe('download parameters', () => {
    it.each([
      { parameter: 'accountId', missing: { accountId: undefined } },
      { parameter: 'blobId', missing: { blobId: undefined } },
    ])('rejects a request without $parameter with a 400', async ({ missing }) => {
      await expectRejected(downloadRequest(missing), 400, 'Missing required parameters: accountId and blobId');
    });

    it('rejects a request without a query string with a 400', async () => {
      await expectRejected(originRequestOf(), 400, 'Missing required parameters: accountId and blobId');
    });

    it('rejects a blob id that is not base64url with a 400', async () => {
      await expectRejected(downloadRequest({ blobId: '!!!not base64url!!!' }), 400, 'Invalid blobId format');
    });

    it('rejects a blob id that decodes to no known blob type with a 400', async () => {
      await expectRejected(downloadRequest({ blob: 'xyz:entity:path' }), 400, 'Invalid blobId format');
    });
  });

  describe('bearer token', () => {
    it.each([
      { header: 'no Authorization header', authorization: null },
      { header: 'a scheme other than Bearer', authorization: 'Basic dXNlcjpwYXNz' },
      { header: 'a Bearer scheme without a token', authorization: 'Bearer ' },
      { header: 'a lone Bearer word', authorization: 'Bearer' },
      { header: 'more than one token', authorization: 'Bearer one two' },
    ])('rejects $header with a 401', async ({ authorization }) => {
      const request = originRequestOf({
        authorization,
        querystring: downloadQuery({ accountId: 'account-1', blobId: encodedBlobIdOf('eml:email-1:document.pdf:mac-value'), auth: 'session-token' }),
      });

      await expectRejected(request, 401, 'Missing or invalid Authorization header');
    });

    it('is checked after the blob id and before the session token', async () => {
      const request = originRequestOf({ authorization: null, querystring: downloadQuery({ accountId: 'account-1', blobId: encodedBlobIdOf('eml:e:d.pdf:m') }) });

      await expectRejected(request, 401, 'Missing or invalid Authorization header');
    });
  });

  describe('session token', () => {
    it('rejects a request without an auth query parameter with a 401', async () => {
      await expectRejected(downloadRequest({ auth: undefined }), 401, 'Unauthorized');
    });

    it('rejects an empty auth query parameter with a 401', async () => {
      await expectRejected(downloadRequest({ auth: '' }), 401, 'Unauthorized');
    });
  });

  describe('JWT', () => {
    it('is verified with the bearer token, the table and the allowed algorithms of the configuration', async () => {
      const request = downloadRequest({
        request: {
          authorization: 'Bearer the-jwt',
          customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': 'eu-west-1', 'x-jwt-algorithms': 'RS256,ES256' },
        },
      });

      await authorizer.authorize(request);

      expect(verifySignatureOnly).toHaveBeenCalledWith('the-jwt', AUTH_KEY_STORE_TABLE, ['RS256', 'ES256']);
    });

    it('rejects a token that does not verify with a 401, before the session token is verified', async () => {
      verifySignatureOnly.mockResolvedValue(null);

      await expectRejected(downloadRequest(), 401, 'Unauthorized');
      expect(verifySessionToken).not.toHaveBeenCalled();
    });
  });

  describe('HMAC session', () => {
    it('is verified with the auth query parameter and the table of the configuration', async () => {
      await authorizer.authorize(downloadRequest({ auth: 'the-session-token' }));

      expect(verifySessionToken).toHaveBeenCalledWith('the-session-token', AUTH_KEY_STORE_TABLE);
    });

    it('rejects a session token that does not verify with a 403', async () => {
      verifySessionToken.mockResolvedValue(null);

      await expectRejected(downloadRequest(), 403, 'Access denied: invalid auth token');
    });

    it('lets a failure to read the keys propagate as it is', async () => {
      verifySessionToken.mockRejectedValue(new Error('AccessDeniedException'));

      await expect(authorizer.authorize(downloadRequest())).rejects.toThrow('AccessDeniedException');
    });
  });

  describe('account access', () => {
    it.each([
      { kind: 'an email', blob: 'eml:email-1:document.pdf:mac-value' },
      { kind: 'a contact', blob: 'cnt:card-1:photo.jpg' },
    ])('rejects $kind blob of an account the session does not list with a 403', async ({ blob }) => {
      await expectRejected(downloadRequest({ blob, accountId: 'account-2' }), 403, 'Access denied: account not authorized');
    });

    it('serves a principal blob whatever account the request names', async () => {
      const answer = authorizer.authorize(downloadRequest({ blob: 'prn:principal-1:avatar.png', accountId: 'account-2' }));

      await expect(answer).resolves.toHaveProperty('uri', '/tenants/tenant-1/principals/principal-1/avatar.png');
    });
  });

  describe('identity agreement between JWT and session', () => {
    it('rejects a session issued to another subject than the JWT with a 403', async () => {
      verifySessionToken.mockResolvedValue({ ...SESSION, sub: 'user-2' });

      await expectRejected(downloadRequest(), 403, 'Access denied: subject mismatch');
    });

    it('rejects a session issued for another issuer with a 403', async () => {
      verifySessionToken.mockResolvedValue({ ...SESSION, issuer: ANOTHER_ISSUER });

      await expectRejected(downloadRequest(), 403, 'Access denied: issuer mismatch');
    });

    it('rejects a session issued for another audience with a 403', async () => {
      verifySessionToken.mockResolvedValue({ ...SESSION, audience: ANOTHER_AUDIENCE });

      await expectRejected(downloadRequest(), 403, 'Access denied: audience mismatch');
    });

    it('does not hold the session to an issuer the JWT does not name', async () => {
      verifySignatureOnly.mockResolvedValue({ ...VERIFIED_JWT, issuer: toIssuer('') });
      verifySessionToken.mockResolvedValue({ ...SESSION, issuer: ANOTHER_ISSUER });

      await expect(authorizer.authorize(downloadRequest())).resolves.toHaveProperty('uri');
    });

    it('does not hold the session to an audience the JWT does not name', async () => {
      verifySignatureOnly.mockResolvedValue({ ...VERIFIED_JWT, audience: NO_AUDIENCE });
      verifySessionToken.mockResolvedValue({ ...SESSION, audience: ANOTHER_AUDIENCE });

      await expect(authorizer.authorize(downloadRequest())).resolves.toHaveProperty('uri');
    });
  });

  describe('email blob MAC', () => {
    it('rejects an email blob id issued without a MAC with a 403', async () => {
      await expectRejected(downloadRequest({ blob: 'eml:email-1:document.pdf' }), 403, 'Access denied: invalid blob');
      expect(verifyBlobMac).not.toHaveBeenCalled();
    });

    it('is verified over the session tenant, the requested account and the email id', async () => {
      await authorizer.authorize(downloadRequest({ blob: 'eml:email-1:document.pdf:the-mac' }));

      expect(verifyBlobMac).toHaveBeenCalledWith('tenant-1|account-1|email-1', 'the-mac', AUTH_KEY_STORE_TABLE);
    });

    it('rejects an email blob whose MAC does not verify with a 403', async () => {
      verifyBlobMac.mockResolvedValue(false);

      await expectRejected(downloadRequest(), 403, 'Access denied: invalid blob');
    });

    it.each(['cnt:card-1:photo.jpg', 'prn:principal-1:avatar.png'])('is not asked for %s', async (blob) => {
      await authorizer.authorize(downloadRequest({ blob }));

      expect(verifyBlobMac).not.toHaveBeenCalled();
    });
  });

  describe('blob path', () => {
    it('rejects a blob whose path is not safe with a 403', async () => {
      await expectRejected(downloadRequest({ blob: 'cnt:card-1:..' }), 403, 'Access denied: invalid blob path');
    });

    it('is checked after the MAC', async () => {
      verifyBlobMac.mockResolvedValue(false);

      await expectRejected(downloadRequest({ blob: 'eml:email-1:..:mac-value' }), 403, 'Access denied: invalid blob');
    });
  });

  describe('an allowed request', () => {
    it.each([
      { kind: 'an email', blob: 'eml:email-1:document.pdf:mac-value', uri: '/tenants/tenant-1/accounts/account-1/emails/email-1/document.pdf' },
      { kind: 'a contact', blob: 'cnt:card-1:photo.jpg', uri: '/tenants/tenant-1/accounts/account-1/contacts/card-1/photo.jpg' },
      { kind: 'a principal', blob: 'prn:principal-1:avatar.png', uri: '/tenants/tenant-1/principals/principal-1/avatar.png' },
    ])('is rewritten to the S3 key of $kind blob under the session tenant, without the MAC', async ({ blob, uri }) => {
      const request = downloadRequest({ blob });

      const answer = await authorizer.authorize(request);

      expect(answer).toBe(request);
      expect(request.uri).toBe(uri);
    });

    it('loses its query string and gains the content type and disposition headers', async () => {
      const request = downloadRequest({ type: 'application/pdf', name: 'test.pdf' });

      await authorizer.authorize(request);

      expect(request.querystring).toBeUndefined();
      expect(request.headers['x-content-type']).toEqual([{ key: 'X-Content-Type', value: 'application/pdf' }]);
      expect(request.headers['x-content-disposition']).toEqual([
        { key: 'X-Content-Disposition', value: 'attachment; filename="test.pdf"' },
      ]);
      expect(request.headers['authorization']).toBeDefined();
    });

    it('escapes double quotes in the file name', async () => {
      const request = downloadRequest({ name: 'say "hi".pdf' });

      await authorizer.authorize(request);

      expect(request.headers['x-content-disposition']?.[0].value).toBe('attachment; filename="say \\"hi\\".pdf"');
    });

    it('gains no content headers when the URL names no type or file name', async () => {
      const request = downloadRequest({ type: undefined, name: undefined });

      await authorizer.authorize(request);

      expect(request.headers['x-content-type']).toBeUndefined();
      expect(request.headers['x-content-disposition']).toBeUndefined();
    });

    it('writes no error and does not flush the log', async () => {
      await authorizer.authorize(downloadRequest());

      expect(consoleError).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
    });
  });

  describe('a refused request', () => {
    it('writes no error and does not flush the log, because a denial is an expected answer', async () => {
      verifySessionToken.mockResolvedValue(null);

      await expect(authorizer.authorize(downloadRequest())).rejects.toBeInstanceOf(BlobRequestRejected);

      expect(consoleError).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
    });
  });

  describe('answerFailure', () => {
    it('answers a rejection with its own status and message', () => {
      expect(authorizer.answerFailure(new BlobRequestRejected(403, 'Access denied: invalid blob'))).toEqual(errorResponse(403, 'Access denied: invalid blob'));
      expect(consoleError).not.toHaveBeenCalled();
    });

    it.each([
      { failure: 'an unexpected error', thrown: new Error('socket hang up') },
      { failure: 'an expected failure that is not a rejection', thrown: new ExpectedFailure('Malformed CloudFront event: bad') },
    ])('answers $failure with a generic 500 and writes it as an error', ({ thrown }) => {
      const mentionsThrown: unknown = expect.stringContaining(thrown.message);

      expect(authorizer.answerFailure(thrown)).toEqual(errorResponse(500, 'Internal server error'));
      expect(consoleError).toHaveBeenCalledWith('Authorization error', { error: mentionsThrown });
    });
  });
});
