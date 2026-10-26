/// <reference types="jest" />

/**
 * Pins what the IdP users addon passes on: the route it asks the admin API to mount, the groups of the user pool it
 * hands to its Lambda, and the `idp.users` fragment it merges into the admin UI config.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { IAuditEventsQueue, IIdentityProvisioner } from '@serverlessinbox/mailbox';
import type { MailboxAuthorizationConfig }              from '@serverlessinbox/mailbox';
import { Template }                                     from 'aws-cdk-lib/assertions';
import { HttpMethod }                                   from 'aws-cdk-lib/aws-apigatewayv2';
import { UserPool }                                     from 'aws-cdk-lib/aws-cognito';
import { App, BootstraplessSynthesizer, Stack }         from 'aws-cdk-lib';

import { CognitoIdpUsersAdminApiAddon }                 from '../cognito-idp-users-addon';
import type { ICognitoIdpUsersPoolConfig }              from '../cognito-idp-users-pool-config';
import type { MailboxUserPoolAdminUiConfig }            from '../user-pool/mailbox-user-pool-admin-ui-config';

const USER_POOL_ARN = 'arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_abcdefgh';
const USER_POOL_ID  = 'us-west-2_abcdefgh';

interface AddonOptions {
  readonly authorization?: MailboxAuthorizationConfig;
  readonly basePath?:      string;
  readonly uiConfig?:      MailboxUserPoolAdminUiConfig;
}

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

  function createAddon(stack: Stack, options: AddonOptions): CognitoIdpUsersAdminApiAddon {
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

    return new CognitoIdpUsersAdminApiAddon(stack, 'addon', {
      artifactResolver, auditEventsQueue, identityProvisioner, pool, basePath: options.basePath, uiConfig: options.uiConfig,
    });
  }

  function newStack(): Stack {
    return new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  it('hands the Lambda the groups of the user pool authorization config', () => {
    const stack = newStack();

    createAddon(stack, { authorization: { adminGroups: ['admin'], userGroups: ['user', 'viewer'] } });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { USER_POOL_ID, ADMIN_GROUPS: '["admin"]', USER_GROUPS: '["user","viewer"]' } },
    });
  });

  it.each([
    { basePath: undefined, expectedBasePath: '/idp-users' },
    { basePath: '/custom/idp-api/v2', expectedBasePath: '/custom/idp-api/v2' },
  ])('asks the Admin API to route POST under $expectedBasePath to its Lambda', ({ basePath, expectedBasePath }) => {
    const addon = createAddon(newStack(), { basePath });

    expect(addon.routeSpec).toEqual({ basePath: expectedBasePath, methods: [HttpMethod.POST], handler: addon.lambdaFunction });
  });

  describe('uiConfig', () => {
    it('advertises the base path the addon is mounted under next to the idp type of the provider', () => {
      const addon = createAddon(newStack(), { basePath: '/mine', uiConfig: { idp: { type: 'cognito' } } });

      expect(addon.uiConfig).toEqual({
        idp: { type: 'cognito', users: { provider: 'cognito', basePath: '/mine', features: { setPassword: true } } },
      });
    });

    it('contributes only idp.users, under the default base path, when the provider supplies no uiConfig', () => {
      const addon = createAddon(newStack(), {});

      expect(addon.uiConfig).toEqual({
        idp: { users: { provider: 'cognito', basePath: '/idp-users', features: { setPassword: true } } },
      });
    });
  });
});
