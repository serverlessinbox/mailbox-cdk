import { SecretValue }                                                     from 'aws-cdk-lib';
import { Construct }                                                       from 'constructs';

import type { IAdminApiAddonProvider, JmapApiAddonContext, IJmapApiAddon } from '../apis/addons';

import { Permission, ScopeMap }                                            from './jmap-scopes';

/** How the OAuth client authenticates at the token endpoint: `header` or `form`. */
export type AuthMethod = 'header' | 'form';

/** OIDC provider configuration needed by the token exchange + UI flows. */
export interface OidcProviderConfig {
  /** URL of the provider's token endpoint. */
  readonly tokenEndpoint:         string;
  /** URL of the provider's authorization endpoint. */
  readonly authorizationEndpoint: string;
  /** How the OAuth client authenticates at the token endpoint. */
  readonly authMethod:            AuthMethod;
  /** Whether the authorization code flow uses PKCE. */
  readonly usePkce:               boolean;
}

/** Policy configuration for authorizers (audiences + optional group requirement). */
export interface AuthPolicyConfig {
  /** Audiences accepted for requests under this policy. */
  readonly audiences: string[];
  /** Require membership in ANY of these groups/roles. Empty/undefined means no restriction. */
  readonly requireAnyOfGroups?: string[];

  /** Require ALL of these OAuth scopes. Empty/undefined means no scope restriction. */
  readonly requireAllScopes?: string[];
}

/** The auth policy of each API. */
export interface AuthPoliciesConfig {
  readonly adminApi?: AuthPolicyConfig;
  readonly jmapApi?:  AuthPolicyConfig;
}

/** Concrete, policy-split auth configuration used by mailbox components. */
export interface MailboxAuthPolicies {
  readonly adminApi: AuthPolicyConfig;
  readonly jmapApi:  AuthPolicyConfig;
}

/** Shared OAuth client credentials (clientId + optional secret). */
export interface OAuthClientCredentials {
  readonly clientId:      string;
  readonly clientSecret?: SecretValue;
}

/** The OAuth grant a client uses to obtain tokens. */
export type OAuthFlow = 'authorization_code' | 'client_credentials';

/**
 * OAuth client config to bootstrap into the config table.
 *
 * Note: `requestedAudience` is optional; when omitted, we default to `clientId`.
 * Some providers treat audience and clientId as the same concept, while others don't.
 */
export interface OAuthAuthorizationCodeClientConfig extends OAuthClientCredentials {
  readonly flow:               'authorization_code';
  readonly requestedAudience?: string;
  readonly scopes:             string[];
  readonly redirectUri:        string;
}

/** OAuth client config for the `client_credentials` flow, which has no redirect URI. */
export interface OAuthClientCredentialsClientConfig extends OAuthClientCredentials {
  readonly flow:               'client_credentials';
  readonly requestedAudience?: string;
  readonly scopes:             string[];
}

/** An OAuth client config of either flow. */
export type OAuthClientConfig = OAuthAuthorizationCodeClientConfig | OAuthClientCredentialsClientConfig;

/** The OAuth clients to bootstrap: one per UI that is enabled. */
export interface OAuthClientsConfig {
  readonly adminUi?:   OAuthAuthorizationCodeClientConfig;
  readonly webmailUi?: OAuthAuthorizationCodeClientConfig;
}

/** Parameters for generating an OAuth client; the flow decides which parameters apply. */
export type GenerateClientParams =
  | {
    flow:         'authorization_code';
    name:         string;
    groups?:      string[];
    permissions:  Permission[];
    callbackUrls: string[];
    logoutUrls:   string[];
  }
  | {
    flow:        'client_credentials';
    name:        string;
    groups?:     string[];
    permissions: Permission[];
  };

/**
 * Result of generating/providing an OAuth client for mailbox usage.
 * Used by constructs to pass a concrete clientId (+ optional secret) and the scopes/groups it should request.
 */
export interface AuthClientConfig extends OAuthClientCredentials {
  readonly requestScopeList: string[];
  readonly groups:           string[];
}

/** Parameters for provisioning an OAuth client that may call the Admin API. */
export interface ProvisionAdminApiClientParams {
  readonly name:         string;
  readonly callbackUrls: string[];
  readonly logoutUrls:   string[];
}

/** Parameters for provisioning an OAuth client that may call the JMAP API. */
export interface ProvisionJmapApiClientParams {
  readonly name:         string;
  readonly callbackUrls: string[];
  readonly logoutUrls:   string[];
  readonly permissions:  Permission[];
}

/**
 * The identity and policy part of an auth provider: where its tokens come from, which audiences
 * and scopes each API accepts, and how OAuth clients for the UIs are provisioned.
 *
 * Key properties:
 * - `policies` explicitly separates Admin vs JMAP audiences.
 * - UI OAuth clients are provisioned only when the corresponding UI is created,
 *   because callback/logout URLs are not known up-front.
 */
export interface IMailboxAuthProviderBase {
  /** Issuer URL of the OIDC provider. */
  readonly issuer:                string;
  /** URL of the provider's token endpoint. */
  readonly tokenEndpoint:         string;
  /** URL of the provider's authorization endpoint. */
  readonly authorizationEndpoint: string;
  /** How the OAuth client authenticates at the token endpoint. */
  readonly authMethod:            AuthMethod;
  /** Whether the authorization code flow uses PKCE. */
  readonly usePkce:               boolean;
  /** Maps each OAuth scope name the provider issues to the JMAP permissions it stands for. */
  readonly scopeMap:              ScopeMap;

  /** Policy configuration consumed by authorizers (audiences + optional group requirement). */
  readonly policies: MailboxAuthPolicies;

  /** Provision an OAuth client (authorization_code) that may call the Admin API; `config.name` names the app that uses it. */
  provisionAdminApiClient(config: ProvisionAdminApiClientParams): AuthClientConfig;

  /** Provision an OAuth client (authorization_code) that may call the JMAP API; `config.name` names the app that uses it. */
  provisionJmapApiClient(config: ProvisionJmapApiClientParams): AuthClientConfig;
}

/** A role understood by mailbox components: `admin` or `user`. */
export type MailboxRole = 'admin' | 'user';

/** Provider-supplied mapping from IdP concepts (typically groups) to mailbox roles. */
export interface MailboxAuthorizationConfig {
  readonly adminGroups: string[];
  readonly userGroups:  string[];
}

/** Optional hook for providers to publish an authorization mapping (e.g. which groups grant admin). */
export interface IMailboxAuthorizationConfigProvider {
  authorizationConfig(): MailboxAuthorizationConfig;
}

/**
 * An auth provider as the top-level Mailbox construct takes it: the base contract plus the
 * Admin API addons the provider contributes, and optionally JMAP API addons and an authorization
 * mapping.
 *
 * Implementations are typically provider-owned CDK constructs (e.g. Cognito's `MailboxUserPool`).
 */
export interface IMailboxAuthProvider extends IMailboxAuthProviderBase, IAdminApiAddonProvider {
  /** Optional: register additional JMAP API routes (provider-specific, e.g. OAuth DCR). */
  createJmapApiAddons?(scope: Construct, ctx: JmapApiAddonContext): IJmapApiAddon[];
  /** Optional: this provider's OAuth issuer URL, if OAuth DCR/discovery is enabled — undefined otherwise. */
  jmapOAuthIssuerUrl?(): string | undefined;
  /** Optional: publish an authorization mapping. */
  authorizationConfig?(): MailboxAuthorizationConfig;
}

/** Name of the OIDC provider entry in the config table. */
export const DEFAULT_OIDC_PROVIDER_NAME = 'PRIMARY';

