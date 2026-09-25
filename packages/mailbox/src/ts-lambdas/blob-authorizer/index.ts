import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { extractConfig } from './config';
import { verifyJWTSignatureOnly, extractToken } from './jwt';
import { verifyHmacTokenWithRotation, verifyBlobIdMacWithRotation } from './hmac';
import {
  createErrorResponse,
  extractDownloadParams,
  parseBlobId,
  constructS3Key,
  addDownloadHeaders,
  decodeBase64UrlBlobId,
  isSafeBlobPath
} from './utils';

// Module-level DynamoDB client (lazy init — region is fixed per CloudFront distribution)
let _dynamodbClient: DynamoDBClient | null = null;
function getDynamoDBClient(region: string): DynamoDBClient {
  if (!_dynamodbClient) {
    _dynamodbClient = new DynamoDBClient({ region });
  }
  return _dynamodbClient;
}

/**
 * Lambda@Edge function to authorize blob downloads (JMAP spec compliant)
 *
 * Configuration is passed via custom origin headers:
 * - x-auth-key-store-table: DynamoDB auth key store table name
 * - x-region: AWS region for DynamoDB
 *
 * JMAP Download URL format (RFC 8620):
 * GET /download?accountId={accountId}&blobId={blobId}&type={type}&name={name}
 * Authorization: Bearer <JWT token>
 * query ?auth={auth-token}
 */
export const handler = async (event: any) => {
  const logger = new LoggerBuffer();
  const request = event.Records[0].cf.request;

  // Handle OPTIONS preflight requests - bypass authentication
  if (request.method === 'OPTIONS') {
    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        'access-control-allow-origin': [{
          key: 'Access-Control-Allow-Origin',
          value: request.headers.origin?.[0]?.value || '*',
        }],
        'access-control-allow-methods': [{
          key: 'Access-Control-Allow-Methods',
          value: 'GET, HEAD, OPTIONS',
        }],
        'access-control-allow-headers': [{
          key: 'Access-Control-Allow-Headers',
          value: 'Authorization, Content-Type, Cache-Control',
        }],
        'access-control-allow-credentials': [{
          key: 'Access-Control-Allow-Credentials',
          value: 'true',
        }],
        'access-control-max-age': [{
          key: 'Access-Control-Max-Age',
          value: '3600',
        }],
      },
    };
  }

  try {
    // Extract configuration from custom headers
    logger.debug('Starting blob authorization');
    const config = extractConfig(request);
    if (!config) {
      logger.error('Configuration error: missing config');
      logger.flush();
      return createErrorResponse(500, 'Configuration error');
    }

    const dynamodb = getDynamoDBClient(config.region);

    // Extract and validate JMAP download parameters
    const queryString = request.querystring || '';
    const params = extractDownloadParams(queryString);
    if (!params) {
      logger.error('Missing required parameters: accountId and blobId');
      logger.flush();
      return createErrorResponse(400, 'Missing required parameters: accountId and blobId');
    }

    logger.debug('Download parameters extracted', { accountId: params.accountId });

    // Decode base64url-encoded blobId (RFC 8620 compliance)
    const decodedBlobId = decodeBase64UrlBlobId(params.blobId);
    if (!decodedBlobId) {
      logger.error('Invalid blobId format (decode failed)');
      logger.flush();
      return createErrorResponse(400, 'Invalid blobId format');
    }

    // Parse blob ID
    const parsed = parseBlobId(decodedBlobId);
    if (!parsed) {
      logger.error('Invalid blobId format (parse failed)');
      logger.flush();
      return createErrorResponse(400, 'Invalid blobId format');
    }

    logger.debug('Blob ID parsed', { type: parsed.type });

    // Extract JWT token
    const authHeader = request.headers.authorization?.[0]?.value;
    const token = extractToken(authHeader);
    if (!token) {
      logger.error('Missing or invalid Authorization header');
      logger.flush();
      return createErrorResponse(401, 'Missing or invalid Authorization header');
    }

    const urlParams = new URLSearchParams(queryString);
    const authToken = urlParams.get('auth');
    if (!authToken) {
      logger.error('Missing auth token in query parameters');
      logger.flush();
      return createErrorResponse(401, 'Unauthorized');
    }

    logger.debug('Verifying JWT signature');
    const jwtResult = await verifyJWTSignatureOnly(
      token, dynamodb, config.authKeyStoreTable, config.jwtAlgorithms,
    );
    if (!jwtResult) {
      logger.error('JWT signature verification failed');
      logger.flush();
      return createErrorResponse(401, 'Unauthorized');
    }

    logger.debug('JWT verified; verifying HMAC token');

    const hmacPayload = await verifyHmacTokenWithRotation(authToken, dynamodb, config.authKeyStoreTable);
    if (!hmacPayload) {
      logger.error('HMAC token verification failed');
      logger.flush();
      return createErrorResponse(403, 'Access denied: invalid auth token');
    }

    logger.debug('HMAC token verified', { authorizedAccounts: hmacPayload.accountIds.length });

    if (parsed.type !== 'principal' && !hmacPayload.accountIds.includes(params.accountId)) {
      logger.error('Access denied: account not authorized', { accountId: params.accountId });
      logger.flush();
      return createErrorResponse(403, 'Access denied: account not authorized');
    }

    if (jwtResult.issuer && hmacPayload.issuer !== jwtResult.issuer) {
      logger.error('Access denied: issuer mismatch');
      logger.flush();
      return createErrorResponse(403, 'Access denied: issuer mismatch');
    }
    if (jwtResult.audience && hmacPayload.audience !== jwtResult.audience) {
      logger.error('Access denied: audience mismatch');
      logger.flush();
      return createErrorResponse(403, 'Access denied: audience mismatch');
    }

    // Verify per-blob MAC for email blobs
    if (parsed.type === 'email') {
      if (parsed.mac === null) {
        logger.error('Access denied: email blob missing MAC');
        logger.flush();
        return createErrorResponse(403, 'Access denied: invalid blob');
      }

      const macPayload = `${hmacPayload.tenantId}|${params.accountId}|${parsed.entityId}`;
      const mac = parsed.mac;
      const macValid = await verifyBlobIdMacWithRotation(
        macPayload,
        mac,
        dynamodb,
        config.authKeyStoreTable,
      );

      if (!macValid) {
        logger.error('Access denied: blob MAC verification failed');
        logger.flush();
        return createErrorResponse(403, 'Access denied: invalid blob');
      }

      logger.debug('Blob MAC verified');
    }

    // Verify blob path is safe for all types
    if (!isSafeBlobPath(parsed.path)) {
      logger.error('Access denied: unsafe blob path');
      logger.flush();
      return createErrorResponse(403, 'Access denied: invalid blob path');
    }

    logger.debug('Blob path safety verified');

    const s3Key = constructS3Key(hmacPayload.tenantId, params.accountId, parsed);
    logger.debug('Authorization successful; constructing S3 key', { s3KeyLen: s3Key.length });

    request.uri = `/${s3Key}`;
    delete request.querystring;

    // Add content type and filename headers (JMAP spec)
    addDownloadHeaders(request, params.type, params.name);

    return request;

  } catch (error) {
    logger.error('Authorization error', {
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    logger.flush();
    return createErrorResponse(500, 'Internal server error');
  }
};
