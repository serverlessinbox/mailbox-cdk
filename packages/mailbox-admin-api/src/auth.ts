import { ForbiddenError }             from './errors';
import type { ApiGatewayV2EventLike } from './types';

export type AdminAuthType = 'anonymous' | 'authenticated';

export type AdminAuthContext = {
  authType: AdminAuthType;
  sub?: string;
  iss?: string;
  email?: string;
  username?: string;
  groups: string[];
  isAdmin: boolean;
  roles: string[];
  scopes: string[];
  /** Tenant ID from the authorizer's Lambda-authorizer context. Never resolved, defaulted, or
   *  guessed here — absent if the authorizer did not supply one. */
  tenantId?: string;

  /** Raw authorizer context payload for debugging/extensibility */
  raw: Record<string, unknown>;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {return {};}
  return value as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {return value;}
  }
  return undefined;
}

function pickStringFromNested(obj: Record<string, unknown>, keys: string[], nestedKeys: string[]): string | undefined {
  const nested = nestedKeys
    .map((k) => obj[k])
    .find((v) => v && typeof v === 'object' && !Array.isArray(v));
  return pickString(toRecord(nested), keys);
}

function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {return [];}
  if (Array.isArray(value)) {return value.filter((v) => typeof v === 'string') as string[];}
  if (typeof value === 'string') {
    // Allow comma-separated or JSON-ish single strings.
    const trimmed = value.trim();
    if (!trimmed) {return [];}
    if (trimmed.includes(',')) {return trimmed.split(',').map((s) => s.trim()).filter(Boolean);}
    return [trimmed];
  }
  return [];
}

function toScopes(value: unknown): string[] {
  if (Array.isArray(value)) {return value.filter((v) => typeof v === 'string') as string[];}
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export type ExtractAuthOptions = {
  /** Group/role name that grants admin privileges (default: 'admin'). */
  adminGroupName?: string;

  /** Group names that map to admin role (preferred; overrides adminGroupName when provided). */
  adminGroups?: string[];

  /** Group names that map to user role. */
  userGroups?: string[];

  /** If true, require `sub` when authType=authenticated (default: true). */
  requireSub?: boolean;
};

/**
 * Extracts auth context from the Lambda authorizer output.
 *
 * Expected keys (with common variants):
 * - authType (auth_type/authtype)
 * - sub (required for authenticated)
 * - iss
 * - email (optional)
 * - username OR cognito:username OR preferred_username (fallback email -> sub)
 * - cognito:groups OR groups OR roles (derive isAdmin)
 * - scope OR scopes
 */
export function extractAdminAuthContext(event: ApiGatewayV2EventLike, options?: ExtractAuthOptions): AdminAuthContext {
  const adminGroupName = (options?.adminGroupName ?? 'admin').toLowerCase();
  const requireSub     = options?.requireSub ?? true;

  const requestContext = event.requestContext as any;
  const rawAuthorizer  = (requestContext?.authorizer?.lambda ?? {}) as unknown;
  const raw            = toRecord(rawAuthorizer);

  const authTypeRaw =
    pickString(raw, ['authType', 'auth_type', 'authtype']) ??
    pickStringFromNested(raw, ['authType', 'auth_type', 'authtype'], ['auth', 'authContext', 'auth_context']);

  const sub =
    pickString(raw, ['sub']) ??
    pickStringFromNested(raw, ['sub'], ['claims', 'jwt', 'jwtClaims', 'jwt_claims']);

  const authType: AdminAuthType =
    (authTypeRaw && authTypeRaw.toLowerCase() === 'anonymous') || !sub ? 'anonymous' : 'authenticated';

  if (authType === 'authenticated' && requireSub && !sub) {
    throw new ForbiddenError('Missing subject (sub) in authorizer context');
  }

  const iss =
    pickString(raw, ['iss']) ??
    pickStringFromNested(raw, ['iss'], ['claims', 'jwt', 'jwtClaims', 'jwt_claims']);

  const email =
    pickString(raw, ['email']) ??
    pickStringFromNested(raw, ['email'], ['claims', 'jwt', 'jwtClaims', 'jwt_claims']);

  const username =
    pickString(raw, ['username', 'userName', 'user_name']) ??
    pickString(raw, ['cognito:username', 'preferred_username']) ??
    pickStringFromNested(raw, ['username', 'cognito:username', 'preferred_username'], ['claims', 'jwt', 'jwtClaims', 'jwt_claims']) ??
    email ??
    sub;

  const groups = [
    ...toStringArray(raw['cognito:groups']),
    ...toStringArray(raw['groups']),
    ...toStringArray(raw['roles']),
  ].filter(Boolean);

  const normalizedGroups      = groups.map((g) => g.toLowerCase());
  const configuredAdminGroups = (options?.adminGroups ?? []).map((g) => g.toLowerCase()).filter(Boolean);
  const configuredUserGroups  = (options?.userGroups ?? []).map((g) => g.toLowerCase()).filter(Boolean);

  const isAdmin = configuredAdminGroups.length > 0
    ? configuredAdminGroups.some((g) => normalizedGroups.includes(g))
    : normalizedGroups.includes(adminGroupName);

  const roles: string[] = [];
  if (isAdmin) {roles.push('admin');}
  if (configuredUserGroups.length > 0) {
    if (configuredUserGroups.some((g) => normalizedGroups.includes(g))) {
      roles.push('user');
    }
  } else {
    // Best-effort: if authenticated and not admin, still treat as user.
    if (authType === 'authenticated') {roles.push('user');}
  }

  const scopes = [
    ...toScopes(raw['scope']),
    ...toScopes(raw['scopes']),
  ].filter(Boolean);

  const tenantId = pickString(raw, ['tenantId']);

  return {
    authType,
    sub,
    iss,
    email,
    username,
    groups,
    isAdmin,
    roles,
    scopes,
    tenantId,
    raw,
  };
}
