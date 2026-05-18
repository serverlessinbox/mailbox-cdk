import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// In-memory cache for JWKS (persists across warm Lambda invocations)
const jwksCache: Map<string, { keys: any[] }> = new Map();

type IssuerTenantConfig = {
  tenantId: string;
  issuer: string;
};

let issuerConfigCache: { value: IssuerTenantConfig; fetchedAt: number } | null = null;

type AuthPolicyConfig = {
  audiences: string[];
  requireAnyOfGroups?: string[];
  providerName?: string;
  issuer?: string;
};

let authPolicyCache: { key: string; value: AuthPolicyConfig; fetchedAt: number } | null = null;

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
  const issuerNorm = normalizeIssuer(issuer);
  if (!issuerNorm) {
    throw new Error('issuer is required');
  }

  // Return cached value if available (warm Lambda)
  const cached = jwksCache.get(issuerNorm);
  if (cached) {
    return cached;
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
  jwksCache.set(issuerNorm, jwks);

  return jwks;
}

function normalizeIssuer(issuer: string): string {
  return (issuer || '').trim().replace(/\/+$/, '');
}

function extractGroups(payload: jwt.JwtPayload): string[] {
  const raw = (payload as any)['cognito:groups'] ?? (payload as any).groups ?? (payload as any).roles;
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const v = raw.trim();
    if (!v) return [];
    // Best-effort parsing of stringified arrays like "[a, b]".
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      if (!inner) return [];
      return inner
        .split(',')
        .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    return [v];
  }
  return [];
}

function hasAnyOfRequiredGroups(payload: jwt.JwtPayload, requiredGroups?: string[]): boolean {
  const normalizedRequired = (requiredGroups ?? [])
    .map((g) => (g || '').trim().toLowerCase())
    .filter(Boolean);
  if (normalizedRequired.length === 0) {
    return true;
  }
  const groups = extractGroups(payload).map((g) => (g || '').trim().toLowerCase()).filter(Boolean);
  return normalizedRequired.some((req) => groups.includes(req));
}

function verifyAudienceLikeGoAuthorizer(payload: jwt.JwtPayload, validAudiences: string[]): boolean {
  const audiences = new Set(validAudiences.map((a) => (a || '').trim()).filter(Boolean));
  if (audiences.size === 0) {
    return false;
  }

  const clientID = (payload as any).client_id;
  if (typeof clientID === 'string' && audiences.has(clientID)) {
    return true;
  }

  const aud = (payload as any).aud;
  if (typeof aud === 'string' && audiences.has(aud)) {
    return true;
  }
  if (Array.isArray(aud)) {
    for (const item of aud) {
      if (typeof item === 'string' && audiences.has(item)) {
        return true;
      }
    }
  }

  return false;
}

async function getIssuerTenantConfig(
  dynamodb: DynamoDBClient,
  configTable: string,
  issuer: string
): Promise<IssuerTenantConfig> {
  const issuerNorm = normalizeIssuer(issuer);
  if (!issuerNorm) {
    throw new Error('issuer is required');
  }

  // Warm cache (5 minutes)
  const ttlMs = 5 * 60 * 1000;
  if (issuerConfigCache && Date.now() - issuerConfigCache.fetchedAt < ttlMs) {
    if (issuerConfigCache.value.issuer === issuerNorm) {
      return issuerConfigCache.value;
    }
  }

  const resp = await dynamodb.send(
    new GetItemCommand({
      TableName: configTable,
      Key: {
        pk: { S: 'SYSTEM#TENANTS' },
        sk: { S: `ISSUER#${issuerNorm}` },
      },
      ProjectionExpression: 'tenantId',
    })
  );

  if (!resp.Item || !resp.Item.tenantId?.S) {
    throw new Error('issuer not configured');
  }

  const tenantId = resp.Item.tenantId.S.trim();
  if (!tenantId) {
    throw new Error('invalid issuer mapping: missing tenantId');
  }

  const cfg: IssuerTenantConfig = {
    tenantId,
    issuer: issuerNorm,
  };

  issuerConfigCache = { value: cfg, fetchedAt: Date.now() };
  return cfg;
}

async function getAuthPolicyConfig(
  dynamodb: DynamoDBClient,
  configTable: string,
  policyName: string
): Promise<AuthPolicyConfig> {
  const key = (policyName || '').trim();
  if (!key) {
    throw new Error('auth policy name is required');
  }

  // Warm cache (5 minutes)
  const ttlMs = 5 * 60 * 1000;
  if (authPolicyCache && Date.now() - authPolicyCache.fetchedAt < ttlMs && authPolicyCache.key === key) {
    return authPolicyCache.value;
  }

  const policyResp = await dynamodb.send(
    new GetItemCommand({
      TableName: configTable,
      Key: {
        pk: { S: 'SYSTEM#TENANTS' },
        sk: { S: `AUTH_POLICY#${key}` },
      },
      ProjectionExpression: 'providerName, audiences, requireAnyOfGroups',
    })
  );

  if (!policyResp.Item) {
    throw new Error(`auth policy not configured: ${key}`);
  }

  const audiences: string[] = [];
  const audAttr = policyResp.Item.audiences;
  if (audAttr && 'L' in audAttr && Array.isArray(audAttr.L)) {
    for (const item of audAttr.L) {
      if (item?.S) {
        const v = item.S.trim();
        if (v) audiences.push(v);
      }
    }
  }

  const requireAnyOfGroups: string[] = [];
  const groupsAttr = policyResp.Item.requireAnyOfGroups;
  if (groupsAttr && 'L' in groupsAttr && Array.isArray(groupsAttr.L)) {
    for (const item of groupsAttr.L) {
      if (item?.S) {
        const v = item.S.trim();
        if (v) requireAnyOfGroups.push(v);
      }
    }
  }

  const providerNameRaw = policyResp.Item.providerName?.S?.trim();
  const providerName = providerNameRaw || 'PRIMARY';

  // Resolve provider issuer (optional, used for sanity checking / diagnostics)
  let providerIssuer: string | undefined;
  try {
    const providerResp = await dynamodb.send(
      new GetItemCommand({
        TableName: configTable,
        Key: {
          pk: { S: 'SYSTEM#TENANTS' },
          sk: { S: `OIDC_PROVIDER#${providerName}` },
        },
        ProjectionExpression: 'issuer',
      })
    );
    providerIssuer = normalizeIssuer(providerResp.Item?.issuer?.S || '');
    if (!providerIssuer) {
      providerIssuer = undefined;
    }
  } catch {
    providerIssuer = undefined;
  }

  const cfg: AuthPolicyConfig = {
    audiences,
    ...(requireAnyOfGroups.length > 0 ? { requireAnyOfGroups } : {}),
    providerName,
    ...(providerIssuer ? { issuer: providerIssuer } : {}),
  };

  authPolicyCache = { key, value: cfg, fetchedAt: Date.now() };
  return cfg;
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
  tenantId: string;
}

/**
 * Query IDPMapping from DynamoDB to get UserID using OIDC subject (sub)
 */
async function getIDPMapping(
  idpUserId: string,
  provider: string,
  tenantId: string,
  dynamodb: DynamoDBClient,
  configTable: string
): Promise<string | null> {
  try {
    const command = new GetItemCommand({
      TableName: configTable,
      Key: {
        pk: { S: `TENANT#${tenantId}#IDP#${provider}#${idpUserId}` },
        sk: { S: 'METADATA' },
      },
      ProjectionExpression: 'principalId',
    });

    const response = await dynamodb.send(command);

    if (!response.Item || !response.Item.principalId?.S) {
      return null;
    }

    return response.Item.principalId.S;
  } catch (error) {
    console.error('Error querying IDP mapping:', error);
    return null;
  }
}

/**
 * Query User's accounts from DynamoDB
 * Combines owned accounts (GSI1) and shared account memberships (GSI2).
 */
async function getUserAccounts(
  userId: string,
  tenantId: string,
  dynamodb: DynamoDBClient,
  configTable: string
): Promise<string[]> {
  try {
    const [ownedResponse, membershipResponse] = await Promise.all([
      // GSI1: owned accounts — gsi1pk = TENANT#{tenantId}#PRINCIPAL_ACCOUNTS#{userId}
      dynamodb.send(new QueryCommand({
        TableName: configTable,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `TENANT#${tenantId}#PRINCIPAL_ACCOUNTS#${userId}` },
        },
        ProjectionExpression: 'accountId',
      })),
      // GSI2: shared account memberships — gsi2pk = TENANT#{tenantId}#USER_ACCOUNT_MEMBERSHIPS#{userId}
      dynamodb.send(new QueryCommand({
        TableName: configTable,
        IndexName: 'gsi2',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `TENANT#${tenantId}#USER_ACCOUNT_MEMBERSHIPS#${userId}` },
        },
        ProjectionExpression: 'AccountID',
      })),
    ]);

    const accountIds: string[] = [];

    for (const item of ownedResponse.Items ?? []) {
      if (item.accountId?.S) {
        accountIds.push(item.accountId.S);
      }
    }

    for (const item of membershipResponse.Items ?? []) {
      if (item.AccountID?.S && !accountIds.includes(item.AccountID.S)) {
        accountIds.push(item.AccountID.S);
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
  jwtAlgorithms?: string[],
  authPolicyName?: string
): Promise<UserContext | null> {
  try {
    // First decode without verification to determine issuer (matches Go authorizer pattern)
    const unverified = jwt.decode(token, { complete: true });
    if (!unverified || typeof (unverified as any).payload !== 'object') {
      console.error('Invalid token: failed to decode payload');
      return null;
    }

    const unverifiedPayload = (unverified as any).payload as jwt.JwtPayload;
    const issuerFromToken = normalizeIssuer((unverifiedPayload as any).iss);
    if (!issuerFromToken) {
      console.error("Token missing required 'iss' claim");
      return null;
    }

    if (!unverified.header?.kid) {
      console.error('Invalid token: missing kid');
      return null;
    }

    // Resolve issuer -> tenant (issuer-mapping record remains the canonical allowlist)
    const issuerCfg = await getIssuerTenantConfig(dynamodb, configTable, issuerFromToken);

    // Load auth policy (required)
    const policyName = (authPolicyName || '').trim();
    if (!policyName) {
      console.error('Missing auth policy name');
      return null;
    }
    const authPolicy = await getAuthPolicyConfig(dynamodb, configTable, policyName);

    // Get signing key
    const signingKey = await getSigningKey(unverified.header.kid, dynamodb, jwkCacheTable, issuerCfg.issuer);

    const allowedAlgorithms = (jwtAlgorithms && jwtAlgorithms.length > 0) ? jwtAlgorithms : ['RS256'];

    // Verify token (allowlist) with 5 minute clock skew tolerance (matches Go authorizer)
    const verified = jwt.verify(token, signingKey, {
      algorithms: allowedAlgorithms as jwt.Algorithm[],
      issuer: issuerCfg.issuer,
      clockTolerance: 300,
    }) as jwt.JwtPayload;

    if (!verifyAudienceLikeGoAuthorizer(verified, authPolicy.audiences)) {
      console.error('Invalid client_id or audience in token');
      return null;
    }

    if (!hasAnyOfRequiredGroups(verified, authPolicy.requireAnyOfGroups)) {
      console.error('Missing required group');
      return null;
    }

    // Validate required claims
    const sub = verified.sub;
    if (!sub) {
      console.error('Token missing required sub claim');
      return null;
    }

    // Query IDPMapping to get UserID using `sub`
    const provider = 'cognito'; // Currently only supporting Cognito
    const userId = await getIDPMapping(sub, provider, issuerCfg.tenantId, dynamodb, configTable);

    if (!userId) {
      console.error('User not found in IDP mapping');
      return null;
    }

    // Query user's accounts from database
    const accountIds = await getUserAccounts(userId, issuerCfg.tenantId, dynamodb, configTable);

    return {
      userId,
      accountIds,
      tenantId: issuerCfg.tenantId,
    };
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

/**
 * Verify JWT signature and claims without performing any IDP or account DDB lookups.
 * Used in the HMAC fast path where tenant/account identity comes from the auth token.
 */
export async function verifyJWTSignatureOnly(
  token: string,
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  configTable: string,
  jwtAlgorithms?: string[],
  authPolicyName?: string,
): Promise<{ sub: string } | null> {
  try {
    const unverified = jwt.decode(token, { complete: true });
    if (!unverified || typeof unverified.payload !== 'object') return null;
    const unverifiedPayload = unverified.payload as jwt.JwtPayload;
    const issuerFromToken = normalizeIssuer(unverifiedPayload.iss ?? '');
    if (!issuerFromToken) return null;
    if (!unverified.header?.kid) return null;

    const policyName = (authPolicyName ?? '').trim();
    if (!policyName) return null;

    // Both of these are warm-cached after first cold-start
    const [signingKey, authPolicy] = await Promise.all([
      getSigningKey(unverified.header.kid, dynamodb, jwkCacheTable, issuerFromToken),
      getAuthPolicyConfig(dynamodb, configTable, policyName),
    ]);

    const allowedAlgorithms: jwt.Algorithm[] = (jwtAlgorithms && jwtAlgorithms.length > 0)
      ? jwtAlgorithms as jwt.Algorithm[]
      : ['RS256'];

    const verified = jwt.verify(token, signingKey, {
      algorithms: allowedAlgorithms,
      clockTolerance: 300,
    }) as jwt.JwtPayload;

    if (!verifyAudienceLikeGoAuthorizer(verified, authPolicy.audiences)) return null;
    if (!hasAnyOfRequiredGroups(verified, authPolicy.requireAnyOfGroups)) return null;

    const sub = verified.sub;
    if (!sub) return null;
    return { sub };
  } catch {
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
