import { Aws, CustomResource, SecretValue } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import {
  AuthClientConfig,
  AuthPolicyConfig,
  MailboxAuthPolicies,
  IMailboxAuthProviderBase,
  GenerateClientParams,
  JMAP_SCOPE_DESCRIPTIONS,
  OAUTH_CLIENT_ADMIN_UI,
  OAUTH_CLIENT_JMAP_UI,
  Permission,
  ProvisionAdminUiClientParams,
  ProvisionJmapUiClientParams,
  StackHelpers,
} from '@serverlessinbox/mailbox';

import type { AdminApiAddonContext, IAdminApiAddon, IAdminApiAddonProvider, JmapApiAddonContext, IJmapApiAddon } from '@serverlessinbox/mailbox';
import { PinnedResolver, CdkArtifactEngine, resolveDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/mailbox';

import { CognitoIdpUsersAdminApiAddon, CognitoIdpUsersAuthorizationConfig } from '../api/cognito-idp-users-addon';
import { JmapOAuthAddon } from '../api/jmap-oauth-addon';

import { slugifyLabel } from '../utils/resource-names';
import { CognitoScopeToPermissions, PermissionToCognitoScope } from './scopemaps/cognito';
import { CognitoBootstrapUserLambda } from '../lambdas/cognito-bootstrap-user';
import { MailboxCognitoDataDeployer } from '../cognito/mailbox-cognito-data-deployer';

/**
 * Dynamic Client Registration (RFC 7591) mode for the JMAP OAuth discovery addon.
 * Co-located here (rather than a separate types module) because `MailboxUserPoolProps` is the
 * prop's canonical, jsii-exported home; `JmapOAuthAddonProps` mirrors the same enum.
 */
export enum DynamicClientRegistrationMode {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

export interface MailboxUserPoolAuthorizationConfig {
  readonly adminGroups?: string[];
  readonly userGroups?: string[];
}

export interface ProvisionHeadlessClientConfig {
  readonly name: string;
  readonly audiences: Array<'adminApi' | 'jmapApi'>;
  readonly permissions: Permission[];
}


export interface MailboxUserPoolCognitoDomain {
  readonly kind: 'cognito';
  /** Explicit Cognito domain prefix for the OAuth endpoint. */
  readonly cognitoDomainPrefix: string;
}

export interface MailboxUserPoolCognitoAutoDomain {
  readonly kind: 'cognito-auto';
  /** Route53 hosted zone ID used to auto-derive `cognitoDomainPrefix`.
   *  The prefix is derived + sanitized from the mail domain at deploy time via the shared StackHelpers singleton. */
  readonly hostedZoneId: string;
}

export interface MailboxUserPoolCustomDomain {
  readonly kind: 'custom';
  /** Custom domain name for the Cognito OAuth endpoint (e.g. `auth.example.com`). */
  readonly domainName: string;
  /** ACM certificate ARN in us-east-1 for the custom domain. */
  readonly certificateArn: string;
}

export type MailboxUserPoolDomainConfig = MailboxUserPoolCognitoDomain | MailboxUserPoolCognitoAutoDomain | MailboxUserPoolCustomDomain;

export interface MailboxUserPoolProps {
  /**
   * Domain configuration for the Cognito OAuth endpoint.
   * Use `kind: 'cognito'` for an explicit prefix, `kind: 'cognito-auto'` to derive it from a hosted zone,
   * or `kind: 'custom'` for a custom domain.
   */
  readonly domain: MailboxUserPoolDomainConfig;

  /**
   * Authorization mapping used by mailbox components.
   * Defaults to admin=['admin'], user=['user'].
   */
  readonly authorization?: MailboxUserPoolAuthorizationConfig;

  readonly authFlows?: cognito.AuthFlow;
  /** MFA enforcement mode. @default 'OPTIONAL' */
  readonly mfaMode?: 'OFF' | 'OPTIONAL' | 'ON';
  /** Minimum password length (6–99). @default 8 */
  readonly passwordMinLength?: number;

  /**
   * Artifact resolver for Lambda code resolution (stack-self-update subplan #3, Phase A, D1/D2).
   * When omitted, defaults to pinned behavior (byte-identical to old behavior, zero infra).
   */
  readonly artifactResolver?: IArtifactResolver;

  /**
   * Enable RFC 8414 OIDC discovery (`GET /.well-known/openid-configuration`) for the JMAP API.
   * @default false
   */
  readonly enableJmapOAuthDiscovery?: boolean;

  /**
   * Dynamic Client Registration mode. Defaults to DISABLED. Requires `enableJmapOAuthDiscovery`
   * to be meaningful — the registration endpoint is advertised in the discovery document, which
   * is otherwise not published.
   *
   * To drive this from a CloudFormation parameter, cast the parameter's `valueAsString`
   * to this enum — the value stays an unresolved token until deploy and is gated by a
   * CfnCondition rather than evaluated at synth.
   * @default DynamicClientRegistrationMode.DISABLED
   */
  readonly dynamicClientRegistration?: DynamicClientRegistrationMode;
}

export interface BootstrapUserConfig {
  /** Defaults to `"admin"` if not provided. */
  readonly username?: string;
  readonly groups: string[];
  readonly temporaryPassword?: string;
}

/**
 * Opinionated JMAP user pool construct for mailbox servers.
 */
export class MailboxUserPool extends Construct implements IMailboxAuthProviderBase, IAdminApiAddonProvider {
  public readonly userPool: cognito.IUserPool;
  private readonly resourceServerIdentifier: string = 'si';

  private readonly supportedIdentityProviders: cognito.UserPoolClientIdentityProvider[] = [
    cognito.UserPoolClientIdentityProvider.COGNITO,
  ];
  private readonly supportedIdentityProviderNames = new Set<string>(['COGNITO']);

  private authFlows: cognito.AuthFlow;

  private readonly authzConfig: { adminGroups: string[]; userGroups: string[] };

  public readonly scopeMap: Record<string, Permission[]>;
  public readonly oauthDomain: string;
  public readonly issuer: string;
  public readonly authMethod = 'form';
  public readonly usePkce = true;

  public readonly policies: MailboxAuthPolicies;

  private readonly adminUiClients = new Map<string, AuthClientConfig>();
  private readonly jmapUiClients = new Map<string, AuthClientConfig>();
  private readonly headlessClients = new Map<string, AuthClientConfig>();
  private readonly artifacts: ICdkArtifactEngine;
  private _bootstrapUserCount = 0;
  private _enableJmapOAuthDiscovery = false;
  private _dynamicClientRegistration: DynamicClientRegistrationMode = DynamicClientRegistrationMode.DISABLED;

  // Stored userPoolId for use in CfnUserPoolClient and grants
  private readonly _userPoolId: string;
  // Stored userPoolArn for IAM grants
  private readonly _userPoolArn: string;

  get userPoolId(): string {
    return this._userPoolId;
  }

  /**
   * Register an additional identity provider to be enabled for all OAuth clients generated by this construct.
   * Intended for addon packages (e.g. SAML/OIDC federation providers).
   */
  public addSupportedIdentityProvider(providerName: string): void {
    if (this.supportedIdentityProviderNames.has(providerName)) {
      return;
    }

    this.supportedIdentityProviderNames.add(providerName);
    this.supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.custom(providerName));
  }

  get tokenEndpoint(): string {
    return `https://${this.oauthDomain}/oauth2/token`;
  }

  get authorizationEndpoint(): string {
    return `https://${this.oauthDomain}/oauth2/authorize`;
  }

  private buildExplicitAuthFlows(): string[] {
    const flows: string[] = ['ALLOW_REFRESH_TOKEN_AUTH'];
    if (this.authFlows.userPassword) {
      flows.push('ALLOW_USER_PASSWORD_AUTH');
    }
    if (this.authFlows.userSrp) {
      flows.push('ALLOW_USER_SRP_AUTH');
    }
    if (this.authFlows.custom) {
      flows.push('ALLOW_CUSTOM_AUTH');
    }
    if (this.authFlows.adminUserPassword) {
      flows.push('ALLOW_ADMIN_USER_PASSWORD_AUTH');
    }
    return flows;
  }

  private createOAuthClient(params: GenerateClientParams): AuthClientConfig {
    const scopes = params.permissions.map((scope: Permission) => ({
      scopeName: `${this.resourceServerIdentifier}/${PermissionToCognitoScope[scope]}`,
      scopeDescription: JMAP_SCOPE_DESCRIPTIONS[scope],
    }));

    const isClientCredentials = params.flow === 'client_credentials';
    const clientKey = slugifyLabel(params.name);

    const allowedOAuthScopes: string[] = [
      ...(isClientCredentials ? [] : ['openid', 'email', 'profile']),
      ...scopes.map((s: { scopeName: string }) => s.scopeName),
    ];

    const cfnClient = new cognito.CfnUserPoolClient(this, `user-pool-client-${clientKey}`, {
      userPoolId: this._userPoolId,
      clientName: `mailbox-client-${clientKey}`,
      explicitAuthFlows: this.buildExplicitAuthFlows(),
      generateSecret: isClientCredentials,
      accessTokenValidity: 1,
      idTokenValidity: 1,
      refreshTokenValidity: 30,
      tokenValidityUnits: {
        accessToken: 'hours',
        idToken: 'hours',
        refreshToken: 'days',
      },
      preventUserExistenceErrors: 'ENABLED',
      supportedIdentityProviders: this.supportedIdentityProviders.map(p => p.name),
      allowedOAuthFlows: isClientCredentials ? ['client_credentials'] : ['code'],
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthScopes,
      ...(isClientCredentials
        ? {}
        : {
          callbackUrLs: params.callbackUrls,
          logoutUrLs: params.logoutUrls,
        }),
    });

    const requestedScopeList = params.permissions.map((permission: Permission) => {
      const scopeNameForOAuth = PermissionToCognitoScope[permission].replace(/\//g, '.');
      return `${this.resourceServerIdentifier}/${scopeNameForOAuth}`;
    });

    return {
      clientId: cfnClient.ref,
      clientSecret: isClientCredentials ? SecretValue.unsafePlainText(cfnClient.attrClientSecret) : undefined,
      requestScopeList: requestedScopeList,
      groups: params.groups ?? [],
    };
  }

  private addAudience(policy: AuthPolicyConfig, clientId: string): void {
    if (!policy.audiences.includes(clientId)) {
      policy.audiences.push(clientId);
    }
  }

  provisionHeadlessClient(config: ProvisionHeadlessClientConfig): AuthClientConfig {

    const existing = this.headlessClients.get(config.name);
    if (existing) {
      for (const audience of config.audiences) {
        if (audience === 'adminApi') {
          this.addAudience(this.policies.adminApi, existing.clientId);
        } else {
          this.addAudience(this.policies.jmapApi, existing.clientId);
        }
      }

      return existing;
    }

    const client = this.createOAuthClient({
      flow: 'client_credentials',
      name: config.name,
      permissions: config.permissions,
    });

    for (const audience of config.audiences) {
      if (audience === 'adminApi') {
        this.addAudience(this.policies.adminApi, client.clientId);
      } else {
        this.addAudience(this.policies.jmapApi, client.clientId);
      }
    }

    this.headlessClients.set(config.name, client);
    return client;
  }

  provisionAdminUiClient(config: ProvisionAdminUiClientParams): AuthClientConfig {

    const resolvedName = `${OAUTH_CLIENT_ADMIN_UI}_${config.name}`;
    const existing = this.adminUiClients.get(resolvedName);
    if (existing) {
      return existing;
    }

    const client = this.createOAuthClient({
      flow: 'authorization_code',
      name: resolvedName,
      permissions: [Permission.ADMIN],
      groups: this.authzConfig.adminGroups,
      callbackUrls: config.callbackUrls,
      logoutUrls: config.logoutUrls,
    });

    this.addAudience(this.policies.adminApi, client.clientId);
    this.adminUiClients.set(resolvedName, client);
    return client;
  }

  provisionJmapUiClient(config: ProvisionJmapUiClientParams): AuthClientConfig {

    const resolvedName = `${OAUTH_CLIENT_JMAP_UI}_${config.name}`;
    const existing = this.jmapUiClients.get(resolvedName);
    if (existing) {
      return existing;
    }

    const client = this.createOAuthClient({
      flow: 'authorization_code',
      name: resolvedName,
      permissions: config.permissions,
      groups: this.authzConfig.userGroups,
      callbackUrls: config.callbackUrls,
      logoutUrls: config.logoutUrls,
    });

    this.addAudience(this.policies.jmapApi, client.clientId);
    this.jmapUiClients.set(resolvedName, client);
    return client;
  }

  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new CognitoIdpUsersAdminApiAddon(scope, 'cognito-idp-users-admin-api', {
        artifactResolver: this.artifacts,
        auditEventsQueue: ctx.auditEventsQueue,
        pool: this,
      }),
    ];
  }

  createJmapApiAddons(scope: Construct, ctx: JmapApiAddonContext): IJmapApiAddon[] {
    if (!this._enableJmapOAuthDiscovery) return [];
    return [
      new JmapOAuthAddon(scope, 'jmap-oauth-addon', {
        pool: this,
        artifactResolver: this.artifacts,
        apiBaseUrl: ctx.apiBaseUrl,
        identityProvisionerFunction: ctx.identityProvisionerFunction,
        dynamicClientRegistration: this._dynamicClientRegistration,
      }),
    ];
  }

  jmapOAuthIssuerUrl(): string | undefined {
    if (!this._enableJmapOAuthDiscovery) return undefined;
    return this.issuer;
  }

  adminUiConfig(): Record<string, unknown> {
    return { idp: { type: 'cognito' } };
  }

  authorizationConfig(): CognitoIdpUsersAuthorizationConfig {
    return this.authzConfig;
  }

  fetchAuthorizationConfig(): CognitoIdpUsersAuthorizationConfig {
    return this.authzConfig;
  }

  constructor(scope: Construct, id: string, props: MailboxUserPoolProps) {
    super(scope, id);

    this._enableJmapOAuthDiscovery = props.enableJmapOAuthDiscovery ?? false;
    this._dynamicClientRegistration = props.dynamicClientRegistration ?? DynamicClientRegistrationMode.DISABLED;

    // Artifact resolution (stack-self-update subplan #3, Phase A):
    // One injected strategy → one engine, threaded to every sub-construct. Default is pinned
    // (byte-identical synth-time pinning); inject an AutoUpdater for track-based resolution.
    const resolver = props.artifactResolver ?? PinnedResolver.loadFromArtifactMetadata(this);

    // Register this package for artifact updates
    resolver.registerPackages(['mailbox-cognito']);

    this.artifacts = new CdkArtifactEngine(this, resolver);

    this.authzConfig = {
      adminGroups: props.authorization?.adminGroups ?? ['admin'],
      userGroups: props.authorization?.userGroups ?? ['user'],
    };

    this.scopeMap = this.buildScopeMap();

    // Admin API: always require admin scope. Group enforcement is applied for user tokens only
    // (client_credentials tokens don't carry groups).
    this.policies = {
      adminApi: {
        audiences: [],
        requireAnyOfGroups: this.authzConfig.adminGroups,
        requireAllScopes: [this.toOAuthScope(Permission.ADMIN)],
      },
      jmapApi: {
        audiences: [],
        requireAllScopes: [],
      },
    };

    this.authFlows = props.authFlows ?? {
      userPassword: false,
      userSrp: false,
    };

    const cognitoDomainPrefix = props.domain.kind === 'cognito'
      ? props.domain.cognitoDomainPrefix
      : props.domain.kind === 'cognito-auto'
      ? StackHelpers.getOrCreate(this, resolver)
          .resolveCognitoDomainPrefix(this, 'domain-prefix-v2', props.domain.hostedZoneId)
      : Aws.STACK_NAME;

    // MailboxUserPool is its own composition root (instantiated as a sibling of Mailbox by the
    // consuming stack, not built by Mailbox itself) — resolve deployerType once here, same as
    // Mailbox does for its own deployer constructs.
    const deployerType = resolveDeployerType(this);

    const cognitoDeployer = new MailboxCognitoDataDeployer(this, 'cognito-deployer', {
      cognitoDomainPrefix,
      customDomain: props.domain.kind === 'custom'
        ? { domainName: props.domain.domainName, certificateArn: props.domain.certificateArn }
        : undefined,
      mfaMode: props.mfaMode,
      passwordMinLength: props.passwordMinLength,
      artifactResolver: this.artifacts,
      deployerType,
    });
    const stackRef = cognitoDeployer.dataStackRef;

    this.userPool = stackRef.userPool;
    this._userPoolId = stackRef.userPoolId;
    this._userPoolArn = stackRef.userPoolArn;
    this.oauthDomain = stackRef.oauthDomain;
    this.issuer = `https://cognito-idp.${Aws.REGION}.amazonaws.com/${stackRef.userPoolId}`;
  }

  private toOAuthScope(permission: Permission): string {
    const scopeNameForOAuth = PermissionToCognitoScope[permission].replace(/\//g, '.');
    return `${this.resourceServerIdentifier}/${scopeNameForOAuth}`;
  }

  private buildScopeMap(): Record<string, Permission[]> {
    const scopeMap: Record<string, Permission[]> = {};

    for (const [cognitoScope, permissions] of Object.entries(CognitoScopeToPermissions) as [string, Permission[]][]) {
      const scopeNameForOAuth = cognitoScope.replace(/\//g, '.');
      const fullScopeName = `${this.resourceServerIdentifier}/${scopeNameForOAuth}`;
      scopeMap[fullScopeName] = permissions;
    }

    return scopeMap;
  }

  /**
   * Attach a bootstrap user Custom Resource to this user pool.
   * The artifact resolver is shared with the rest of the user pool.
   *
   * @param config Bootstrap user configuration
   */
  public addBootstrapUser(config: BootstrapUserConfig): void {
    const index = ++this._bootstrapUserCount;
    const constructId = `bootstrapped-user-${index}`;
    const handler = new CognitoBootstrapUserLambda(this, `${constructId}-lambda`, {
      artifactResolver: this.artifacts,
    });

    new CustomResource(this, constructId, {
      resourceType: 'Custom::CognitoBootstrapUser',
      serviceToken: handler.functionArn,
      properties: {
        userPoolId: this._userPoolId,
        username: config.username,
        groups: config.groups,
        temporaryPassword: config.temporaryPassword,
      },
    });

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [this._userPoolArn],
      }),
    );
  }

  public grantAdminAccess(fn: lambda.IFunction): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:ListUsersInGroup',
          'cognito-idp:ListGroups',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminResetUserPassword',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
        ],
        resources: [this._userPoolArn],
      }),
    );
  }
}
