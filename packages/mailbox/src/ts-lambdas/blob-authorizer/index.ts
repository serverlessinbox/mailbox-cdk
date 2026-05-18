import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as crypto from 'crypto';
import { extractConfig } from './config';
import { verifyJWTSignatureOnly, extractToken } from './jwt';
import {
  createErrorResponse,
  extractDownloadParams,
  parseBlobId,
  constructS3Key,
  addDownloadHeaders
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
 * Verify an HMAC auth token and return the decoded payload, or null if invalid.
 * Token format: base64RawURL(payload) + "." + base64RawURL(HMAC-SHA256(key, payload))
 * Payload: "{tenantId}|{issuer}|{audience}|{sortedAccounts,comma,joined}"
 */
function verifyBlobAuthToken(
  token: string,
  secret: string,
): { tenantId: string; accountIds: string[]; issuer: string; audience: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  let payloadStr: string;
  try {
    payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadStr).digest();
  if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
    return null;
  }

  const firstPipe = payloadStr.indexOf('|');
  if (firstPipe === -1) return null;
  const tenantId = payloadStr.substring(0, firstPipe);
  const afterTenant = payloadStr.substring(firstPipe + 1);
  const secondPipe = afterTenant.indexOf('|');
  if (secondPipe === -1) return null;
  const issuer = afterTenant.substring(0, secondPipe);
  const afterIssuer = afterTenant.substring(secondPipe + 1);
  const thirdPipe = afterIssuer.indexOf('|');
  if (thirdPipe === -1) return null;
  const audience = afterIssuer.substring(0, thirdPipe);
  const accountsStr = afterIssuer.substring(thirdPipe + 1);
  const accountIds = accountsStr ? accountsStr.split(',').filter(Boolean) : [];
  if (!tenantId) return null;
  return { tenantId, accountIds, issuer, audience };
}

/**
 * Lambda@Edge function to authorize blob downloads (JMAP spec compliant)
 * 
 * Configuration is passed via custom origin headers:
 * - x-jwk-cache-table: DynamoDB JWK cache table name
 * - x-region: AWS region for DynamoDB
 * - x-hmac-secret: HMAC signing key for auth token verification
 * 
 * JMAP Download URL format (RFC 8620):
 * GET /download?accountId={accountId}&blobId={blobId}&type={type}&name={name}
 * Authorization: Bearer <JWT token>
 * 
 * Flow:
 * 1. Extract JMAP download parameters (accountId, blobId, type, name)
 * 2. Parse blobId to get emailID and path
 * 3. Verify JWT token and extract user context (userId, accountIds)
 * 4. Verify requested accountId is in user's allowed accountIds
 * 5. Query DynamoDB to get email entity
 * 6. Verify email's accountId matches requested accountId
 * 7. Construct S3 key and add content headers
 * 8. Forward request to S3 origin
 */
export const handler = async (event: any) => {
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
    const config = extractConfig(request);
    if (!config) {
      return createErrorResponse(500, 'Configuration error');
    }

    const dynamodb = getDynamoDBClient(config.region);

    // Extract and validate JMAP download parameters
    const queryString = request.querystring || '';
    const params = extractDownloadParams(queryString);
    if (!params) {
      return createErrorResponse(400, 'Missing required parameters: accountId and blobId');
    }

    // Parse blob ID
    const parsed = parseBlobId(params.blobId);
    if (!parsed) {
      return createErrorResponse(400, 'Invalid blobId format');
    }

    // Extract JWT token
    const authHeader = request.headers.authorization?.[0]?.value;
    const token = extractToken(authHeader);
    if (!token) {
      return createErrorResponse(401, 'Missing or invalid Authorization header');
    }

    const urlParams = new URLSearchParams(queryString);
    const authToken = urlParams.get('auth');
    if (!authToken || !config.hmacSecret) {
      return createErrorResponse(401, 'Unauthorized');
    }

    const jwtResult = await verifyJWTSignatureOnly(
      token, dynamodb, config.jwkCacheTable, config.jwtAlgorithms,
    );
    if (!jwtResult) {
      return createErrorResponse(401, 'Unauthorized');
    }

    const hmacPayload = verifyBlobAuthToken(authToken, config.hmacSecret);
    if (!hmacPayload) {
      return createErrorResponse(403, 'Access denied: invalid auth token');
    }

    if (parsed.type !== 'principal' && !hmacPayload.accountIds.includes(params.accountId)) {
      return createErrorResponse(403, 'Access denied: account not authorized');
    }

    if (jwtResult.issuer && hmacPayload.issuer !== jwtResult.issuer) {
      return createErrorResponse(403, 'Access denied: issuer mismatch');
    }
    if (jwtResult.audience && hmacPayload.audience !== jwtResult.audience) {
      return createErrorResponse(403, 'Access denied: audience mismatch');
    }

    const s3Key = constructS3Key(hmacPayload.tenantId, params.accountId, parsed);

    request.uri = `/${s3Key}`;
    delete request.querystring;

    // Add content type and filename headers (JMAP spec)
    addDownloadHeaders(request, params.type, params.name);

    return request;

  } catch (error) {
    console.error('Authorization error:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};
