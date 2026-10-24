/**
 * Unit test for CognitoIdpUsersAdminApiAddon uiConfig merging
 *
 * Regression guard: verifies that a non-default basePath is correctly reflected in the addon's uiConfig.
 * This test ensures that when basePath is set to a custom value, the uiConfig used by the admin-ui
 * advertises that same custom value, preventing URL mismatch between the addon's mounted routes and
 * the UI's call targets.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }          from '@serverlessinbox/artifact-registry-cdk';
import type { IAuditEventsQueue, IIdentityProvisioner } from '@serverlessinbox/mailbox';
import { UserPool }                                     from 'aws-cdk-lib/aws-cognito';
import { App, Stack, BootstraplessSynthesizer }         from 'aws-cdk-lib';

import { CognitoIdpUsersAdminApiAddon }                 from '../cognito-idp-users-addon';
import type { ICognitoIdpUsersPoolConfig }              from '../cognito-idp-users-pool-config';

describe('CognitoIdpUsersAdminApiAddon uiConfig', () => {
  let stack: Stack;
  let artifactResolver: IArtifactResolver;
  let auditEventsQueue: IAuditEventsQueue;
  let mockPoolConfig: ICognitoIdpUsersPoolConfig;
  // This suite tests uiConfig merging only — a minimal stub satisfies the required
  // `identityProvisioner` prop without exercising any invoke/grant behaviour.
  const mockIdentityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  () => {},
  };

  beforeEach(() => {
    const app      = new App();
    stack          = new Stack(app, 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    mockPoolConfig = {
      userPool:         UserPool.fromUserPoolArn(stack, 'user-pool', 'arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_abcdefgh'),
      grantAdminAccess: () => {},
    };

    // Set up artifact resolver
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk':        { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      'mailbox-cognito':    { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver                            = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    // Mock audit events queue
    auditEventsQueue = {
      queueUrl:  'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
      queueArn:  'arn:aws:sqs:us-west-2:123456789012:audit-events',
      grantSend: () => {},
    };
  });

  describe('basePath consistency in uiConfig', () => {
    it('should include default basePath in uiConfig when basePath not explicitly set', () => {
      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-default', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool:                mockPoolConfig,
      });

      expect(addon.basePath).toBe('/idp-users');
      expect(addon.uiConfig.idp.users.basePath).toBe('/idp-users');
    });

    it('should include custom basePath in uiConfig when basePath is explicitly set (REGRESSION GUARD)', () => {
      const customPath = '/custom/idp-api/v2';
      const addon      = new CognitoIdpUsersAdminApiAddon(stack, 'addon-custom', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool:                mockPoolConfig,
        basePath:            customPath,
      });

      expect(addon.basePath).toBe(customPath);
      // Regression guard: the uiConfig must advertise the same basePath the addon actually uses
      expect(addon.uiConfig.idp.users.basePath).toBe(customPath);
    });

    it('should keep the idp type of the provider uiConfig next to the addon-owned idp.users', () => {
      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-merged', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool:                mockPoolConfig,
        basePath:            '/mine',
        uiConfig:            { idp: { type: 'cognito' } },
      });

      expect(addon.uiConfig).toEqual({
        idp: { type: 'cognito', users: { provider: 'cognito', basePath: '/mine', features: { setPassword: true } } },
      });
    });

    it('should contribute only idp.users when the provider supplies no uiConfig', () => {
      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-alone', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool:                mockPoolConfig,
      });

      expect(addon.uiConfig).toEqual({
        idp: { users: { provider: 'cognito', basePath: '/idp-users', features: { setPassword: true } } },
      });
    });
  });
});
