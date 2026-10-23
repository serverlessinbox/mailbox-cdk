/// <reference types="jest" />

/**
 * Mailbox OAuth client wiring tests.
 *
 * Mailbox decides which UI clients are sent to the bootstrap custom resource, which UI URLs exist,
 * and the order in which the webmail token exchange may switch to its config row. These tests pin
 * that wiring on the synthesized template: a UI that is not enabled leaves no URL, no client block
 * and no env value behind (never an empty stand-in), and the webmail token-exchange function waits
 * on the bootstrap custom resource that writes the row it reads.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Permission }                                    from '../core/auth/jmap-scopes';
import type { MailboxProps }                             from '../mailbox-props';
import { Mailbox }                                       from '../mailbox';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

interface SynthesizedResource {
  Properties?: Record<string, unknown>;
  DependsOn?:  string[];
}

describe('Mailbox OAuth client wiring', () => {
  /** The webmail client and a mail.read-only scope map: the values the cases below assert on. */
  function createAuthProvider() {
    return createMockAuthProvider({
      jmapClientId: 'test-webmail-ui',
      scopeMap:     { 'mail.read': [Permission.MAIL_READ] },
    });
  }

  function synthesize(extraProps: Partial<MailboxProps> = {}): { mailbox: Mailbox; template: Template } {
    const app   = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxOAuthClients', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const mailbox = new Mailbox(stack, 'mailbox', { authProvider: createAuthProvider(), ...extraProps });
    return { mailbox, template: Template.fromStack(stack) };
  }

  function bootstrapResource(template: Template): [string, SynthesizedResource] {
    const matching = Object.entries(template.findResources('Custom::Bootstrap'));
    expect(matching).toHaveLength(1);
    return matching[0];
  }

  function functionsByEnvironment(template: Template, variable: string, value?: string): Array<[string, SynthesizedResource]> {
    return Object.entries(template.findResources('AWS::Lambda::Function')).filter(([, resource]) => {
      const variables = (resource.Properties as { Environment?: { Variables?: Record<string, string> } }).Environment?.Variables;
      return variables !== undefined && variable in variables && (value === undefined || variables[variable] === value);
    });
  }

  describe('with both UIs enabled', () => {
    it('sends the admin and webmail client blocks, and no jmapUi block, to the bootstrap resource', () => {
      const { template }  = synthesize();
      const [, bootstrap] = bootstrapResource(template);

      expect(bootstrap.Properties).toMatchObject({
        oauthClients: {
          adminUi:   { clientId: 'test-admin-ui' },
          webmailUi: { clientId: 'test-webmail-ui' },
        },
      });
      expect(bootstrap.Properties?.oauthClients).not.toHaveProperty('jmapUi');
    });

    it('exposes both UI URLs', () => {
      const { mailbox } = synthesize();

      expect(mailbox.urls.adminUi).toBeDefined();
      expect(mailbox.urls.webmailUi).toBeDefined();
    });

    it('makes the webmail token-exchange function depend on the bootstrap custom resource', () => {
      const { template }         = synthesize();
      const [bootstrapLogicalId] = bootstrapResource(template);
      const webmailTokenExchange = functionsByEnvironment(template, 'SERVICE_NAME', 'idp-token-exchange-webmail-ui');

      expect(webmailTokenExchange).toHaveLength(1);
      expect(webmailTokenExchange[0][1].DependsOn).toContain(bootstrapLogicalId);
    });
  });

  describe('with the Webmail UI disabled', () => {
    it('synthesizes without a Webmail UI URL or client block, and still creates the JMAP API', () => {
      const { mailbox, template } = synthesize({ enableWebmailUi: false });
      const [, bootstrap]         = bootstrapResource(template);

      expect(mailbox.urls.webmailUi).toBeUndefined();
      expect(bootstrap.Properties?.oauthClients).not.toHaveProperty('webmailUi');
      expect(functionsByEnvironment(template, 'OAUTH_HANDLER_CONFIG')).toHaveLength(1);
    });
  });

  describe('with the Admin UI disabled', () => {
    it('leaves out the admin client block and still sends the webmail block', () => {
      const { template }  = synthesize({ enableAdminUi: false });
      const [, bootstrap] = bootstrapResource(template);

      expect(bootstrap.Properties?.oauthClients).toMatchObject({ webmailUi: { clientId: 'test-webmail-ui' } });
      expect(bootstrap.Properties?.oauthClients).not.toHaveProperty('adminUi');
    });

    it('still sends the Admin API authorizer policy', () => {
      const { template }  = synthesize({ enableAdminUi: false });
      const [, bootstrap] = bootstrapResource(template);

      expect(bootstrap.Properties?.authPolicies).toMatchObject({ adminApi: { audiences: ['admin-api'] } });
    });

    it('has no Admin UI URL and no Admin UI token-exchange function', () => {
      const { mailbox, template } = synthesize({ enableAdminUi: false });

      expect(mailbox.urls.adminUi).toBeUndefined();
      expect(functionsByEnvironment(template, 'SERVICE_NAME', 'idp-token-exchange-admin-ui')).toHaveLength(0);
    });

    it('gives the identity provisioner no ADMIN_UI_URL instead of an empty one', () => {
      const { template }        = synthesize({ enableAdminUi: false });
      const identityProvisioner = functionsByEnvironment(template, 'SERVICE_NAME', 'identity-provisioner');

      expect(identityProvisioner).toHaveLength(1);
      expect(identityProvisioner[0][1].Properties).not.toHaveProperty('Environment.Variables.ADMIN_UI_URL');
    });
  });
});
