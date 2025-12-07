import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class UserPool extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  get issuer(): string {
    return `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`;
  }

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create Cognito User Pool
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
          required: false, // Optional recovery email
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
      mfa: cognito.Mfa.OPTIONAL, // Users can enable MFA if desired
      mfaSecondFactor: {
        sms: false, // Disable SMS (expensive and less secure)
        otp: true, // Enable TOTP (Google Authenticator, Authy, etc.)
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Protect user data in production
      // No lambda triggers - users created via IDP claims on first login
    });

    // Create Resource Server for JMAP API scopes
    const scopeCore = { scopeName: 'core', scopeDescription: 'Core JMAP operations' };
    const scopeMail = { scopeName: 'mail', scopeDescription: 'Email operations' };
    const scopeSubmission = { scopeName: 'submission', scopeDescription: 'Email submission and identity management' };
    const scopeUpload = { scopeName: 'upload', scopeDescription: 'Blob upload operations' };
    const scopeUser = { scopeName: 'user', scopeDescription: 'User management' };
    const scopeAccount = { scopeName: 'account', scopeDescription: 'Account management' };
    const scopeAlias = { scopeName: 'alias', scopeDescription: 'Alias management' };
    const scopeCalendar = { scopeName: 'calendar', scopeDescription: 'Calendar operations (future)' };
    const scopeContacts = { scopeName: 'contacts', scopeDescription: 'Contacts operations (future)' };

    const jmapResourceServer = this.userPool.addResourceServer('JMapResourceServer', {
      identifier: 'jmap-api',
      userPoolResourceServerName: 'JMAP API',
      scopes: [
        scopeCore,
        scopeMail,
        scopeSubmission,
        scopeUpload,
        scopeUser,
        scopeAccount,
        scopeAlias,
        scopeCalendar,
        scopeContacts,
      ],
    });

    // Create User Pool Client for the application
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'mailbox-client', // Add explicit name to force update
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false, // Public client (no secret for web/mobile apps)
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
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeCore),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeMail),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeSubmission),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeUpload),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeUser),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeAccount),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeAlias),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeCalendar),
          cognito.OAuthScope.resourceServer(jmapResourceServer, scopeContacts),
        ],
        callbackUrls: [
          'http://localhost:3000/',
          'http://localhost:4321/auth/callback',
        ],
        logoutUrls: [
          'http://localhost:3000/',
          'http://localhost:4321/',
        ],
      },
    });

    const stack = cdk.Stack.of(this);
    // Add Cognito domain for hosted UI
    const domainPrefix = `${stack.account}-${stack.stackName}-auth`;
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomainV2', {
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });

    this.userPool.addGroup("admin", {
      groupName: "admin",      
    })

    // Output important values
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'UserPoolIssuer', {
      value: `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito JWT Issuer URL',
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
    });

    new cdk.CfnOutput(this, 'HostedUIUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
      description: 'Cognito Hosted UI URL',
    });
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
