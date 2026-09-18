/// <reference types="jest" />

/**
 * AdminUiBucket / AdminUiDistributionId output logical-ID pin
 *
 * remote-git/admin-ui/scripts/deploy.ts resolves these two CloudFormation outputs by their
 * exact logical ID to find its S3 sync target and CloudFront invalidation id. They moved from
 * infrastructure/src/stack.ts into the AdminUi construct (pinned via overrideLogicalId) so the
 * webmail UI does not also emit them. This test guards that the pin survived the move: a
 * template that emitted these under CDK's auto-generated logical IDs instead would silently
 * break the deploy script with no synth-time error.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: {
        audiences: ['admin-api'],
      },
      jmapApi: {
        audiences: ['jmap-api'],
      },
    },
    provisionAdminUiClient: () => ({
      clientId: 'test-admin-ui',
      requestScopeList: [],
      groups: [],
    }),
    provisionJmapUiClient: () => ({
      clientId: 'test-jmap-ui',
      requestScopeList: [],
      groups: [],
    }),
  };
}

describe('AdminUi CfnOutputs', () => {
  it('emits AdminUiBucket and AdminUiDistributionId with pinned logical IDs', () => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-edge': { kind: 'release', version: '1.0.0' },
            'mailbox-admin-ui': { kind: 'release', version: '1.0.0' },
            'mailbox-webmail-ui': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    const stack = new cdk.Stack(app, 'TestMailboxAdminUiOutputs', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    const template = Template.fromStack(stack);
    const json = template.toJSON() as { Outputs?: Record<string, { Value?: unknown }> };
    const outputs = json.Outputs;
    if (!outputs) throw new Error('No Outputs in template');

    expect(outputs).toHaveProperty('AdminUiBucket');
    expect(outputs).toHaveProperty('AdminUiDistributionId');

    // 1. Guards the overrideLogicalId pin itself. If the pin were dropped (or only partially
    // applied), CDK would emit the output under an auto-generated logical ID — a PascalCased
    // construct path plus an 8-hex-char suffix — alongside or instead of the pinned name. No
    // other output key may resemble these two pinned names.
    const nearMatches = Object.keys(outputs).filter(
      (k) =>
        /AdminUiBucket|AdminUiDistributionId/i.test(k) &&
        k !== 'AdminUiBucket' &&
        k !== 'AdminUiDistributionId',
    );
    expect(nearMatches).toEqual([]);

    // 2. Guards that these outputs actually point at the AdminUi construct's own bucket and
    // distribution — never the webmail UI's, which is what parenting the outputs on MailboxUi
    // (instead of AdminUi) would have produced. Each Value must be a Ref into a logical ID
    // rooted at this construct's own path (Mailbox -> ui -> admin-ui -> ...).
    template.hasOutput('AdminUiBucket', {
      Value: { Ref: Match.stringLikeRegexp('^mailboxuiadminui') },
    });
    template.hasOutput('AdminUiDistributionId', {
      Value: { Ref: Match.stringLikeRegexp('^mailboxuiadminui') },
    });
  });
});
