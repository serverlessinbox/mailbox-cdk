import { CaughtError, toAccountId, type AccountId, type LoggerBuffer, type Region, type TenantId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { HmacTokenPayload, VerifiedJwt }                                                      from './verifiers/auth-tokens';
import { BlobIdFormat }                                                                            from './blob-id/blob-id-format';
import { toEncodedBlobId, type EncodedBlobId, type ParsedBlobId }                                  from './blob-id/blob-id';
import { BlobRequestRejected }                                                                     from './blob-id/blob-request-rejected';
import { firstHeaderValue, type CloudFrontRequest }                                                from './cloudfront/cloudfront-event';
import { CloudFrontResponses, type CloudFrontResponse }                                            from './cloudfront/cloudfront-responses';
import { extractConfig, type Config }                                                              from './config';
import type { Verifiers }                                                                          from './verifiers/region-bound-verifiers';

/** The JMAP download URL parameters (RFC 8620): `accountId` and `blobId` are required. */
interface DownloadParams {
  readonly accountId: AccountId;
  readonly blobId: EncodedBlobId;
  readonly type?: string;
  readonly name?: string;
}

/**
 * Decides whether a CloudFront origin request for a blob may reach the S3 origin, and rewrites an allowed
 * request to the blob's S3 key. A blob is served only to a bearer who presents a JWT that verifies, together
 * with an HMAC session token issued for the same issuer and audience that lists the requested account; an
 * email blob also needs the MAC of its id. A CORS preflight is answered without authentication. It decides on
 * the request alone and holds no state between requests; the key caches live in the verifiers it is handed.
 */
export class BlobDownloadAuthorizer {
  private readonly logger: LoggerBuffer;
  private readonly verifiersFor: (region: Region) => Verifiers;

  constructor(logger: LoggerBuffer, verifiersFor: (region: Region) => Verifiers) {
    this.logger       = logger;
    this.verifiersFor = verifiersFor;
  }

  /**
   * The request rewritten to the blob's S3 key when it is allowed, or the CORS preflight answer. A request that
   * is refused throws a `BlobRequestRejected`; a failure to reach the auth key store propagates as it is.
   */
  public async authorize(request: CloudFrontRequest): Promise<CloudFrontRequest | CloudFrontResponse> {
    if (request.method === 'OPTIONS') {
      return CloudFrontResponses.corsPreflight(firstHeaderValue(request.headers, 'origin'));
    }

    const config        = this.readConfig(request);
    const { jwt, hmac } = this.verifiersFor(config.region);

    const query        = new URLSearchParams(request.querystring || '');
    const params       = this.readDownloadParams(query);
    const blob         = this.readBlob(params.blobId);
    const jwtToken     = this.readBearerToken(request);
    const sessionToken = this.readSessionToken(query);

    const verifiedJwt = await this.verifyJwt(jwt, jwtToken, config);
    const session     = await this.verifySession(hmac, sessionToken, config);
    this.requireAccountAccess(session, params.accountId, blob);
    this.requireSameIdentity(verifiedJwt, session);
    await this.requireBlobMac(hmac, session, params.accountId, blob, config);
    this.requireSafePath(blob);

    return this.forward(request, session.tenantId, params, blob);
  }

  /**
   * The answer to a failed authorization: the rejection's own status and message, or a 500 for any other
   * failure, which is also written to the log.
   */
  public answerFailure(thrown: unknown): CloudFrontResponse {
    if (thrown instanceof BlobRequestRejected) {
      return CloudFrontResponses.error(thrown.status, thrown.message);
    }

    this.logger.error('Authorization error', { error: new CaughtError(thrown).describeWithMetadata() });
    return CloudFrontResponses.error(500, 'Internal server error');
  }

  private readConfig(request: CloudFrontRequest): Config {
    this.logger.debug('Starting blob authorization');

    const reading = extractConfig(request);
    if ('problem' in reading) {
      const answer = `Configuration error: ${reading.problem}`;
      this.logger.error(answer);
      throw new BlobRequestRejected(500, answer);
    }
    return reading.config;
  }

  private readDownloadParams(query: URLSearchParams): DownloadParams {
    const accountId = query.get('accountId');
    const blobId    = query.get('blobId');
    if (!accountId || !blobId) {
      throw this.reject(400, 'Missing required parameters: accountId and blobId');
    }

    this.logger.debug('Download parameters extracted', { accountId });
    return {
      accountId: toAccountId(accountId),
      blobId: toEncodedBlobId(blobId),
      type: query.get('type') || undefined,
      name: query.get('name') || undefined,
    };
  }

  private readBlob(encoded: EncodedBlobId): ParsedBlobId {
    const decoded = BlobIdFormat.decode(encoded);
    if (!decoded) {
      throw this.reject(400, 'Invalid blobId format', 'Invalid blobId format (decode failed)');
    }

    const blob = BlobIdFormat.parse(decoded);
    if (!blob) {
      throw this.reject(400, 'Invalid blobId format', 'Invalid blobId format (parse failed)');
    }

    this.logger.debug('Blob ID parsed', { type: blob.type });
    return blob;
  }

  private readBearerToken(request: CloudFrontRequest): string {
    const parts = (firstHeaderValue(request.headers, 'authorization') ?? '').split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      throw this.reject(401, 'Missing or invalid Authorization header');
    }
    return parts[1];
  }

  private readSessionToken(query: URLSearchParams): string {
    const sessionToken = query.get('auth');
    if (!sessionToken) {
      throw this.reject(401, 'Unauthorized', 'Missing auth token in query parameters');
    }
    return sessionToken;
  }

  private async verifyJwt(jwt: Verifiers['jwt'], token: string, config: Config): Promise<VerifiedJwt> {
    this.logger.debug('Verifying JWT signature');

    const verifiedJwt = await jwt.verifySignatureOnly(token, config.authKeyStoreTable, config.jwtAlgorithms);
    if (!verifiedJwt) {
      throw this.reject(401, 'Unauthorized', 'JWT signature verification failed');
    }
    return verifiedJwt;
  }

  private async verifySession(hmac: Verifiers['hmac'], token: string, config: Config): Promise<HmacTokenPayload> {
    this.logger.debug('JWT verified; verifying HMAC token');

    const session = await hmac.verifySessionToken(token, config.authKeyStoreTable);
    if (!session) {
      throw this.reject(403, 'Access denied: invalid auth token', 'HMAC token verification failed');
    }

    this.logger.debug('HMAC token verified', { authorizedAccounts: session.accountIds.length });
    return session;
  }

  // A principal blob belongs to the tenant, not to an account, so it needs no account in the session.
  private requireAccountAccess(session: HmacTokenPayload, accountId: AccountId, blob: ParsedBlobId): void {
    if (blob.type !== 'principal' && !session.accountIds.includes(accountId)) {
      throw this.reject(403, 'Access denied: account not authorized', undefined, { accountId });
    }
  }

  // A JWT that names no issuer or audience is not held to the session's; one that names them must agree.
  private requireSameIdentity(jwt: VerifiedJwt, session: HmacTokenPayload): void {
    if (jwt.issuer && session.issuer !== jwt.issuer) {
      throw this.reject(403, 'Access denied: issuer mismatch');
    }
    if (jwt.audience && session.audience !== jwt.audience) {
      throw this.reject(403, 'Access denied: audience mismatch');
    }
  }

  // Only an email blob id carries a MAC, over the tenant, account and email the id names.
  private async requireBlobMac(
    hmac: Verifiers['hmac'],
    session: HmacTokenPayload,
    accountId: AccountId,
    blob: ParsedBlobId,
    config: Config,
  ): Promise<void> {
    if (blob.type !== 'email') {
      return;
    }

    if (blob.mac === null) {
      throw this.reject(403, 'Access denied: invalid blob', 'Access denied: email blob missing MAC');
    }

    const macPayload = `${session.tenantId}|${accountId}|${blob.entityId}`;
    if (!(await hmac.verifyBlobMac(macPayload, blob.mac, config.authKeyStoreTable))) {
      throw this.reject(403, 'Access denied: invalid blob', 'Access denied: blob MAC verification failed');
    }

    this.logger.debug('Blob MAC verified');
  }

  private requireSafePath(blob: ParsedBlobId): void {
    if (!BlobIdFormat.isSafePath(blob.path)) {
      throw this.reject(403, 'Access denied: invalid blob path', 'Access denied: unsafe blob path');
    }

    this.logger.debug('Blob path safety verified');
  }

  private forward(
    request: CloudFrontRequest,
    tenantId: TenantId,
    params: DownloadParams,
    blob: ParsedBlobId,
  ): CloudFrontRequest {
    const s3Key = this.s3KeyOf(tenantId, params.accountId, blob);
    this.logger.debug('Authorization successful; constructing S3 key', { s3KeyLen: s3Key.length });

    request.uri = `/${s3Key}`;
    delete request.querystring;
    this.addDownloadHeaders(request, params);
    return request;
  }

  // A principal blob is keyed under the tenant only, not under an account.
  private s3KeyOf(tenantId: TenantId, accountId: AccountId, blob: ParsedBlobId): string {
    switch (blob.type) {
      case 'email':
        return `tenants/${tenantId}/accounts/${accountId}/emails/${blob.entityId}/${blob.path}`;
      case 'contact':
        return `tenants/${tenantId}/accounts/${accountId}/contacts/${blob.entityId}/${blob.path}`;
      case 'principal':
        return `tenants/${tenantId}/principals/${blob.entityId}/${blob.path}`;
    }
  }

  private addDownloadHeaders(request: CloudFrontRequest, params: DownloadParams): void {
    if (params.type) {
      request.headers['x-content-type'] = [{ key: 'X-Content-Type', value: params.type }];
    }

    if (params.name) {
      // RFC 6266 Content-Disposition for a download.
      const disposition = `attachment; filename="${params.name.replace(/"/g, '\\"')}"`;
      request.headers['x-content-disposition'] = [{ key: 'X-Content-Disposition', value: disposition }];
    }
  }

  private reject(status: number, answer: string, reason?: string, data?: Record<string, unknown>): BlobRequestRejected {
    this.logger.warn(reason ?? answer, data);
    return new BlobRequestRejected(status, answer);
  }
}
