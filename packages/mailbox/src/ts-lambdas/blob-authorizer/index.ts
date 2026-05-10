import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { extractConfig } from './config';
import { verifyToken, extractToken } from './jwt';
import { getEmail, getContactCard, getPrincipal } from './dynamodb';
import {
  createErrorResponse,
  extractDownloadParams,
  parseBlobId,
  constructS3Key,
  addDownloadHeaders
} from './utils';

/**
 * Lambda@Edge function to authorize blob downloads (JMAP spec compliant)
 * 
 * Configuration is passed via custom origin headers:
 * - x-table-name: DynamoDB item table name
 * - x-jwk-cache-table: DynamoDB JWK cache table name  
 * - x-region: AWS region for DynamoDB
 * - Uses the token's `iss` claim and resolves issuer->tenant via config table
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

    // Initialize DynamoDB client
    const dynamodb = new DynamoDBClient({ region: config.region });

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

    // Verify JWT first to get tenantId, then query the entity with the correct tenant-scoped key
    const userContext = await verifyToken(token, dynamodb, config.jwkCacheTable, config.configTable, config.jwtAlgorithms, config.authPolicyName);

    // Verify JWT token is valid
    if (!userContext) {
      return createErrorResponse(401, 'Invalid token');
    }

    // Verify user has access to requested account
    if (!userContext.accountIds.includes(params.accountId)) {
      return createErrorResponse(403, 'Access denied: account not authorized');
    }

    // Resolve entity, verify ownership, and derive S3 key based on blob type.
    let s3Key: string;

    if (parsed.type === 'email') {
      const email = await getEmail(parsed.entityId, userContext.tenantId, dynamodb, config.tableName);
      if (!email) {
        return createErrorResponse(404, 'Email not found');
      }
      if (email.accountId !== params.accountId) {
        return createErrorResponse(403, 'Access denied: email does not belong to requested account');
      }
      s3Key = constructS3Key(userContext.tenantId, email.accountId, parsed);

    } else if (parsed.type === 'contact') {
      const contact = await getContactCard(parsed.entityId, userContext.tenantId, dynamodb, config.tableName);
      if (!contact) {
        return createErrorResponse(404, 'Contact not found');
      }
      if (contact.accountId !== params.accountId) {
        return createErrorResponse(403, 'Access denied: contact does not belong to requested account');
      }
      s3Key = constructS3Key(userContext.tenantId, contact.accountId, parsed);

    } else {
      // principal
      const principal = await getPrincipal(parsed.entityId, userContext.tenantId, dynamodb, config.tableName);
      if (!principal) {
        return createErrorResponse(404, 'Principal not found');
      }
      if (principal.primaryAccountId !== params.accountId) {
        return createErrorResponse(403, 'Access denied: principal does not belong to requested account');
      }
      s3Key = constructS3Key(userContext.tenantId, principal.primaryAccountId, parsed);
    }

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
