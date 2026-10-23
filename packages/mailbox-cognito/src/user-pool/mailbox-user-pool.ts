import type { IArtifactResolver }                                                                         from '@serverlessinbox/artifact-registry-cdk';
import { MailboxArtifactResolverFactory, resolveDeployerType, slugifyLabel, StackHelpers, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import {
  AuthClientConfig,
  AuthPolicyConfig,
  MailboxAuthPolicies,
  IMailboxAuthProviderBase,
  GenerateClientParams,
  AUTH_POLICY_ADMIN_API,
  AUTH_POLICY_JMAP_API,
  Permission,
  ProvisionAdminApiClientParams,
  ProvisionJmapApiClientParams,
} from '@serverlessinbox/mailbox';
import type { AdminApiAddonContext, IAdminApiAddon, IAdminApiAddonProvider, JmapApiAddonContext, IJmapApiAddon, ScopeMap } from '@serverlessinbox/mailbox';
import * as cognito                                                                                                        from 'aws-cdk-lib/aws-cognito';
import * as lambda                                                                                                         from 'aws-cdk-lib/aws-lambda';
import type * as route53                                                                                                   from 'aws-cdk-lib/aws-route53';
import { Aws, CustomResource, Duration, SecretValue }                                                                      from 'aws-cdk-lib';
import { Construct }                                                                                                       from 'constructs';

import { CognitoIdpUsersAdminApiAddon }                                                                                    from '../cognito-idp-users-addon';
import type { CognitoIdpUsersAuthorizationConfig }                                                                         from '../cognito-idp-users-pool-config';
import { MailboxCognitoDataDeployer }                                                                                      from '../data-stack/mailbox-cognito-data-deployer';
import { ADMIN_GROUP_NAME, RESOURCE_SERVER_IDENTIFIER, USER_GROUP_NAME }                                                   from '../data-stack/mailbox-cognito-data-stack-contract';
import { JmapOAuthAddon }                                                                                                  from '../jmap-oauth-addon';
import { loadMailboxCognitoArtifactVersions }                                                                              from '../mailbox-cognito-artifact-versions';
import { loadMailboxCognitoRegistryRecord }                                                                                from '../mailbox-cognito-registry-record';
import { CognitoBootstrapUserLambda }                                                                                      from '../resources/lambdas/bootstrap-user-lambda';
import type { BootstrapUserProperties }                                                                                    from '../runtime/bootstrap-user/properties';

import { CognitoScope, CognitoScopeToPermissions, PermissionToCognitoScope }                                               from './cognito-scopemap';
import { DynamicClientRegistrationMode }                                                                                   from './dynamic-client-registration-mode';
import type { MailboxUserPoolAdminUiConfig }                                                                               from './mailbox-user-pool-admin-ui-config';
import type { MfaMode }                                                                                                    from './mfa-mode';
import { UserPoolAudience }                                                                                                from './user-pool-audience';

/** The parameters of a client that signs users in through the authorization-code flow. */
type AuthorizationCodeClientParams = Extract<GenerateClientParams, { flow: 'authorization_code' }>;

/**
 * Maps Cognito groups to the two roles mailbox components distinguish.
 */
export interface MailboxUserPoolAuthorizationConfig {
  /**
   * Names of the Cognito groups whose members are administrators. A user calling the Admin API must be a
   * member of one of them. They are also the groups of the Admin API OAuth clients this construct provisions.
   * @default ['admin']
   */
  readonly adminGroups?: string[];

  /**
   * Names of the Cognito groups whose members are regular mailbox users. They are the groups of the
   * JMAP API OAuth clients this construct provisions.
   * @default ['user']
   */
  readonly userGroups?: string[];
}

/**
 * Describes a headless (machine-to-machine) OAuth client, passed to `MailboxUserPool.provisionHeadlessClient`.
 */
export interface ProvisionHeadlessClientConfig {
  /**
   * Name of the application using the client. The Cognito client is named `mailbox-client-<name>`
   * (slugified); provisioning the same name twice returns the first client.
   */
  readonly name: string;

  /**
   * The APIs the client may call. The client's id is added to the audiences of each listed API, and an API
   * refuses tokens of a client that is not among its audiences. Leave an API out to keep the client from
   * calling it.
   */
  readonly audiences: UserPoolAudience[];

  /**
   * The permissions the client is allowed to request. Each becomes an allowed OAuth scope on the client.
   */
  readonly permissions: Permission[];
}

/**
 * Domain setting for a user pool whose OAuth endpoint lives under an explicit Cognito domain prefix.
 */
export interface MailboxUserPoolCognitoDomain {
  /** Selects this domain setting in `MailboxUserPoolDomainConfig`: always `cognito`. */
  readonly kind: 'cognito';
  /** Explicit Cognito domain prefix for the OAuth endpoint. */
  readonly cognitoDomainPrefix: string;
}

/**
 * Domain setting for a user pool whose Cognito domain prefix is derived from a hosted zone.
 */
export interface MailboxUserPoolCognitoAutoDomain {
  /** Selects this domain setting in `MailboxUserPoolDomainConfig`: always `cognito-auto`. */
  readonly kind: 'cognito-auto';
  /**
   * The Route53 hosted zone used to auto-derive `cognitoDomainPrefix`. The prefix is the zone's name
   * (`zoneName`) with every character Cognito does not allow replaced, and is computed at deploy time
   * without calling Route53 itself.
   *
   * Pass the `hostedZone` of the `HostedZoneLookup` your `Mailbox` uses, so the zone is looked up once
   * for your whole app. A zone with a fixed `zoneName` works as well.
   */
  readonly hostedZone: route53.IHostedZone;
}

/**
 * Domain setting for a user pool whose OAuth endpoint is served from your own domain name.
 */
export interface MailboxUserPoolCustomDomain {
  /** Selects this domain setting in `MailboxUserPoolDomainConfig`: always `custom`. */
  readonly kind: 'custom';
  /** Custom domain name for the Cognito OAuth endpoint (e.g. `auth.example.com`). */
  readonly domainName: string;
  /** ACM certificate ARN in us-east-1 for the custom domain. */
  readonly certificateArn: string;
}

/** Where the user pool's OAuth endpoint is served from: an explicit prefix, a derived prefix, or a custom domain. */
export type MailboxUserPoolDomainConfig = MailboxUserPoolCognitoDomain | MailboxUserPoolCognitoAutoDomain | MailboxUserPoolCustomDomain;

/**
 * Configuration of a `MailboxUserPool`.
 */
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

  /**
   * The Cognito authentication flows enabled on every OAuth client this construct creates. Refresh-token
   * authentication is always enabled; each flag set here adds the matching `ALLOW_*` flow.
   * @default userPassword and userSrp both disabled
   */
  readonly authFlows?: cognito.AuthFlow;

  /**
   * Whether users must sign in with a second factor (TOTP). Cognito applies the mode to the whole pool.
   *
   * To drive this from a CloudFormation parameter, cast the parameter's `valueAsString` to this enum at the
   * single place it is injected; the parameter's allowed values are the enum's string values.
   * @default MfaMode.OPTIONAL
   */
  readonly mfaMode?: MfaMode;

  /**
   * The minimum length Cognito enforces on the passwords of the pool's users, from 6 to 99. A temporary
   * password you supply for a bootstrap user must meet it.
   * @default 8
   */
  readonly passwordMinLength?: number;

  /**
   * Artifact resolver for Lambda code resolution.
   * When omitted, defaults to a pinned resolver built from the versions shipped with the package.
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

/**
 * Describes the first user to create in the user pool, passed to `MailboxUserPool.addBootstrapUser`.
 */
export interface BootstrapUserConfig {
  /**
   * The name the user signs in with: the username of the Cognito user created in the pool.
   * @default 'admin'
   */
  readonly username?: string;

  /**
   * Names of the Cognito groups the user is added to. Add the admin group from your
   * `authorization` setting to create an administrator.
   */
  readonly groups: string[];

  /**
   * The password the user must change at first sign-in. When omitted, the custom resource generates one
   * at deploy time and exposes it through the returned `IBootstrapUserHandle`.
   */
  readonly temporaryPassword?: string;
}

/**
 * Handle to a bootstrapped user custom resource, allowing access to generated attributes.
 * When no temporary password was supplied, the custom resource generates one at deploy time
 * and exposes it through this handle.
 */
export interface IBootstrapUserHandle {
  /**
   * The temporary password of the bootstrap user: a CloudFormation `GetAtt` reference to the
   * `temporaryPassword` attribute of the custom resource, which holds the password the user was created with.
   * When the user already existed, the attribute holds a marker text instead, because the password of an
   * existing user cannot be recovered.
   */
  readonly temporaryPassword: string;
}

/**
 * The Cognito user pool that authenticates mailbox users and administrators, together with the OAuth
 * clients that sign them in.
 *
 * Pass it to `Mailbox` as the auth provider. It creates the pool and its OAuth domain through a
 * deployer, issues one OAuth client per application that needs to call the Admin API or the JMAP API,
 * and contributes the admin API addon that manages users.
 */
export class MailboxUserPool extends Construct implements IMailboxAuthProviderBase, IAdminApiAddonProvider {
  /** The Cognito user pool, resolved through the data stack reference of the deployer this construct creates. */
  public readonly userPool: cognito.IUserPool;

  /**
   * The id of the user pool, resolved at deploy time from the data stack the deployer creates, so it is an
   * unresolved token at synth time. Use it wherever a resource needs to name this pool.
   */
  public readonly userPoolId: string;

  /**
   * Maps every OAuth scope name this pool issues (`si/<scope>`) to the mailbox permissions it grants.
   */
  public readonly scopeMap: ScopeMap;

  /**
   * Host name of the Cognito OAuth endpoint, without scheme. It is the host of the Cognito domain
   * prefix or of the custom domain, and an unresolved token at synth time.
   */
  public readonly oauthDomain: string;

  /**
   * URL of the OAuth token endpoint, `https://<oauthDomain>/oauth2/token`, where an OAuth client exchanges an
   * authorization code or its client credentials for tokens.
   */
  public readonly tokenEndpoint: string;

  /**
   * URL of the OAuth authorization endpoint, `https://<oauthDomain>/oauth2/authorize`, where users sign in
   * to authorize an OAuth client.
   */
  public readonly authorizationEndpoint: string;

  /**
   * The issuer of the tokens this pool issues: `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`.
   * It is the value of the `iss` claim of those tokens.
   */
  public readonly issuer: string;

  /**
   * How an OAuth client authenticates at the token endpoint: always `form`, which sends the client
   * credentials as form fields of the token request.
   */
  public readonly authMethod = 'form';

  /**
   * Whether the authorization-code flow of this pool's clients uses PKCE: always `true`, so a client
   * sends a code challenge with its authorization request.
   */
  public readonly usePkce = true;

  /**
   * What the Admin API and JMAP API authorizers require of a token. Each OAuth client provisioned
   * through this construct adds its id to the audiences of the API it may call.
   */
  public readonly policies: MailboxAuthPolicies;

  private readonly supportedIdentityProviders: cognito.UserPoolClientIdentityProvider[] = [
    cognito.UserPoolClientIdentityProvider.COGNITO,
  ];
  private readonly supportedIdentityProviderNames = new Set<string>(['COGNITO']);

  private readonly authFlows: cognito.AuthFlow;
  private readonly authzConfig: CognitoIdpUsersAuthorizationConfig;
  private readonly adminApiClients = new Map<string, AuthClientConfig>();
  private readonly jmapApiClients = new Map<string, AuthClientConfig>();
  private readonly headlessClients = new Map<string, AuthClientConfig>();
  private readonly artifacts: IArtifactResolver;
  private readonly enableJmapOAuthDiscovery: boolean;
  private readonly dynamicClientRegistration: DynamicClientRegistrationMode;
  private bootstrapUserCount = 0;

  constructor(scope: Construct, id: string, props: MailboxUserPoolProps) {
    super(scope, id);

    this.enableJmapOAuthDiscovery  = props.enableJmapOAuthDiscovery ?? false;
    this.dynamicClientRegistration = props.dynamicClientRegistration ?? DynamicClientRegistrationMode.DISABLED;
    this.artifacts                 = props.artifactResolver
      ?? MailboxArtifactResolverFactory.fromContext(this, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());
    this.authzConfig               = {
      adminGroups: props.authorization?.adminGroups ?? [ADMIN_GROUP_NAME],
      userGroups:  props.authorization?.userGroups ?? [USER_GROUP_NAME],
    };
    this.scopeMap                  = this.buildScopeMap();
    this.policies                  = this.buildPolicies();
    this.authFlows                 = props.authFlows ?? {
      userPassword: false,
      userSrp:      false,
    };

    // This construct is a composition root, so it resolves the deployer type itself.
    const deployerType = resolveDeployerType(this);

    const cognitoDeployer = new MailboxCognitoDataDeployer(this, 'cognito-deployer', {
      cognitoDomainPrefix: this.resolveCognitoDomainPrefix(props.domain),
      customDomain:        props.domain.kind === 'custom'
        ? { domainName: props.domain.domainName, certificateArn: props.domain.certificateArn }
        : undefined,
      mfaMode:             props.mfaMode,
      passwordMinLength:   props.passwordMinLength,
      artifactResolver:    this.artifacts,
      deployerType,
      rootStack:           { name: Aws.STACK_NAME, id: StackIdentity.guid },
    });
    const stackRef        = cognitoDeployer.dataStackRef;

    this.userPool              = stackRef.userPool;
    this.userPoolId            = stackRef.userPool.userPoolId;
    this.oauthDomain           = stackRef.oauthDomain;
    this.tokenEndpoint         = `https://${stackRef.oauthDomain}/oauth2/token`;
    this.authorizationEndpoint = `https://${stackRef.oauthDomain}/oauth2/authorize`;
    this.issuer                = `https://cognito-idp.${Aws.REGION}.amazonaws.com/${stackRef.userPool.userPoolId}`;
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

  /**
   * Provision a client-credentials OAuth client for a machine caller and register it as an accepted
   * audience of the APIs listed in the config. Provisioning the same name again returns the existing
   * client and registers the audiences it is now listed for.
   */
  public provisionHeadlessClient(config: ProvisionHeadlessClientConfig): AuthClientConfig {
    const client = this.headlessClients.get(config.name) ?? this.createHeadlessClient(config);
    this.addAudiences(config.audiences, client.clientId);

    return client;
  }

  /** Provision the authorization-code OAuth client of an application that calls the Admin API; one per name. */
  public provisionAdminApiClient(config: ProvisionAdminApiClientParams): AuthClientConfig {
    return this.provisionAuthorizationCodeClient(this.adminApiClients, this.policies.adminApi, {
      flow:         'authorization_code',
      name:         `${AUTH_POLICY_ADMIN_API}_${config.name}`,
      permissions:  [Permission.ADMIN],
      groups:       this.authzConfig.adminGroups,
      callbackUrls: config.callbackUrls,
      logoutUrls:   config.logoutUrls,
    });
  }

  /** Provision the authorization-code OAuth client of an application that calls the JMAP API; one per name. */
  public provisionJmapApiClient(config: ProvisionJmapApiClientParams): AuthClientConfig {
    return this.provisionAuthorizationCodeClient(this.jmapApiClients, this.policies.jmapApi, {
      flow:         'authorization_code',
      name:         `${AUTH_POLICY_JMAP_API}_${config.name}`,
      permissions:  config.permissions,
      groups:       this.authzConfig.userGroups,
      callbackUrls: config.callbackUrls,
      logoutUrls:   config.logoutUrls,
    });
  }

  /**
   * Creates the admin API addon that manages the users of this pool and contributes `adminUiConfig()` to
   * the admin UI configuration.
   */
  public createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [
      new CognitoIdpUsersAdminApiAddon(scope, 'cognito-idp-users-admin-api', {
        artifactResolver:    this.artifacts,
        auditEventsQueue:    ctx.auditEventsQueue,
        identityProvisioner: ctx.identityProvisioner,
        pool:                this,
        uiConfig:            this.adminUiConfig(),
      }),
    ];
  }

  /**
   * Creates the addon that publishes the OIDC discovery document of the JMAP API (RFC 8414) and, per
   * `dynamicClientRegistration`, its registration endpoint. Returns no addon unless
   * `enableJmapOAuthDiscovery` is set.
   */
  public createJmapApiAddons(scope: Construct, ctx: JmapApiAddonContext): IJmapApiAddon[] {
    if (!this.enableJmapOAuthDiscovery) {
      return [];
    }

    return [
      new JmapOAuthAddon(scope, 'jmap-oauth-addon', {
        pool:                      this,
        artifactResolver:          this.artifacts,
        apiBaseUrl:                ctx.apiBaseUrl,
        identityProvisioner:       ctx.identityProvisioner,
        dynamicClientRegistration: this.dynamicClientRegistration,
      }),
    ];
  }

  /**
   * The issuer URL to advertise in the JMAP API's OAuth discovery document: the pool's `issuer` when
   * `enableJmapOAuthDiscovery` is set, `undefined` otherwise.
   */
  public jmapOAuthIssuerUrl(): string | undefined {
    if (!this.enableJmapOAuthDiscovery) {
      return undefined;
    }

    return this.issuer;
  }

  /**
   * The admin UI configuration this pool contributes: it names Cognito as the identity provider the
   * admin UI's users sign in with.
   */
  public adminUiConfig(): MailboxUserPoolAdminUiConfig {
    return { idp: { type: 'cognito' } };
  }

  /**
   * The Cognito groups that mark administrators and regular users, as set in the `authorization` prop
   * (`admin` and `user` where it is omitted).
   */
  public authorizationConfig(): CognitoIdpUsersAuthorizationConfig {
    return this.authzConfig;
  }

  /**
   * Attach a bootstrap user Custom Resource to this user pool.
   * The artifact resolver is shared with the rest of the user pool.
   *
   * When no temporary password is supplied, the custom resource generates one at deploy time
   * and exposes it through the returned handle for use in CloudFormation outputs.
   *
   * @param config Bootstrap user configuration
   * @returns Handle to the bootstrapped user resource, with access to the temporary password
   */
  public addBootstrapUser(config: BootstrapUserConfig): IBootstrapUserHandle {
    const index       = ++this.bootstrapUserCount;
    const constructId = `bootstrapped-user-${index}`;
    const handler     = new CognitoBootstrapUserLambda(this, `${constructId}-lambda`, {
      artifactResolver: this.artifacts,
      userPool:         this.userPool,
    });

    const properties: BootstrapUserProperties = {
      userPoolId:        this.userPoolId,
      username:          config.username,
      groups:            config.groups,
      temporaryPassword: config.temporaryPassword,
      // Force re-invocation when response contract changes (e.g., Data field added)
      responseContractVersion: '1',
    };
    const customResource                      = new CustomResource(this, constructId, {
      resourceType: 'Custom::CognitoBootstrapUser',
      serviceToken: handler.functionArn,
      properties,
      serviceTimeout: Duration.minutes(4),
    });

    return {
      temporaryPassword: customResource.getAttString('temporaryPassword'),
    };
  }

  /**
   * Grant a Lambda the permissions to administer users in this pool: list, create, delete, enable and
   * disable users, reset their passwords, and manage their group membership.
   */
  public grantAdminAccess(fn: lambda.IFunction): void {
    this.userPool.grant(
      fn,
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
    );
  }

  private buildPolicies(): MailboxAuthPolicies {
    return {
      adminApi: {
        audiences: [],
        // Cognito client_credentials tokens carry no group claim, so only user tokens can meet this.
        requireAnyOfGroups: this.authzConfig.adminGroups,
        requireAllScopes:   [this.toOAuthScope(Permission.ADMIN)],
      },
      jmapApi:  {
        audiences:        [],
        requireAllScopes: [],
      },
    };
  }

  private resolveCognitoDomainPrefix(domain: MailboxUserPoolDomainConfig): string {
    switch (domain.kind) {
      case 'cognito':
        return domain.cognitoDomainPrefix;
      case 'cognito-auto':
        return StackHelpers.getOrCreate(this, this.artifacts)
          .resolveCognitoDomainPrefix(this, 'domain-prefix', domain.hostedZone.zoneName);
      case 'custom':
        return Aws.STACK_NAME;
    }
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
    const isClientCredentials = params.flow === 'client_credentials';
    const clientKey           = slugifyLabel(params.name);
    const requestScopeList    = params.permissions.map((permission: Permission) => this.toOAuthScope(permission));

    const cfnClient = new cognito.CfnUserPoolClient(this, `user-pool-client-${clientKey}`, {
      userPoolId:                      this.userPoolId,
      clientName:                      `mailbox-client-${clientKey}`,
      explicitAuthFlows:               this.buildExplicitAuthFlows(),
      generateSecret:                  isClientCredentials,
      accessTokenValidity:             1,
      idTokenValidity:                 1,
      refreshTokenValidity:            30,
      tokenValidityUnits:              {
        accessToken:  'hours',
        idToken:      'hours',
        refreshToken: 'days',
      },
      preventUserExistenceErrors:      'ENABLED',
      supportedIdentityProviders:      this.supportedIdentityProviders.map(provider => provider.name),
      allowedOAuthFlows:               isClientCredentials ? ['client_credentials'] : ['code'],
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthScopes:              [
        ...(isClientCredentials ? [] : ['openid', 'email', 'profile']),
        ...requestScopeList,
      ],
      ...(isClientCredentials
        ? {}
        : {
          callbackUrLs: params.callbackUrls,
          logoutUrLs:   params.logoutUrls,
        }),
    });

    return {
      clientId:     cfnClient.ref,
      clientSecret: isClientCredentials ? SecretValue.unsafePlainText(cfnClient.attrClientSecret) : undefined,
      requestScopeList,
      groups: params.groups ?? [],
    };
  }

  private createHeadlessClient(config: ProvisionHeadlessClientConfig): AuthClientConfig {
    const client = this.createOAuthClient({
      flow:        'client_credentials',
      name:        config.name,
      permissions: config.permissions,
    });
    this.headlessClients.set(config.name, client);
    return client;
  }

  private provisionAuthorizationCodeClient(
    clients: Map<string, AuthClientConfig>,
    policy: AuthPolicyConfig,
    params: AuthorizationCodeClientParams,
  ): AuthClientConfig {
    const existing = clients.get(params.name);
    if (existing) {
      return existing;
    }

    const client = this.createOAuthClient(params);
    this.addAudience(policy, client.clientId);
    clients.set(params.name, client);

    return client;
  }

  private addAudiences(audiences: UserPoolAudience[], clientId: string): void {
    for (const audience of audiences) {
      if (audience === UserPoolAudience.ADMIN_API) {
        this.addAudience(this.policies.adminApi, clientId);
      } else {
        this.addAudience(this.policies.jmapApi, clientId);
      }
    }
  }

  private addAudience(policy: AuthPolicyConfig, clientId: string): void {
    if (!policy.audiences.includes(clientId)) {
      policy.audiences.push(clientId);
    }
  }

  private toOAuthScope(permission: Permission): string {
    return this.toOAuthScopeName(PermissionToCognitoScope[permission]);
  }

  private toOAuthScopeName(cognitoScope: CognitoScope): string {
    return `${RESOURCE_SERVER_IDENTIFIER}/${cognitoScope}`;
  }

  private buildScopeMap(): ScopeMap {
    const scopeMap: ScopeMap = {};

    for (const cognitoScope of Object.values(CognitoScope)) {
      scopeMap[this.toOAuthScopeName(cognitoScope)] = CognitoScopeToPermissions[cognitoScope];
    }

    return scopeMap;
  }
}
