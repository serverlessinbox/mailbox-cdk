/**
 * Pins every decision the JMAP blob download function makes about a download request: each denial with its status and
 * answer, in the order the checks run, and each allowed blob type with the S3 key and headers it is rewritten
 * to. The verifiers are faked at their entry points, because their own suites pin the cryptography; what is
 * pinned here is what the authorizer asks them and what it does with their answers. A check that stopped
 * denying would serve a blob to a caller who must not read it, and a denial written at error level would put
 * every refused request in the log.
 */

import { DynamoDBClient }                     from '@aws-sdk/client-dynamodb';
import { ExpectedFailure, LoggerBuffer }      from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { HmacTokenPayload, VerifiedJwt } from '../verifiers/auth-tokens';
import { BlobDownloadAuthorizer }             from '../blob-download-authorizer';
import { BlobRequestRejected }                from '../blob-id/blob-request-rejected';
import type { CloudFrontRequest }             from '../cloudfront/cloudfront-event';
import type { CloudFrontResponse }            from '../cloudfront/cloudfront-responses';
import { HmacVerifier }                       from '../verifiers/hmac-verifier';
import { JwtVerifier }                        from '../verifiers/jwt-verifier';

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
const SESSION: HmacTokenPayload = { tenantId: TENANT_ID, issuer: ISSUER, audience: AUDIENCE, accountIds: [ACCOUNT_ID] };

interface DownloadOptions {
  readonly blob?: string;
  readonly accountId?: string | undefined;
  readonly type?: string | undefined;
  readonly name?: string | undefined;
  readonly auth?: string | undefined;
  readonly blobId?: string | undefined;
  readonly request?: OriginRequestOptions;
}

function downloadRequest(options: DownloadOptions = {}): CloudFrontRequest {
  const has = (key: keyof DownloadOptions): boolean => key in options;
  return originRequestOf({
    querystring: downloadQuery({
      accountId: has('accountId') ? options.accountId : 'account-1',
      blobId: has('blobId') ? options.blobId : encodedBlobIdOf(options.blob ?? 'eml:email-1:document.pdf:mac-value'),
      type: has('type') ? options.type : 'application/pdf',
      name: has('name') ? options.name : 'test.pdf',
      auth: has('auth') ? options.auth : 'session-token',
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
    it('is answered with the request origin, before any configuration or credential is looked at', async () => {
      const request = originRequestOf({ method: 'OPTIONS', origin: 'https://webmail.example.com', customHeaders: null, authorization: null });

      const answer = await authorizer.authorize(request) as CloudFrontResponse;

      expect(answer.status).toBe('200');
      expect(answer.headers['access-control-allow-origin']).toEqual([
        { key: 'Access-Control-Allow-Origin', value: 'https://webmail.example.com' },
      ]);
      expect(verifiersFor).not.toHaveBeenCalled();
    });

    it('allows any origin when the request names none', async () => {
      const answer = await authorizer.authorize(originRequestOf({ method: 'OPTIONS' })) as CloudFrontResponse;

      expect(answer.headers['access-control-allow-origin']).toEqual([{ key: 'Access-Control-Allow-Origin', value: '*' }]);
    });
  });

  describe('configuration', () => {
    it('rejects with a 500 that names the broken header and writes the same text as an error', async () => {
      const request = downloadRequest({ request: { customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE } } });

      await expectRejected(request, 500, 'Configuration error: header x-region is missing or empty');

      expect(consoleError).toHaveBeenCalledWith('Configuration error: header x-region is missing or empty');
    });

    it('takes the verifiers of the region the configuration names', async () => {
      await authorizer.authorize(downloadRequest({ request: { customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': 'ap-south-1' } } }));

      expect(verifiersFor).toHaveBeenCalledWith('ap-south-1');
    });
  });

  describe('download parameters', () => {
    it.each([
      ['accountId', { accountId: undefined }],
      ['blobId', { blobId: undefined }],
    ])('rejects a request without %s with a 400', async (_name, missing) => {
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
      ['no Authorization header', null],
      ['a scheme other than Bearer', 'Basic dXNlcjpwYXNz'],
      ['a Bearer scheme without a token', 'Bearer '],
      ['a lone Bearer word', 'Bearer'],
      ['more than one token', 'Bearer one two'],
    ])('rejects %s with a 401', async (_name, authorization) => {
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
      ['an email', 'eml:email-1:document.pdf:mac-value'],
      ['a contact', 'cnt:card-1:photo.jpg'],
    ])('rejects %s blob of an account the session does not list with a 403', async (_name, blob) => {
      await expectRejected(downloadRequest({ blob, accountId: 'account-2' }), 403, 'Access denied: account not authorized');
    });

    it('serves a principal blob whatever account the request names', async () => {
      const answer = await authorizer.authorize(downloadRequest({ blob: 'prn:principal-1:avatar.png', accountId: 'account-2' })) as CloudFrontRequest;

      expect(answer.uri).toBe('/tenants/tenant-1/principals/principal-1/avatar.png');
    });
  });

  describe('identity agreement between JWT and session', () => {
    it('rejects a session issued for another issuer with a 403', async () => {
      verifySessionToken.mockResolvedValue({ ...SESSION, issuer: ANOTHER_ISSUER });

      await expectRejected(downloadRequest(), 403, 'Access denied: issuer mismatch');
    });

    it('rejects a session issued for another audience with a 403', async () => {
      verifySessionToken.mockResolvedValue({ ...SESSION, audience: ANOTHER_AUDIENCE });

      await expectRejected(downloadRequest(), 403, 'Access denied: audience mismatch');
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
    it.each([
      ['an email', 'eml:email-1:../../etc/passwd:mac-value'],
      ['a contact', 'cnt:card-1:..'],
      ['a principal', 'prn:principal-1:a\\b'],
    ])('rejects %s blob whose path leaves its prefix with a 403', async (_name, blob) => {
      await expectRejected(downloadRequest({ blob }), 403, 'Access denied: invalid blob path');
    });

    it('is checked after the MAC', async () => {
      verifyBlobMac.mockResolvedValue(false);

      await expectRejected(downloadRequest({ blob: 'eml:email-1:..:mac-value' }), 403, 'Access denied: invalid blob');
    });
  });

  describe('an allowed request', () => {
    it.each([
      ['an email', 'eml:email-1:document.pdf:mac-value', '/tenants/tenant-1/accounts/account-1/emails/email-1/document.pdf'],
      ['a contact', 'cnt:card-1:photo.jpg', '/tenants/tenant-1/accounts/account-1/contacts/card-1/photo.jpg'],
      ['a principal', 'prn:principal-1:avatar.png', '/tenants/tenant-1/principals/principal-1/avatar.png'],
    ])('is rewritten to the S3 key of %s blob under the session tenant, without the MAC', async (_name, blob, uri) => {
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
      expect(authorizer.answerFailure(new BlobRequestRejected(403, 'Access denied: invalid blob'))).toMatchObject({
        status: '403',
        statusDescription: 'Access denied: invalid blob',
        body: '{"error":"Access denied: invalid blob"}',
      });
      expect(consoleError).not.toHaveBeenCalled();
    });

    it.each([
      ['an unexpected error', new Error('socket hang up')],
      ['an expected failure that is not a rejection', new ExpectedFailure('Malformed CloudFront event: bad')],
    ])('answers %s with a generic 500 and writes it as an error', (_name, thrown) => {
      expect(authorizer.answerFailure(thrown)).toMatchObject({ status: '500', statusDescription: 'Internal server error' });
      expect(consoleError).toHaveBeenCalledWith('Authorization error', { error: expect.stringContaining(thrown.message) });
    });
  });
});
