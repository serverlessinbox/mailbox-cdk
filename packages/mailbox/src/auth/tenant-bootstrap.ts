import { SecretValue } from "aws-cdk-lib";

export const DEFAULT_OIDC_PROVIDER_NAME = "PRIMARY";

export const AUTH_POLICY_ADMIN_API = "ADMIN_API" as const;
export const AUTH_POLICY_JMAP_API = "JMAP_API" as const;
export type AuthPolicyName = typeof AUTH_POLICY_ADMIN_API | typeof AUTH_POLICY_JMAP_API;

export const OAUTH_CLIENT_ADMIN_UI = "ADMIN_UI" as const;
export const OAUTH_CLIENT_JMAP_UI = "JMAP_UI" as const;
export type OAuthClientName = typeof OAUTH_CLIENT_ADMIN_UI | typeof OAUTH_CLIENT_JMAP_UI;

export interface BootstrapOIDCProviderProps {
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  authMethod?: "header" | "form";
  usePkce?: boolean;
}

export interface BootstrapAuthPolicyProps {
  audiences?: string[];
  requiredGroup?: string;
}

export interface BootstrapAuthPoliciesProps {
  adminApi?: BootstrapAuthPolicyProps;
  jmapApi?: BootstrapAuthPolicyProps;
}

export interface BootstrapOAuthClientProps {
  requestedAudience?: string;
  clientId?: string;
  clientSecret?: SecretValue;
  scopes?: string[];
  redirectUri?: string;
}

export interface BootstrapOAuthClientsProps {
  adminUi: BootstrapOAuthClientProps;
  jmapUi?: BootstrapOAuthClientProps;
}
