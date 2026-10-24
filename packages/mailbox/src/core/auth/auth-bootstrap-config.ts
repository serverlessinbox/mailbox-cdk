import { AuthMethod }                                    from './auth-method';
import type { AuthPolicyConfig, OAuthClientCredentials } from './auth-provider';
import { OAuthFlow }                                     from './oauth-flow';

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

/** The auth policy of each API. */
export interface AuthPoliciesConfig {
  readonly adminApi?: AuthPolicyConfig;
  readonly jmapApi?:  AuthPolicyConfig;
}

/**
 * OAuth client config to bootstrap into the config table.
 *
 * Note: `requestedAudience` is optional; when omitted, we default to `clientId`.
 * Some providers treat audience and clientId as the same concept, while others don't.
 */
export interface OAuthAuthorizationCodeClientConfig extends OAuthClientCredentials {
  readonly flow:               OAuthFlow.AUTHORIZATION_CODE;
  readonly requestedAudience?: string;
  readonly scopes:             string[];
  readonly redirectUri:        string;
}

/** The OAuth clients to bootstrap: one per UI that is enabled. */
export interface OAuthClientsConfig {
  readonly adminUi?:   OAuthAuthorizationCodeClientConfig;
  readonly webmailUi?: OAuthAuthorizationCodeClientConfig;
}
