import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// In-memory cache for JWKS (persists across warm Lambda invocations)
let jwksCache: { keys: any[] } | null = null;

interface JWK {
  kty: string;
  kid: string;
  use?: string;
  n: string;
  e: string;
  alg?: string;
}

/**
 * Convert JWK to PEM format for jsonwebtoken library
 */
function jwkToPem(jwk: JWK): string {
  // jsonwebtoken will accept the JWK directly, but we need to format it properly
  const key = crypto.createPublicKey({
    key: jwk as any,
    format: 'jwk',
  });
  
  return key.export({
    type: 'spki',
    format: 'pem',
  }) as string;
}

/**
 * Get JWKS from DynamoDB (with in-memory caching)
 */
async function getJWKS(
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  issuer: string
): Promise<{ keys: JWK[] }> {
  // Return cached value if available (warm Lambda)
  if (jwksCache) {
    return jwksCache;
  }

  // Get from DynamoDB
  const command = new GetItemCommand({
    TableName: jwkCacheTable,
    Key: {
      id: { S: issuer },
    },
  });

  const response = await dynamodb.send(command);

  if (!response.Item || !response.Item.value?.S) {
    throw new Error('JWKS not found in cache');
  }

  const jwks = JSON.parse(response.Item.value.S);
  
  // Cache for subsequent invocations
  jwksCache = jwks;
  
  return jwks;
}

/**
 * Get signing key by kid (key ID)
 */
async function getSigningKey(
  kid: string,
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  issuer: string
): Promise<string> {
  const jwks = await getJWKS(dynamodb, jwkCacheTable, issuer);
  
  const key = jwks.keys.find((k: JWK) => k.kid === kid);
  if (!key) {
    throw new Error(`Key with kid ${kid} not found in JWKS`);
  }
  
  return jwkToPem(key);
}

/**
 * User context extracted from JWT token
 */
export interface UserContext {
  userId: string;
  accountIds: string[];
}

/**
 * Extract stable identifier from JWT claims using configurable priority
 * Stable identifiers (email, username) survive IDP recreation, unlike 'sub' which changes
 * @param verified JWT claims
 * @param priorityList Priority list of claim names (e.g., "email,preferred_username,cognito:username,sub")
 * @returns Stable identifier or empty string if not found
 */
function extractStableIdentifier(verified: jwt.JwtPayload, priorityList: string): string {
  const claims = priorityList.split(',').map(c => c.trim());
  
  for (const claim of claims) {
    const value = (verified as any)[claim];
    if (value && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  
  return '';
}

/**
 * Query IDPMapping from DynamoDB to get UserID using stable identifier
 */
async function getIDPMapping(
  stableId: string,
  provider: string,
  dynamodb: DynamoDBClient,
  configTable: string
): Promise<string | null> {
  try {
    const command = new GetItemCommand({
      TableName: configTable,
      Key: {
        PK: { S: `IDP#${provider}#${stableId}` },
        SK: { S: 'METADATA' },
      },
    });

    const response = await dynamodb.send(command);

    if (!response.Item || !response.Item.userId?.S) {
      return null;
    }

    return response.Item.userId.S;
  } catch (error) {
    console.error('Error querying IDP mapping:', error);
    return null;
  }
}

/**
 * Query User's accounts from DynamoDB
 */
async function getUserAccounts(
  userId: string,
  dynamodb: DynamoDBClient,
  configTable: string
): Promise<string[]> {
  try {
    // Query GSI1 for user's accounts
    // GSI1: PK=USER_ACCOUNTS#{userId}, SK={name}#{accountId}
    const command = new QueryCommand({
      TableName: configTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER_ACCOUNTS#${userId}` },
      },
    });

    const response = await dynamodb.send(command);

    if (!response.Items) {
      return [];
    }

    // Extract account IDs from entities
    const accountIds: string[] = [];
    for (const item of response.Items) {
      if (item.accountId?.S) {
        accountIds.push(item.accountId.S);
      }
    }

    return accountIds;
  } catch (error) {
    console.error('Error querying user accounts:', error);
    return [];
  }
}

/**
 * Verify JWT token and extract user context by querying database
 */
export async function verifyToken(
  token: string,
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  configTable: string,
  issuer: string,
  stableIdPriority: string = 'email,preferred_username,cognito:username,sub'
): Promise<UserContext | null> {
  try {
    // Decode token header to get kid and algorithm
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header.kid || !decoded.header.alg) {
      console.error('Invalid token: missing kid or alg');
      return null;
    }

    // Get signing key
    const signingKey = await getSigningKey(decoded.header.kid, dynamodb, jwkCacheTable, issuer);

    // Verify token with algorithm from token header
    const verified = jwt.verify(token, signingKey, {
      algorithms: [decoded.header.alg as jwt.Algorithm],
      issuer: issuer,
    }) as jwt.JwtPayload;

    // Validate required claims
    const sub = verified.sub;
    if (!sub) {
      console.error('Token missing required sub claim');
      return null;
    }

    // Validate token_use for Cognito (should be "access" for API access)
    const tokenUse = (verified as any).token_use;
    if (tokenUse && tokenUse !== 'access') {
      console.error(`Invalid token_use: expected 'access', got '${tokenUse}'`);
      return null;
    }

    // Extract stable identifier (resilient to IDP recreation)
    const stableId = extractStableIdentifier(verified, stableIdPriority);
    if (!stableId) {
      console.error('Token missing stable identifier: could not extract from claims');
      return null;
    }

    // Query IDPMapping to get UserID using stable identifier
    const provider = 'cognito'; // Currently only supporting Cognito
    const userId = await getIDPMapping(stableId, provider, dynamodb, configTable);
    
    if (!userId) {
      console.error('User not found in IDP mapping');
      return null;
    }

    // Query user's accounts from database
    const accountIds = await getUserAccounts(userId, dynamodb, configTable);

    return {
      userId,
      accountIds,
    };
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}
