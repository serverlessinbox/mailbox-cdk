import * as t                         from 'typanion';

import type { ApiGatewayV2EventLike } from './api-gateway';
import { ForbiddenError }             from './errors';

export type AdminAuthType = 'anonymous' | 'authenticated';

/** Who a request comes from, as read from the Lambda authorizer output. */
export type AdminAuthContext = {
  authType:  AdminAuthType;
  sub?:      string;
  iss?:      string;
  email?:    string;
  username?: string;
  groups:    string[];
  isAdmin:   boolean;
  roles:     string[];
  scopes:    string[];
  /** Tenant ID from the authorizer's Lambda-authorizer context. Never resolved, defaulted, or
   *  guessed here — absent if the authorizer did not supply one. */
  tenantId?: string;

  /** Raw authorizer context payload for debugging/extensibility */
  raw: Record<string, unknown>;
};

/** How the groups of a caller map to roles, and whether a subject is mandatory. */
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

/** The authorizer output, an object with keys we do not define; its values are read key by key and stay untyped. */
const isAuthorizerPayload = t.isRecord(t.isUnknown());

/** Keys under which an authorizer nests the token claims. */
const CLAIM_CONTAINERS = ['claims', 'jwt', 'jwtClaims', 'jwt_claims'];

/** Keys under which an authorizer nests its auth fields. */
const AUTH_CONTAINERS = ['auth', 'authContext', 'auth_context'];

/**
 * Extracts the auth context from the Lambda authorizer output.
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
export class AdminAuthExtractor {
  private readonly adminGroupName: string;
  private readonly requireSub: boolean;
  private readonly configuredAdminGroups: string[];
  private readonly configuredUserGroups: string[];

  constructor(options: ExtractAuthOptions = {}) {
    this.adminGroupName        = (options.adminGroupName ?? 'admin').toLowerCase();
    this.requireSub            = options.requireSub ?? true;
    this.configuredAdminGroups = (options.adminGroups ?? []).map((g) => g.toLowerCase()).filter(Boolean);
    this.configuredUserGroups  = (options.userGroups ?? []).map((g) => g.toLowerCase()).filter(Boolean);
  }

  public extract(event: ApiGatewayV2EventLike): AdminAuthContext {
    const raw = this.toRecord(event.requestContext?.authorizer?.lambda ?? {});
    const sub = this.pickClaim(raw, ['sub']);

    const authType = this.authTypeOf(raw, sub);
    if (authType === 'authenticated' && this.requireSub && !sub) {
      throw new ForbiddenError('Missing subject (sub) in authorizer context');
    }

    const email   = this.pickClaim(raw, ['email']);
    const groups  = this.groupsOf(raw);
    const isAdmin = this.isAdminOf(groups);

    return {
      authType,
      sub,
      iss: this.pickClaim(raw, ['iss']),
      email,
      username: this.usernameOf(raw, email, sub),
      groups,
      isAdmin,
      roles:    this.rolesOf(isAdmin, authType, groups),
      scopes:   this.scopesOf(raw),
      tenantId: this.pickString(raw, ['tenantId']),
      raw,
    };
  }

  private authTypeOf(raw: Record<string, unknown>, sub: string | undefined): AdminAuthType {
    const authTypeKeys = ['authType', 'auth_type', 'authtype'];
    const authTypeRaw  = this.pickString(raw, authTypeKeys) ?? this.pickStringFromNested(raw, authTypeKeys, AUTH_CONTAINERS);
    const isAnonymous  = (authTypeRaw && authTypeRaw.toLowerCase() === 'anonymous') || !sub;
    return isAnonymous ? 'anonymous' : 'authenticated';
  }

  private usernameOf(raw: Record<string, unknown>, email: string | undefined, sub: string | undefined): string | undefined {
    return this.pickString(raw, ['username', 'userName', 'user_name']) ??
      this.pickString(raw, ['cognito:username', 'preferred_username']) ??
      this.pickStringFromNested(raw, ['username', 'cognito:username', 'preferred_username'], CLAIM_CONTAINERS) ??
      email ??
      sub;
  }

  private groupsOf(raw: Record<string, unknown>): string[] {
    return [
      ...this.toStringArray(raw['cognito:groups']),
      ...this.toStringArray(raw['groups']),
      ...this.toStringArray(raw['roles']),
    ].filter(Boolean);
  }

  private isAdminOf(groups: string[]): boolean {
    const normalizedGroups = groups.map((g) => g.toLowerCase());
    return this.configuredAdminGroups.length > 0
      ? this.configuredAdminGroups.some((g) => normalizedGroups.includes(g))
      : normalizedGroups.includes(this.adminGroupName);
  }

  private rolesOf(isAdmin: boolean, authType: AdminAuthType, groups: string[]): string[] {
    const normalizedGroups = groups.map((g) => g.toLowerCase());
    const roles: string[]  = [];
    if (isAdmin) {roles.push('admin');}

    if (this.configuredUserGroups.length > 0) {
      if (this.configuredUserGroups.some((g) => normalizedGroups.includes(g))) {
        roles.push('user');
      }
    } else if (authType === 'authenticated') {
      // Without configured user groups, every authenticated caller counts as a user, admin or not.
      roles.push('user');
    }
    return roles;
  }

  private scopesOf(raw: Record<string, unknown>): string[] {
    return [
      ...this.toScopes(raw['scope']),
      ...this.toScopes(raw['scopes']),
    ].filter(Boolean);
  }

  private pickClaim(raw: Record<string, unknown>, keys: string[]): string | undefined {
    return this.pickString(raw, keys) ?? this.pickStringFromNested(raw, keys, CLAIM_CONTAINERS);
  }

  private pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.length > 0) {return value;}
    }
    return undefined;
  }

  /** Looks the keys up in the first nested object found under one of the container keys. */
  private pickStringFromNested(obj: Record<string, unknown>, keys: string[], nestedKeys: string[]): string | undefined {
    const nested = nestedKeys
      .map((k) => obj[k])
      .find((v) => v && typeof v === 'object' && !Array.isArray(v));
    return this.pickString(this.toRecord(nested), keys);
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return !Array.isArray(value) && isAuthorizerPayload(value) ? value : {};
  }

  /** An array keeps its string items; a string is one value, or a comma-separated list; anything else is empty. */
  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {return this.stringItems(value);}
    if (typeof value !== 'string') {return [];}

    const trimmed = value.trim();
    if (!trimmed) {return [];}
    if (trimmed.includes(',')) {return trimmed.split(',').map((s) => s.trim()).filter(Boolean);}
    return [trimmed];
  }

  /** An array keeps its string items; a string is split on whitespace and commas; anything else is empty. */
  private toScopes(value: unknown): string[] {
    if (Array.isArray(value)) {return this.stringItems(value);}
    if (typeof value !== 'string') {return [];}

    return value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private stringItems(items: readonly unknown[]): string[] {
    const strings: string[] = [];
    for (const item of items) {
      if (typeof item === 'string') {strings.push(item);}
    }
    return strings;
  }
}
