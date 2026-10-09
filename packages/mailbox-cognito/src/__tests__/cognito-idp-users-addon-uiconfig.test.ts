/**
 * Unit test for CognitoIdpUsersAdminApiAddon uiConfig merging
 *
 * Regression guard: verifies that a non-default basePath is correctly reflected in the addon's uiConfig.
 * This test ensures that when basePath is set to a custom value, the uiConfig used by the admin-ui
 * advertises that same custom value, preventing URL mismatch between the addon's mounted routes and
 * the UI's call targets.
 */

import { App, Stack, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { CognitoIdpUsersAdminApiAddon } from '../api/cognito-idp-users-addon';
import type { IAuditEventsQueue, IIdentityProvisioner } from '@serverlessinbox/mailbox';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';

describe('CognitoIdpUsersAdminApiAddon uiConfig', () => {
  let stack: Stack;
  let artifactResolver: ICdkArtifactEngine;
  let auditEventsQueue: IAuditEventsQueue;
  const mockPoolConfig = {
    userPoolId: 'us-west-2_abcdefgh',
    grantAdminAccess: () => {},
  };
  // This suite tests uiConfig merging only — a minimal stub satisfies the required
  // `identityProvisioner` prop without exercising any invoke/grant behaviour.
  const mockIdentityProvisioner: IIdentityProvisioner = {
    functionArn: 'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke: () => {},
  };

  beforeEach(() => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
            'mailbox-go': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
            'mailbox-cognito': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Set up artifact resolver
    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
      'mailbox-cdk-shared': { version: '1.0.0', zone: 'regional' },
      'mailbox-cognito': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, { bucketBase: 'test-artifacts', project: 'serverlessinbox' }, {});
    pinnedResolver.registerPackages(['mailbox-cdk', 'mailbox-go', 'mailbox-cdk-shared', 'mailbox-cognito']);
    artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);

    // Mock audit events queue
    auditEventsQueue = {
      queueUrl: 'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
      queueArn: 'arn:aws:sqs:us-west-2:123456789012:audit-events',
      grantSend: () => {},
    };
  });

  describe('basePath consistency in uiConfig', () => {
    it('should include default basePath in uiConfig when basePath not explicitly set', () => {
      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-default', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool: mockPoolConfig,
      });

      expect(addon.basePath).toBe('/idp-users');
      const config = addon.uiConfig as Record<string, Record<string, Record<string, unknown>>>;
      expect(config?.idp?.users?.basePath).toBe('/idp-users');
    });

    it('should include custom basePath in uiConfig when basePath is explicitly set (REGRESSION GUARD)', () => {
      const customPath = '/custom/idp-api/v2';
      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-custom', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool: mockPoolConfig,
        basePath: customPath,
      });

      expect(addon.basePath).toBe(customPath);
      // Regression guard: the uiConfig must advertise the same basePath the addon actually uses
      const config = addon.uiConfig as Record<string, Record<string, Record<string, unknown>>>;
      expect(config?.idp?.users?.basePath).toBe(customPath);
    });

    it('should merge provider uiConfig while maintaining addon-owned basePath', () => {
      const customPath = '/api/v2/idp-users';
      const providerConfig = {
        idp: {
          someProviderFeature: 'enabled',
        },
      };

      const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon-merged', {
        artifactResolver,
        auditEventsQueue,
        identityProvisioner: mockIdentityProvisioner,
        pool: mockPoolConfig,
        basePath: customPath,
        uiConfig: providerConfig,
      });

      // Verify the addon's basePath is reflected in uiConfig
      expect(addon.basePath).toBe(customPath);
      const config = addon.uiConfig as Record<string, Record<string, Record<string, unknown>>>;
      expect(config?.idp?.users?.basePath).toBe(customPath);
      // Verify provider config is preserved
      expect(config?.idp?.someProviderFeature).toBe('enabled');
    });
  });
});
