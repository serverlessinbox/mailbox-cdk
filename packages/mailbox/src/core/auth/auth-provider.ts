import { SecretValue }                                                     from 'aws-cdk-lib';
import { Construct }                                                       from 'constructs';

import type { IAdminApiAddonProvider, JmapApiAddonContext, IJmapApiAddon } from '../apis/addons';

import { AuthMethod }                                                      from './auth-method';
import { Permission, ScopeMap }                                            from './jmap-scopes';
import { OAuthFlow }                                                       from './oauth-flow';

/** Policy configuration for authorizers (audiences + optional group requirement). */
export interface AuthPolicyConfig {
  /** Audiences accepted for requests under this policy. */
  readonly audiences: string[];
  /**
   * Require membership in ANY of these groups/roles. Empty/undefined means no restriction.
   * The Admin API policy is the exception: synthesis fails unless it resolves to at least one
   * group, falling back to the groups of the Admin UI OAuth client when this is undefined.
   */
  readonly requireAnyOfGroups?: string[];

  /** Require ALL of these OAuth scopes. Empty/undefined means no scope restriction. */
  readonly requireAllScopes?: string[];
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

/** Parameters for generating an `authorization_code` OAuth client, which has redirect and logout URLs. */
export interface GenerateAuthorizationCodeClientParams {
  readonly flow:         OAuthFlow.AUTHORIZATION_CODE;
  readonly name:         string;
  readonly groups?:      string[];
  readonly permissions:  Permission[];
  readonly callbackUrls: string[];
  readonly logoutUrls:   string[];
}

/** Parameters for generating a `client_credentials` OAuth client, which has no redirect or logout URLs. */
export interface GenerateClientCredentialsClientParams {
  readonly flow:        OAuthFlow.CLIENT_CREDENTIALS;
  readonly name:        string;
  readonly groups?:     string[];
  readonly permissions: Permission[];
}

/** Parameters for generating an OAuth client; the flow decides which parameters apply. */
export type GenerateClientParams = GenerateAuthorizationCodeClientParams | GenerateClientCredentialsClientParams;

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

/** Provider-supplied mapping from IdP concepts (typically groups) to mailbox roles. */
export interface MailboxAuthorizationConfig {
  /** Names of the identity-provider groups whose members get the admin role. Written to the Admin UI config as `authorization.roles.adminGroups`. */
  readonly adminGroups: string[];
  /** Names of the identity-provider groups whose members get the user role. Written to the Admin UI config as `authorization.roles.userGroups`. */
  readonly userGroups:  string[];
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
