/**
 * MailboxUserPool's own behaviour: the artifacts its sub-constructs resolve, how its domain setting reaches
 * the deployer, the OAuth clients it provisions, and the audiences, scopes and groups its policies carry.
 *
 * With no injected resolver the pool builds its own from the versions shipped with the package, overridden by
 * CDK context; with an injected resolver, every package its sub-constructs resolve must be pinned on it.
 *
 * An OAuth client with the wrong flow or scope, or one missing from an API's audiences, deploys cleanly and is
 * refused by the API only at runtime, so these tests pin the synthesized clients and the policies.
 */

import { ArtifactZone, PinnedArtifactResolver }   from '@serverlessinbox/artifact-registry-cdk';
import { Permission }                             from '@serverlessinbox/mailbox';
import { Match, Template }                        from 'aws-cdk-lib/assertions';
import * as lambda                                from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }   from 'aws-cdk-lib';

import { MailboxUserPool, MailboxUserPoolProps }  from '../mailbox-user-pool';
import { MfaMode }                                from '../mfa-mode';
import { UserPoolAudience }                       from '../user-pool-audience';

const PINNED_VERSION = '0.0.1-test';

function newStack(app: App = new App()): Stack {
  return new Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function pinnedResolver(stack: Stack, packageNames: string[]): PinnedArtifactResolver {
  return new PinnedArtifactResolver({
    packages:         Object.fromEntries(packageNames.map(name => [name, { zone: ArtifactZone.REGIONAL, version: PINNED_VERSION }])),
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

/** A pool with an explicit Cognito domain prefix and a resolver pinning both packages the pool resolves; `overrides` replace those props. */
function createUserPool(overrides: Partial<MailboxUserPoolProps> = {}): { pool: MailboxUserPool; stack: Stack } {
  const stack = newStack();
  const pool  = new MailboxUserPool(stack, 'user-pool', {
    domain:           { kind: 'cognito', cognitoDomainPrefix: 'test-prefix' },
    artifactResolver: pinnedResolver(stack, ['mailbox-cognito', 'mailbox-cdk-shared']),
    ...overrides,
  });
  return { pool, stack };
}

describe('MailboxUserPool without an injected artifactResolver', () => {
  function synthesizeWithPinnedContext(): Template {
    const app = new App();
    app.node.setContext('serverlessinbox:artifacts', {
      bucketBase: 'test-artifacts',
      packages:   {
        'mailbox-cognito':    { zone: 'regional', version: PINNED_VERSION },
        'mailbox-cdk-shared': { zone: 'regional', version: PINNED_VERSION },
      },
    });
    app.node.setContext('serverlessinbox:artifact_versions', {});
    const stack = newStack(app);

    new MailboxUserPool(stack, 'user-pool', {
      domain: { kind: 'cognito', cognitoDomainPrefix: 'test-prefix' },
    });

    return Template.fromStack(stack);
  }

  it('synthesizes the stack deployer Lambdas from the mailbox-cdk-shared package', () => {
    const template = synthesizeWithPinnedContext();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('mailbox-cdk-shared/.*/lambdas/stack-deployer\\.zip') },
    });
  });
});

describe('MailboxUserPool with an injected artifactResolver', () => {
  it('fails to synthesize naming the package the resolver holds no pin for', () => {
    const stack                        = newStack();
    const resolverWithoutSharedPackage = pinnedResolver(stack, ['mailbox-cognito']);

    expect(() => {
      new MailboxUserPool(stack, 'user-pool', {
        domain:           { kind: 'cognito', cognitoDomainPrefix: 'test-prefix' },
        artifactResolver: resolverWithoutSharedPackage,
      });
    }).toThrow("No resolved data for package 'mailbox-cdk-shared'");
  });
});

describe('MailboxUserPool domain', () => {
  it('hands an explicit Cognito domain prefix to the deployer', () => {
    const { stack } = createUserPool({ domain: { kind: 'cognito', cognitoDomainPrefix: 'explicit-prefix' } });

    Template.fromStack(stack).hasResourceProperties('Custom::MailboxCognitoDataDeployer', {
      parameters: Match.objectLike({ cognitoDomainPrefix: 'explicit-prefix' }),
    });
  });

  it('hands a custom domain and its certificate to the deployer and names the Cognito prefix after the stack', () => {
    const { stack } = createUserPool({
      domain: { kind: 'custom', domainName: 'auth.example.com', certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc' },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::MailboxCognitoDataDeployer', {
      parameters: Match.objectLike({
        cognitoDomainPrefix: { Ref: 'AWS::StackName' },
        customDomainName:    'auth.example.com',
        customDomainCertArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
      }),
    });
  });
});

describe('MailboxUserPool UI client provisioning', () => {
  it('names an Admin-API client after its kind and app: ADMIN_API_admin-ui', () => {
    const { pool, stack } = createUserPool();

    pool.provisionAdminApiClient({ name: 'admin-ui', callbackUrls: ['https://a.example.com/cb'], logoutUrls: ['https://a.example.com/'] });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mailbox-client-admin-api-admin-ui',
    });
  });

  it('names a JMAP-API client after its kind and app: JMAP_API_webmail-ui', () => {
    const { pool, stack } = createUserPool();

    pool.provisionJmapApiClient({
      name:         'webmail-ui',
      permissions:  [Permission.MAIL_READ],
      callbackUrls: ['https://w.example.com/cb'],
      logoutUrls:   ['https://w.example.com/'],
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mailbox-client-jmap-api-webmail-ui',
    });
  });

  it('gives an Admin-API client the code flow, the admin scope and its callback URLs, without a secret', () => {
    const { pool, stack } = createUserPool();

    pool.provisionAdminApiClient({ name: 'admin-ui', callbackUrls: ['https://a.example.com/cb'], logoutUrls: ['https://a.example.com/'] });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret:     false,
      AllowedOAuthFlows:  ['code'],
      AllowedOAuthScopes: ['openid', 'email', 'profile', 'si/admin'],
      CallbackURLs:       ['https://a.example.com/cb'],
      LogoutURLs:         ['https://a.example.com/'],
    });
  });

  it('gives a JMAP-API client exactly the scopes of the permissions it asks for', () => {
    const { pool, stack } = createUserPool();

    const client = pool.provisionJmapApiClient({
      name:         'webmail-ui',
      permissions:  [Permission.MAIL_READ, Permission.MAIL_SEND],
      callbackUrls: ['https://w.example.com/cb'],
      logoutUrls:   ['https://w.example.com/'],
    });

    expect(client.requestScopeList).toEqual(['si/mail.read', 'si/mail.send']);
    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AllowedOAuthScopes: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.send'],
    });
  });

  it('registers each UI client as an audience of its own API only', () => {
    const { pool } = createUserPool();

    const adminClient = pool.provisionAdminApiClient({ name: 'admin-ui', callbackUrls: [], logoutUrls: [] });
    const jmapClient  = pool.provisionJmapApiClient({ name: 'webmail-ui', permissions: [Permission.MAIL_READ], callbackUrls: [], logoutUrls: [] });

    expect(pool.policies.adminApi.audiences).toEqual([adminClient.clientId]);
    expect(pool.policies.jmapApi.audiences).toEqual([jmapClient.clientId]);
  });

  it('returns the existing client when the same app is provisioned twice', () => {
    const { pool, stack } = createUserPool();
    const config          = { name: 'admin-ui', callbackUrls: ['https://a.example.com/cb'], logoutUrls: ['https://a.example.com/'] };

    const first  = pool.provisionAdminApiClient(config);
    const second = pool.provisionAdminApiClient(config);

    expect(second).toBe(first);
    Template.fromStack(stack).resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  it('enables an identity provider registered once on every client created afterwards', () => {
    const { pool, stack } = createUserPool();

    pool.addSupportedIdentityProvider('Google');
    pool.addSupportedIdentityProvider('Google');
    pool.provisionAdminApiClient({ name: 'admin-ui', callbackUrls: [], logoutUrls: [] });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      SupportedIdentityProviders: ['COGNITO', 'Google'],
    });
  });
});

describe('MailboxUserPool headless client provisioning', () => {
  it('creates a client-credentials client with a secret, its scopes and no sign-in URLs', () => {
    const { pool, stack } = createUserPool();

    pool.provisionHeadlessClient({ name: 'sweeper', audiences: [UserPoolAudience.JMAP_API], permissions: [Permission.MAIL_READ] });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName:         'mailbox-client-sweeper',
      GenerateSecret:     true,
      AllowedOAuthFlows:  ['client_credentials'],
      AllowedOAuthScopes: ['si/mail.read'],
      CallbackURLs:       Match.absent(),
      LogoutURLs:         Match.absent(),
    });
  });

  it('registers the client as an audience of the listed APIs only', () => {
    const { pool } = createUserPool();

    const client = pool.provisionHeadlessClient({ name: 'sweeper', audiences: [UserPoolAudience.JMAP_API], permissions: [Permission.MAIL_READ] });

    expect(pool.policies.jmapApi.audiences).toEqual([client.clientId]);
    expect(pool.policies.adminApi.audiences).toEqual([]);
  });

  it('registers the client for the audience strings a CloudFormation parameter carries', () => {
    const { pool } = createUserPool();
    const audience = 'adminApi' as UserPoolAudience;

    const client = pool.provisionHeadlessClient({ name: 'sweeper', audiences: [audience], permissions: [Permission.MAIL_READ] });

    expect(pool.policies.adminApi.audiences).toEqual([client.clientId]);
    expect(pool.policies.jmapApi.audiences).toEqual([]);
  });

  it('returns the existing client when the name is provisioned again and registers the audiences it is now listed for', () => {
    const { pool, stack } = createUserPool();

    const first  = pool.provisionHeadlessClient({ name: 'sweeper', audiences: [UserPoolAudience.JMAP_API], permissions: [Permission.MAIL_READ] });
    const second = pool.provisionHeadlessClient({ name: 'sweeper', audiences: [UserPoolAudience.ADMIN_API], permissions: [Permission.MAIL_READ] });

    expect(second).toBe(first);
    expect(pool.policies.adminApi.audiences).toEqual([first.clientId]);
    Template.fromStack(stack).resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });
});

describe('MailboxUserPool authorization', () => {
  it('rejects an explicit empty adminGroups list, naming the prop, rather than gating the Admin API on no group', () => {
    expect(() => createUserPool({ authorization: { adminGroups: [] } })).toThrow(/authorization\.adminGroups is an empty list/);
  });

  it('requires the admin scope and the default admin group for the Admin API, and no scope for the JMAP API', () => {
    const { pool } = createUserPool();

    expect(pool.policies.adminApi.requireAllScopes).toEqual(['si/admin']);
    expect(pool.policies.adminApi.requireAnyOfGroups).toEqual(['admin']);
    expect(pool.policies.jmapApi.requireAllScopes).toEqual([]);
  });

  it('takes the groups of the policies, of the clients and of the authorization config from the authorization prop', () => {
    const { pool } = createUserPool({ authorization: { adminGroups: ['ops'], userGroups: ['staff'] } });

    const adminClient = pool.provisionAdminApiClient({ name: 'admin-ui', callbackUrls: [], logoutUrls: [] });
    const jmapClient  = pool.provisionJmapApiClient({ name: 'webmail-ui', permissions: [Permission.MAIL_READ], callbackUrls: [], logoutUrls: [] });

    expect(pool.policies.adminApi.requireAnyOfGroups).toEqual(['ops']);
    expect(adminClient.groups).toEqual(['ops']);
    expect(jmapClient.groups).toEqual(['staff']);
    expect(pool.authorizationConfig()).toEqual({ adminGroups: ['ops'], userGroups: ['staff'] });
  });

  it('prefixes every scope in the scope map with the resource server and maps it to its permission', () => {
    const { pool } = createUserPool();

    expect(pool.scopeMap['si/mail.read']).toEqual([Permission.MAIL_READ]);
    expect(pool.scopeMap['si/admin']).toEqual([Permission.ADMIN]);
    expect(Object.keys(pool.scopeMap).every(scope => scope.startsWith('si/'))).toBe(true);
  });
});

describe('MailboxUserPool MFA mode', () => {
  it('hands the deployer the mfaMode string a CloudFormation parameter carries', () => {
    const { stack } = createUserPool({ mfaMode: MfaMode.ON });

    Template.fromStack(stack).hasResourceProperties('Custom::MailboxCognitoDataDeployer', {
      parameters: Match.objectLike({ mfaMode: 'on' }),
    });
  });

});

describe('MailboxUserPool OAuth endpoints', () => {
  it('serves the token and authorization endpoints from the OAuth domain', () => {
    const { pool } = createUserPool();

    expect(pool.tokenEndpoint).toBe(`https://${pool.oauthDomain}/oauth2/token`);
    expect(pool.authorizationEndpoint).toBe(`https://${pool.oauthDomain}/oauth2/authorize`);
  });
});

describe('MailboxUserPool admin UI config', () => {
  it('names Cognito as the identity provider', () => {
    const { pool } = createUserPool();

    expect(pool.adminUiConfig()).toEqual({ idp: { type: 'cognito' } });
  });
});

describe('MailboxUserPool JMAP OAuth discovery', () => {
  it('publishes no issuer URL unless discovery is enabled', () => {
    const { pool } = createUserPool();

    expect(pool.jmapOAuthIssuerUrl()).toBeUndefined();
  });

  it('publishes the pool issuer when discovery is enabled', () => {
    const { pool } = createUserPool({ enableJmapOAuthDiscovery: true });

    expect(pool.jmapOAuthIssuerUrl()).toBe(pool.issuer);
  });
});

describe('MailboxUserPool.grantAdminAccess', () => {
  it('grants the function user administration on the pool itself, never on every resource', () => {
    const { pool, stack } = createUserPool();
    const adminLambda     = new lambda.Function(stack, 'fn', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code:    lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    pool.grantAdminAccess(adminLambda);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action:   Match.arrayWith(['cognito-idp:ListUsers', 'cognito-idp:AdminDeleteUser']),
            Resource: Match.not('*'),
          }),
        ]),
      },
    });
  });

  it('grants exactly the Cognito actions the users Lambda calls', () => {
    const { pool, stack } = createUserPool();
    const usersLambda     = new lambda.Function(stack, 'users-lambda', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code:    lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    pool.grantAdminAccess(usersLambda);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayEquals([
              'cognito-idp:ListUsers',
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminDeleteUser',
              'cognito-idp:AdminSetUserPassword',
              'cognito-idp:AdminGetUser',
              'cognito-idp:AdminDisableUser',
              'cognito-idp:AdminEnableUser',
              'cognito-idp:AdminAddUserToGroup',
            ]),
          }),
        ]),
      },
    });
  });
});
