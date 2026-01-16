import { SecretValue } from 'aws-cdk-lib';
import { Permission } from './jmap-scopes';

// ---- Names / keys used in the config table ----

export const DEFAULT_OIDC_PROVIDER_NAME = 'PRIMARY';

export const AUTH_POLICY_ADMIN_API = 'ADMIN_API' as const;
export const AUTH_POLICY_JMAP_API = 'JMAP_API' as const;
export type AuthPolicyName = typeof AUTH_POLICY_ADMIN_API | typeof AUTH_POLICY_JMAP_API;

export const OAUTH_CLIENT_ADMIN_UI = 'ADMIN_UI' as const;
export const OAUTH_CLIENT_JMAP_UI = 'JMAP_UI' as const;

// Headless (API-only) OAuth clients. These are typically confidential clients using client_credentials.
export const OAUTH_CLIENT_ADMIN_HEADLESS = 'ADMIN_HEADLESS' as const;
export const OAUTH_CLIENT_JMAP_HEADLESS = 'JMAP_HEADLESS' as const;

export type OAuthClientName =
  | typeof OAUTH_CLIENT_ADMIN_UI
  | typeof OAUTH_CLIENT_JMAP_UI
  | typeof OAUTH_CLIENT_ADMIN_HEADLESS
  | typeof OAUTH_CLIENT_JMAP_HEADLESS;

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
  requiredGroup?: string;
}

export interface AuthPoliciesConfig {
  adminApi?: AuthPolicyConfig;
  jmapApi?: AuthPolicyConfig;
}

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
 * Authentication configuration for the Mailbox construct.
 * Implemented by Cognito (`MailboxUserPool` from `@sipkg/mailbox-cognito`) and can be implemented by external IdPs.
 */
export interface AuthConfig {
  readonly issuer: string;
  readonly clientIds: string[];
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: AuthMethod;
  readonly usePkce: boolean;
  readonly scopeMap: { [key: string]: Permission[] };

  generateClient(params: GenerateClientParams): AuthClientConfig;
}
