import { SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Permission } from './jmap-scopes';
import type { AdminApiAddonContext, IAdminApiAddon } from '../api/addons';

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
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: AuthMethod;
  readonly usePkce: boolean;
}

/** Policy configuration for authorizers (audiences + optional group requirement). */
export interface AuthPolicyConfig {
  readonly audiences: string[];
  /** Require membership in ANY of these groups/roles. Empty/undefined means no restriction. */
  readonly requireAnyOfGroups?: string[];

  /** Require ALL of these OAuth scopes. Empty/undefined means no scope restriction. */
  readonly requireAllScopes?: string[];
}

export interface AuthPoliciesConfig {
  readonly adminApi?: AuthPolicyConfig;
  readonly jmapApi?: AuthPolicyConfig;
}

/** Concrete, policy-split auth configuration used by mailbox components. */
export interface MailboxAuthPolicies {
  readonly adminApi: AuthPolicyConfig;
  readonly jmapApi: AuthPolicyConfig;
}

/** Shared OAuth client credentials (clientId + optional secret). */
export interface OAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret?: SecretValue;
}

export type OAuthFlow = 'authorization_code' | 'client_credentials';

/**
 * OAuth client config to bootstrap into the config table.
 *
 * Note: `requestedAudience` is optional; when omitted, we default to `clientId`.
 * Some providers treat audience and clientId as the same concept, while others don't.
 */
export interface OAuthAuthorizationCodeClientConfig extends OAuthClientCredentials {
  readonly flow: 'authorization_code';
  readonly requestedAudience?: string;
  readonly scopes: string[];
  readonly redirectUri: string;
}

export interface OAuthClientCredentialsClientConfig extends OAuthClientCredentials {
  readonly flow: 'client_credentials';
  readonly requestedAudience?: string;
  readonly scopes: string[];
}

export type OAuthClientConfig = OAuthAuthorizationCodeClientConfig | OAuthClientCredentialsClientConfig;

export interface OAuthClientsConfig {
  readonly adminUi?: OAuthAuthorizationCodeClientConfig;
  readonly jmapUi?: OAuthAuthorizationCodeClientConfig;
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

/** Parameters for provisioning the Admin UI OAuth client. */
export interface ProvisionAdminUiClientParams {
  readonly name: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
}

/** Parameters for provisioning the JMAP UI OAuth client. */
export interface ProvisionJmapUiClientParams {
  readonly name: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  readonly permissions: Permission[];
}

/**
 * Auth provider contract expected by the top-level Mailbox construct.
 *
 * Key properties:
 * - `policies` explicitly separates Admin vs JMAP audiences.
 * - UI OAuth clients are provisioned only when the corresponding UI is created,
 *   because callback/logout URLs are not known up-front.
 */
export interface IMailboxAuthProviderBase {
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: AuthMethod;
  readonly usePkce: boolean;
  readonly scopeMap: { [key: string]: Permission[] };

  /** Policy configuration consumed by authorizers (audiences + optional group requirement). */
  readonly policies: MailboxAuthPolicies;

  /** Provision the OAuth client used by the Admin UI (authorization_code). */
  provisionAdminUiClient(config: ProvisionAdminUiClientParams): AuthClientConfig;

  /** Provision the OAuth client used by the Webmail/JMAP UI (authorization_code). */
  provisionJmapUiClient(config: ProvisionJmapUiClientParams): AuthClientConfig;
}


/** Optional hook for providers to supply Admin UI runtime config (written to `/config/config.json`). */
export interface IAdminUiConfigProvider {
  adminUiConfig(): Record<string, unknown>;
}


/** Standard roles understood by mailbox components. */
export type MailboxRole = 'admin' | 'user';

/** Provider-supplied mapping from IdP concepts (typically groups) to mailbox roles. */
export interface MailboxAuthorizationConfig {
  readonly adminGroups: string[];
  readonly userGroups: string[];
}

/** Optional hook for providers to publish an authorization mapping (e.g. which groups grant admin). */
export interface IMailboxAuthorizationConfigProvider {
  authorizationConfig(): MailboxAuthorizationConfig;
}


/**
 * Auth provider contract expected by the top-level Mailbox construct.
 *
 * Implementations are typically provider-owned CDK constructs (e.g. Cognito's `MailboxUserPool`).
 * They can optionally supply Admin API addons (provider-specific admin endpoints).
 */
export interface IMailboxAuthProvider extends IMailboxAuthProviderBase {
  /** Optional: register additional Admin API routes (provider-specific). */
  createAdminApiAddons?(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[];
  /** Optional: supply Admin UI runtime config. */
  adminUiConfig?(): Record<string, unknown>;
  /** Optional: publish an authorization mapping. */
  authorizationConfig?(): MailboxAuthorizationConfig;
}

