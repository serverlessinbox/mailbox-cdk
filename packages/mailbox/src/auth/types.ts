import { SecretValue } from 'aws-cdk-lib';
import { Permission } from './jmap-scopes';
import type { AdminApiAddonProvider } from '../api/addons';

// ---- Names / keys used in the config table ----

export const DEFAULT_OIDC_PROVIDER_NAME = 'PRIMARY';

export const AUTH_POLICY_ADMIN_API = 'ADMIN_API' as const;
export const AUTH_POLICY_JMAP_API = 'JMAP_API' as const;
export type AuthPolicyName = typeof AUTH_POLICY_ADMIN_API | typeof AUTH_POLICY_JMAP_API;

export const OAUTH_CLIENT_ADMIN_UI = 'ADMIN_UI' as const;
export const OAUTH_CLIENT_JMAP_UI = 'JMAP_UI' as const;

export type OAuthClientName =
  | typeof OAUTH_CLIENT_ADMIN_UI
  | typeof OAUTH_CLIENT_JMAP_UI;

export type AuthMethod = 'header' | 'form';

/** OIDC provider configuration needed by the token exchange + UI flows. */
export interface OidcProviderConfig {
  tokenEndpoint: string;
  authorizationEndpoint: string;
  authMethod: AuthMethod;
  usePkce: boolean;
}

/** Policy configuration for authorizers (audiences + optional group requirement). */
export interface AuthPolicyConfig {
  audiences: string[];
  /** Require membership in ANY of these groups/roles. Empty/undefined means no restriction. */
  requireAnyOfGroups?: string[];

  /** Require ALL of these OAuth scopes. Empty/undefined means no scope restriction. */
  requireAllScopes?: string[];
}

export interface AuthPoliciesConfig {
  adminApi?: AuthPolicyConfig;
  jmapApi?: AuthPolicyConfig;
}

/** Concrete, policy-split auth configuration used by mailbox components. */
export type MailboxAuthPolicies = {
  adminApi: AuthPolicyConfig;
  jmapApi: AuthPolicyConfig;
};

/** Shared OAuth client credentials (clientId + optional secret). */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: SecretValue;
}

export type OAuthFlow = 'authorization_code' | 'client_credentials';

/**
 * OAuth client config to bootstrap into the config table.
 *
 * Note: `requestedAudience` is optional; when omitted, we default to `clientId`.
 * Some providers treat audience and clientId as the same concept, while others don't.
 */
export interface OAuthAuthorizationCodeClientConfig extends OAuthClientCredentials {
  flow: 'authorization_code';
  requestedAudience?: string;
  scopes: string[];
  redirectUri: string;
}

export interface OAuthClientCredentialsClientConfig extends OAuthClientCredentials {
  flow: 'client_credentials';
  requestedAudience?: string;
  scopes: string[];
}

export type OAuthClientConfig = OAuthAuthorizationCodeClientConfig | OAuthClientCredentialsClientConfig;

export interface OAuthClientsConfig {
  adminUi?: OAuthAuthorizationCodeClientConfig;
  jmapUi?: OAuthAuthorizationCodeClientConfig;
}

// ---- Provider/construct-level auth config (replaces IAuthConfig.ts) ----

export type GenerateClientParams =
  | {
    flow: 'authorization_code';
    name: string;
    groups?: string[];
    permissions: Permission[];
    callbackUrls: string[];
    logoutUrls: string[];
  }
  | {
    flow: 'client_credentials';
    name: string;
    groups?: string[];
    permissions: Permission[];
  };

/**
 * Result of generating/providing an OAuth client for mailbox usage.
 * Used by constructs to pass a concrete clientId (+ optional secret) and the scopes/groups it should request.
 */
export interface AuthClientConfig extends OAuthClientCredentials {
  readonly requestScopeList: string[];
  readonly groups: string[];
}

/**
 * Auth provider contract expected by the top-level Mailbox construct.
 *
 * Key properties:
 * - `policies` explicitly separates Admin vs JMAP audiences.
 * - UI OAuth clients are provisioned only when the corresponding UI is created,
 *   because callback/logout URLs are not known up-front.
 */
export interface MailboxAuthProviderBase {
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: AuthMethod;
  readonly usePkce: boolean;
  readonly scopeMap: { [key: string]: Permission[] };

  /** Policy configuration consumed by authorizers (audiences + optional group requirement). */
  readonly policies: MailboxAuthPolicies;

  /** Provision the OAuth client used by the Admin UI (authorization_code). */
  provisionAdminUiClient(params: { callbackUrls: string[]; logoutUrls: string[] }): AuthClientConfig;

  /** Provision the OAuth client used by the Webmail/JMAP UI (authorization_code). */
  provisionJmapUiClient(params: { callbackUrls: string[]; logoutUrls: string[]; permissions: Permission[] }): AuthClientConfig;
}

/** Optional hook for providers to supply Admin UI runtime config (written to `/config/config.json`). */
export interface AdminUiConfigProvider {
  getAdminUiConfig(): Record<string, unknown>;
}

/** Standard roles understood by mailbox components. */
export type MailboxRole = 'admin' | 'user';

/** Provider-supplied mapping from IdP concepts (typically groups) to mailbox roles. */
export type MailboxAuthorizationConfig = {
  adminGroups: string[];
  userGroups: string[];
};

/** Optional hook for providers to publish an authorization mapping (e.g. which groups grant admin). */
export interface MailboxAuthorizationConfigProvider {
  getAuthorizationConfig(): MailboxAuthorizationConfig;
}

/**
 * Auth provider contract expected by the top-level Mailbox construct.
 *
 * Implementations are typically provider-owned CDK constructs (e.g. Cognito's `MailboxUserPool`).
 * They can optionally supply Admin API addons (provider-specific admin endpoints).
 */
export type MailboxAuthProvider = MailboxAuthProviderBase & Partial<
  AdminApiAddonProvider &
  AdminUiConfigProvider &
  MailboxAuthorizationConfigProvider
>;
