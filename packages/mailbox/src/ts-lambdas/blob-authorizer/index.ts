import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { extractConfig } from './config';
import { verifyToken, extractToken } from './jwt';
import { getEmail } from './dynamodb';
import {
  createErrorResponse,
  extractDownloadParams,
  parseBlobId,
  constructS3Key,
  addDownloadHeaders
} from './utils';
import { verifyHmacTokenWithRotation } from './hmac';

/**
 * Lambda@Edge function to authorize blob downloads (JMAP spec compliant)
 * 
 * Configuration is passed via custom origin headers:
 * - x-table-name: DynamoDB item table name
 * - x-auth-key-store-table: DynamoDB auth key store table name
 * - x-region: AWS region for DynamoDB
 * - Uses the token's `iss` claim and resolves issuer->tenant via config table
 * 
 * JMAP Download URL format (RFC 8620):
 * GET /download?accountId={accountId}&blobId={blobId}&type={type}&name={name}&auth={hmac-token}
 * Authorization: Bearer <JWT token>
 * 
 * Flow:
 * 1. Extract JMAP download parameters (accountId, blobId, type, name)
 * 2. Parse blobId to get emailID and path
 * 3. Verify JWT token and extract user context (userId, accountIds)
 * 4. Verify requested accountId is in user's allowed accountIds
 * 5. Verify HMAC auth= token (tenant + account binding)
 * 6. Query DynamoDB to get email entity
 * 7. Verify email's accountId matches requested accountId
 * 8. Construct S3 key and add content headers
 * 9. Forward request to S3 origin
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

    // Initialize DynamoDB client
    const dynamodb = new DynamoDBClient({ region: config.region });

    // Extract and validate JMAP download parameters
    const queryString = request.querystring || '';
    const params = extractDownloadParams(queryString);
    if (!params) {
      return createErrorResponse(400, 'Missing required parameters: accountId and blobId');
    }

    // Extract auth= query param (HMAC blob auth token)
    const auth = new URLSearchParams(queryString).get('auth');
    if (!auth) {
      return createErrorResponse(403, 'Missing auth parameter');
    }

    // Parse blob ID
    const parsed = parseBlobId(params.blobId);
    if (!parsed) {
      return createErrorResponse(400, 'Invalid blobId format');
    }
    const { emailID, path } = parsed;

    // Extract JWT token
    const authHeader = request.headers.authorization?.[0]?.value;
    const token = extractToken(authHeader);
    if (!token) {
      return createErrorResponse(401, 'Missing or invalid Authorization header');
    }

    // Parallelize JWT verification and email query
    const [userContext, email] = await Promise.all([
      verifyToken(token, dynamodb, config.authKeyStoreTable, config.configTable, config.jwtAlgorithms, config.authPolicyName),
      getEmail(emailID, dynamodb, config.tableName),
    ]);

    // Verify JWT token is valid
    if (!userContext) {
      return createErrorResponse(401, 'Invalid token');
    }

    // Verify email exists
    if (!email) {
      return createErrorResponse(404, 'Email not found');
    }

    // Verify user has access to requested account
    if (!userContext.accountIds.includes(params.accountId)) {
      return createErrorResponse(403, 'Access denied: account not authorized');
    }

    // Verify HMAC auth= token: tenant binding and account binding
    const hmacPayload = await verifyHmacTokenWithRotation(auth, dynamodb, config.authKeyStoreTable);
    if (hmacPayload === null) {
      return createErrorResponse(403, 'Access denied: invalid auth token');
    }
    if (hmacPayload.tenantId !== userContext.tenantId) {
      return createErrorResponse(403, 'Access denied: tenant mismatch');
    }
    if (!hmacPayload.accountIds.includes(params.accountId)) {
      return createErrorResponse(403, 'Access denied: account not in auth token');
    }

    // Verify email belongs to requested account
    // (User access to account was already verified above)
    if (email.accountId !== params.accountId) {
      return createErrorResponse(403, 'Access denied: email does not belong to requested account');
    }

    // Construct S3 key and modify request
    const s3Key = constructS3Key(email.accountId, emailID, path);
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
