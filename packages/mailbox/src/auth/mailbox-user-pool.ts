import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { JMAP_SCOPE_DESCRIPTIONS, Permission } from '../utils/jmap-scopes';
import { IAuthClientConfig, IAuthConfig, IGenerateClientParams } from './IAuthConfig';
import { PermissionToCognitoScope } from './scopemaps/cognito';

/**
 * Cognito-managed domain configuration
 */
export interface MailboxUserPoolCognitoDomain {
  type: 'cognito';
  /** Domain prefix (globally unique across AWS) */
  cognitoDomainPrefix: string;
}

/**
 * Custom domain configuration with certificate
 */
export interface MailboxUserPoolCustomDomain {
  type: 'custom';
  /** Custom domain name */
  domainName: string;
  /** ACM certificate for the domain */
  certificate: acm.ICertificate;
}

/**
 * Domain configuration for the user pool
 * Must be either Cognito-managed or custom, never both
 */
export type MailboxUserPoolDomain = MailboxUserPoolCognitoDomain | MailboxUserPoolCustomDomain;

export interface MailboxUserPoolProps {
  /**
   * OAuth callback URLs for your application
   * @example ['https://example.com/auth/callback', 'http://localhost:3000/']
   */
  callbackUrls: string[];

  /**
   * OAuth logout URLs for your application
   * @example ['https://example.com/', 'http://localhost:3000/']
   */
  logoutUrls: string[];

  /**
   * Domain configuration - either Cognito-managed or custom
   * @example { type: 'cognito', cognitoDomainPrefix: 'my-auth' }
   * @example { type: 'custom', domainName: 'auth.example.com', certificate: cert }
   */
  domain: MailboxUserPoolDomain;

  /**
   * JMAP scopes to enable on this user pool
   * @default getJmapScopeDefinitions() (all fine-grained scopes)
   */
  jmapScopes?: Permission[];

  /**
   * Whether to add admin and user groups
   * @default true
   */
  createDefaultGroups?: boolean;

  authFlows?: cdk.aws_cognito.AuthFlow
}

/**
 * Opinionated JMAP user pool construct for mailbox servers
 *
 * Ships with:
 * - Predefined JMAP scopes (core, mail, submission, upload, user, account, alias, calendar, contacts)
 * - Default groups (admin, user)
 * - Sensible password policy & MFA configuration
 *
 * Requires user to provide:
 * - Callback and logout URLs (no hardcoded defaults)
 * - Domain configuration (Cognito-managed or custom)
 * @example
 * ```typescript
 * new MailboxUserPool(this, 'Auth', {
 *   callbackUrls: ['https://example.com/auth/callback'],
 *   logoutUrls: ['https://example.com/'],
 *   domain: { type: 'cognito', cognitoDomainPrefix: 'my-mailbox-auth' },
 * });
 * ```
 *
 * @example
 * ```typescript
 * new MailboxUserPool(this, 'Auth', {
 *   callbackUrls: ['https://example.com/auth/callback'],
 *   logoutUrls: ['https://example.com/'],
 *   domain: { type: 'custom', domainName: 'auth.example.com', certificate: cert },
 * });
 * ```
 */
export class MailboxUserPool extends Construct implements IAuthConfig {
  public readonly userPool: cognito.UserPool;
  public readonly webmailUserPoolClient: cognito.UserPoolClient;
  public readonly adminUserPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  private readonly jmapScopes: Permission[];
  private readonly resourceServerIdentifier: string = 'si';

  private authFlows: cdk.aws_cognito.AuthFlow;

  public readonly scopeMap: Record<string, Permission[]>;
  public readonly oauthDomain: string;
  public readonly issuer: string
  public readonly authMethod = 'form';
  public readonly usePkce = true;
  public readonly clientIds: string[] = [];

  get tokenEndpoint(): string {
    return `https://${this.oauthDomain}/oauth2/token`;
  }

  get authorizationEndpoint(): string {
    return `https://${this.oauthDomain}/oauth2/authorize`;
  }

  generateClient(params: IGenerateClientParams): IAuthClientConfig {
    const scopes = params.permissions.map((scope: Permission) => ({
        scopeName: `${this.resourceServerIdentifier}/${PermissionToCognitoScope[scope]}`,
        scopeDescription: JMAP_SCOPE_DESCRIPTIONS[scope],
    }))

    const client = new cognito.UserPoolClient(this, 'UserPoolClient-' + params.name, {
      userPool: this.userPool,
      userPoolClientName: 'mailbox-client-' + params.name,
      authFlows: this.authFlows,
      generateSecret: params.generateSecret,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          ...scopes,
        ],
        callbackUrls: params.callbackUrls,
        logoutUrls: params.logoutUrls,
      },
    });

    this.clientIds.push(client.userPoolClientId);

    // Build the scope list for only the requested permissions
    const requestedScopeList = params.permissions.map((permission: Permission) => {
      const scopeNameForOAuth = PermissionToCognitoScope[permission].replace(/\//g, '.');
      return `${this.resourceServerIdentifier}/${scopeNameForOAuth}`;
    });

    return {
      clientId: client.userPoolClientId,
      clientSecret: client.userPoolClientSecret,
      requestScopeList: requestedScopeList,
      groups: params.groups,
    };
  }

  constructor(scope: Construct, id: string, props: MailboxUserPoolProps) {
    super(scope, id);

    this.authFlows = props.authFlows ?? {
      userPassword: false,
      userSrp: false,
    };

    this.jmapScopes = props.jmapScopes ?? Object.values(Permission);
    const createGroups = props.createDefaultGroups ?? true;

    // Build scope map - maps full OAuth scope identifiers to JmapScopeName values
    this.scopeMap = this.buildScopeMap();

    // Create Cognito User Pool with mailbox defaults
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'mailbox-users',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.issuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`;

    // Create JMAP Resource Server with fine-grained scopes
    // Note: Cognito requires scope names to use "." instead of "/" (e.g., "mail.read" not "mail/read")
    const jmapResourceServer = this.userPool.addResourceServer('JMapResourceServer', {
      identifier: this.resourceServerIdentifier,
      userPoolResourceServerName: 'JMAP API',
      scopes: this.jmapScopes.map((scope: Permission) => ({
        scopeName: scope.replace(/\//g, '.'),  // Convert "/" to "." for Cognito
        scopeDescription: JMAP_SCOPE_DESCRIPTIONS[scope],
      })),
    });

    // Create User Pool Client with JMAP OAuth scopes
    const jmapOAuthScopes = this.jmapScopes.map((scope: Permission) =>
      cognito.OAuthScope.resourceServer(jmapResourceServer, {
        scopeName: scope.replace(/\//g, '.'),  // Convert "/" to "." for Cognito
        scopeDescription: JMAP_SCOPE_DESCRIPTIONS[scope],
      })
    );

    this.webmailUserPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'mailbox-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          ...jmapOAuthScopes,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
    });

    // Create Admin User Pool Client (confidential client with client secret)
    this.adminUserPoolClient = new cognito.UserPoolClient(this, 'AdminUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'mailbox-admin-client',
      authFlows: {
        userPassword: false,
        userSrp: false,
      },
      generateSecret: true, // Confidential client with secret
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(7), // Shorter refresh for admin
      preventUserExistenceErrors: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true, // Only authorization code grant
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
    });

    // Add domain (Cognito-managed or custom)
    if (props.domain.type === 'custom') {
      this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
        customDomain: {
          domainName: props.domain.domainName,
          certificate: props.domain.certificate,
        },
      });
      this.oauthDomain = props.domain.domainName;
    } else {
      this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
        cognitoDomain: {
          domainPrefix: props.domain.cognitoDomainPrefix,
        },
      });
      this.oauthDomain = `${props.domain.cognitoDomainPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`;
    }

    // Create default groups
    if (createGroups) {
      this.userPool.addGroup('admin', {
        groupName: 'admin',
      });
      this.userPool.addGroup('user', {
        groupName: 'user',
      });
    }
  }

  /**
   * Build the OAuth scope map dynamically from the resource server identifier and scope definitions
   * Maps full OAuth scope identifiers (e.g., 'jmap-api/mail.read') to JmapScopeName values
   */
  private buildScopeMap(): Record<string, Permission[]> {
    const scopeMap: Record<string, Permission[]> = {};
    
    for (const scope of this.jmapScopes) {
      // Use dot notation for OAuth scope name (Cognito requirement)
      const scopeNameForOAuth = scope.replace(/\//g, '.');
      const fullScopeName = `${this.resourceServerIdentifier}/${scopeNameForOAuth}`;
      
      scopeMap[fullScopeName] = [scope];
    }
    
    return scopeMap;
  }

  /**
   * Grant admin-level Cognito permissions to a Lambda function
   * Allows creating, updating, and deleting users
   */
  public grantAdminAccess(fn: lambda.IFunction): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
        ],
        resources: [this.userPool.userPoolArn],
      })
    );
  }
}
