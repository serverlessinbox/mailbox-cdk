/// <reference types="jest" />

/**
 * Pins what the IdP users addon gives the admin API and its Lambda: the route behind the authorizer, and the
 * groups of the user pool handed to the Lambda. The route decides what the API exposes and under which path, and
 * the groups decide how the Lambda reads the roles of a caller. The UI config the addon publishes is tested beside it.
 */

import { ArtifactZone, PinnedArtifactResolver }                                                                    from '@serverlessinbox/artifact-registry-cdk';
import { MailboxArtifactResolverFactory }                                                                          from '@serverlessinbox/mailbox-cdk-shared';
import { Mailbox }                                                                                                 from '@serverlessinbox/mailbox';
import type { IAuditEventsQueue, IIdentityProvisioner }                                                            from '@serverlessinbox/mailbox';
import type { MailboxAuthorizationConfig }                                                                         from '@serverlessinbox/mailbox';
import { Match, Template }                                                                                         from 'aws-cdk-lib/assertions';
import { HttpMethod }                                                                                              from 'aws-cdk-lib/aws-apigatewayv2';
import { UserPool }                                                                                                from 'aws-cdk-lib/aws-cognito';
import { App, BootstraplessSynthesizer, Stack }                                                                    from 'aws-cdk-lib';
import * as t                                                                                                      from 'typanion';

import { CognitoIdpUsersAdminApiAddon }                                                                            from '../cognito-idp-users-addon';
import type { ICognitoIdpUsersPoolConfig }                                                                         from '../cognito-idp-users-pool-config';
import { loadMailboxCognitoArtifactVersions }                                                                      from '../mailbox-cognito-artifact-versions';
import { loadMailboxCognitoRegistryRecord }                                                                        from '../mailbox-cognito-registry-record';
import { MailboxUserPool }                                                                                         from '../user-pool/mailbox-user-pool';

const isReference = t.isPartial({ Ref: t.isString() });

const isRouteProperties = t.isPartial({
  RouteKey:          t.isString(),
  ApiId:             isReference,
  AuthorizationType: t.isOptional(t.isString()),
  AuthorizerId:      t.isOptional(isReference),
});

type RouteProperties = t.InferType<typeof isRouteProperties>;

const USER_POOL_ARN ='arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_abcdefgh';
const USER_POOL_ID  = 'us-west-2_abcdefgh';

describe('CognitoIdpUsersAdminApiAddon', () => {
  const auditEventsQueue: IAuditEventsQueue       = {
    queueUrl:  'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
    queueArn:  'arn:aws:sqs:us-west-2:123456789012:audit-events',
    grantSend: () => {},
  };
  const identityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  () => {},
  };

  function createAddon(stack: Stack, options: { authorization?: MailboxAuthorizationConfig; basePath?: string }): CognitoIdpUsersAdminApiAddon {
    const { authorization }                = options;
    const artifactResolver                 = new PinnedArtifactResolver({
      packages:         { 'mailbox-cognito': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
    const pool: ICognitoIdpUsersPoolConfig = {
      userPool:         UserPool.fromUserPoolArn(stack, 'user-pool', USER_POOL_ARN),
      grantAdminAccess: () => {},
      ...(authorization ? { authorizationConfig: () => authorization } : {}),
    };

    return new CognitoIdpUsersAdminApiAddon(stack, 'addon', { artifactResolver, auditEventsQueue, identityProvisioner, pool, basePath: options.basePath });
  }

  function newStack(): Stack {
    return new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  function synthesize(options: { authorization?: MailboxAuthorizationConfig }): Template {
    const stack = newStack();

    createAddon(stack, options);

    return Template.fromStack(stack);
  }

  it('hands the Lambda the groups of the user pool as JSON arrays', () => {
    const template = synthesize({ authorization: { adminGroups: ['admin'], userGroups: ['user', 'viewer'] } });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { USER_POOL_ID, ADMIN_GROUPS: '["admin"]', USER_GROUPS: '["user","viewer"]' } },
    });
  });

  it.each(['ADMIN_GROUPS', 'USER_GROUPS'])('hands the Lambda no %s variable when the user pool offers no authorization config', (variable) => {
    const template = synthesize({});

    template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: { USER_POOL_ID } } });
    const lambdasWithVariable = template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: { USER_POOL_ID, [variable]: Match.anyValue() } } },
    });
    expect(Object.keys(lambdasWithVariable)).toHaveLength(0);
  });

  it.each([
    { basePath: undefined, expectedBasePath: '/idp-users' },
    { basePath: '/custom/idp-api/v2', expectedBasePath: '/custom/idp-api/v2' },
  ])('asks the Admin API to route POST under $expectedBasePath to its Lambda', ({ basePath, expectedBasePath }) => {
    const addon = createAddon(newStack(), { basePath });

    expect(addon.routeSpec).toEqual({ basePath: expectedBasePath, methods: [HttpMethod.POST], handler: addon.lambdaFunction });
  });

  it('is routed behind the authorizer of the Admin API when a Mailbox mounts it', () => {
    const template = synthesizeMailboxWithUserPool();

    const routes       = routesOf(template);
    const route        = routes.find((candidate) => candidate.RouteKey === 'POST /idp-users/{proxy+}');
    const handlerRoute = routes.find((candidate) => candidate.RouteKey === 'POST /{proxy+}' && JSON.stringify(candidate.ApiId) === JSON.stringify(route?.ApiId));

    expect(route?.AuthorizationType).toBe('CUSTOM');
    expect(route?.AuthorizerId).toBeDefined();
    expect(route?.AuthorizerId).toEqual(handlerRoute?.AuthorizerId);
  });

  function routesOf(template: Template): RouteProperties[] {
    return Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((resource) => {
      const properties: unknown = resource.Properties;
      const errors: string[]    = [];

      if (!isRouteProperties(properties, { errors })) {
        throw new Error(`Unexpected route properties: ${errors.join('; ')}`);
      }

      return properties;
    });
  }

  function synthesizeMailboxWithUserPool(): Template {
    const app = new App();
    app.node.setContext('serverlessinbox:artifact_versions', {});
    app.node.setContext('serverlessinbox:artifacts', {
      bucketBase: 'test-artifacts',
      packages:   Object.fromEntries(
        ['mailbox-go', 'mailbox-cdk', 'mailbox-cdk-shared', 'mailbox-admin-ui', 'mailbox-webmail-ui', 'mailbox-cognito', 'mailbox']
          .map((name) => [name, { zone: 'regional', version: '1.0.0' }]),
      ),
    });
    const stack    = new Stack(app, 'TestMailboxStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const resolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());
    const pool     = new MailboxUserPool(stack, 'user-pool', {
      domain:           { kind: 'cognito', cognitoDomainPrefix: 'test-idp-users' },
      artifactResolver: resolver,
    });
    new Mailbox(stack, 'mailbox', { authProvider: pool });

    return Template.fromStack(stack);
  }
});
