/// <reference types="jest" />

/**
 * Bootstrap feature tests.
 *
 * The bootstrap custom resource's properties are the wire contract with the bootstrap Lambda: a
 * client block is read under `oauthClients.adminUi` / `oauthClients.webmailUi`, and a block that
 * is not sent is not written. `oauthClientsProvisioned` is what other constructs wait on so that
 * they run only after those client rows exist.
 */

import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import { VENDOR_ACCOUNT_ID, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                      from 'aws-cdk-lib/aws-dynamodb';
import { ReceiptRuleSet }                            from 'aws-cdk-lib/aws-ses';
import * as cdk                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }             from 'aws-cdk-lib';

import { SesReceivingMode }                          from '../../../contracts/ses-receiving-mode';
import { AuthKeyStoreTable }                         from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                 from '../../../resources/tables/data-tables';
import type { IDnsZone }                             from '../../edge/dns-zone';
import type { OAuthAuthorizationCodeClientConfig }   from '../auth-bootstrap-config';
import { AuthMethod }                                from '../auth-method';
import { Bootstrap }                                 from '../bootstrap';
import type { BootstrapProps }                       from '../bootstrap';
import { OAuthFlow }                                 from '../oauth-flow';

describe('Bootstrap', () => {
  let stack: cdk.Stack;

  function client(clientId: string): OAuthAuthorizationCodeClientConfig {
    return { flow: OAuthFlow.AUTHORIZATION_CODE, clientId, scopes: ['openid'], redirectUri: '/' };
  }

  function createBootstrap(overrides: Partial<BootstrapProps> = {}): Bootstrap {
    return new Bootstrap(stack, 'bootstrap', {
      configTable:       new DataTable(new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
      })),
      authKeyStoreTable: new AuthKeyStoreTable(stack, 'auth-key-store'),
      artifactResolver:  new PinnedArtifactResolver({
        packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      domain:            'example.com',
      oidcIssuer:        'https://example.com/issuer',
      sesRuleSet:        new ReceiptRuleSet(stack, 'ses-rule-set', {}),
      vendorLink:        { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
      ...overrides,
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('sends the webmail client under oauthClients.webmailUi only when one is given', () => {
    createBootstrap({ oauthClients: { webmailUi: client('webmail-client') } });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        webmailUi: Match.objectLike({ clientId: 'webmail-client', redirectUri: '/' }),
        adminUi:   Match.absent(),
      },
    });
  });

  it('requests the client id as audience unless a requested audience is given', () => {
    createBootstrap({
      oauthClients: {
        adminUi:   client('admin-client'),
        webmailUi: { ...client('webmail-client'), requestedAudience: 'webmail-audience' },
      },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        adminUi:   Match.objectLike({ requestedAudience: 'admin-client' }),
        webmailUi: Match.objectLike({ requestedAudience: 'webmail-audience' }),
      },
    });
  });

  it('sends no oauthClients block when none is given', () => {
    createBootstrap();

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: Match.absent(),
    });
  });

  it('sends the id of the hosted zone it is given, and the zone grants the bootstrap Lambda record management', () => {
    const dnsZone: IDnsZone = { hostedZoneId: 'Z0TESTZONE', grantRecordManagement: jest.fn() };
    const bootstrap         = createBootstrap({ dnsZone });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', { hostedZoneId: 'Z0TESTZONE' });
    expect(dnsZone.grantRecordManagement).toHaveBeenCalledWith(bootstrap.handler);
  });

  it('sends no hostedZoneId when it has no hosted zone', () => {
    createBootstrap();

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', { hostedZoneId: Match.absent() });
  });

  it('sends the OIDC provider and the auth policies it is given', () => {
    createBootstrap({
      oidcProvider: {
        tokenEndpoint:         'https://example.com/token',
        authorizationEndpoint: 'https://example.com/authorize',
        authMethod:            AuthMethod.HEADER,
        usePkce:               true,
      },
      authPolicies: { adminApi: { audiences: ['admin-audience'] } },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oidcProvider: Match.objectLike({ tokenEndpoint: 'https://example.com/token', usePkce: true }),
      authPolicies: { adminApi: Match.objectLike({ audiences: ['admin-audience'] }) },
    });
  });

  it('sends no OIDC provider and no auth policies when none are given', () => {
    createBootstrap();

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oidcProvider: Match.absent(),
      authPolicies: Match.absent(),
    });
  });

  it('sets SES_SEND_ENABLED to on in the Lambda environment when send is enabled', () => {
    createBootstrap({ sesSendEnabled: true });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SES_SEND_ENABLED: 'on' } },
    });
  });

  it('leaves SES_SEND_ENABLED out of the Lambda environment when send is not enabled', () => {
    createBootstrap({ sesSendEnabled: false });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SES_SEND_ENABLED: Match.absent() } },
    });
  });

  it('passes the SES receiving mode it is given to the Lambda environment', () => {
    createBootstrap({ sesReceivingMode: SesReceivingMode.FORCED });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SES_RECEIVING_MODE: 'forced' } },
    });
  });

  it('sends the default tenant name and local part', () => {
    createBootstrap();
    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      tenantName:       'default-tenant',
      defaultLocalPart: '{username}',
    });
  });

  it('is a Custom::Bootstrap resource', () => {
    createBootstrap();

    Template.fromStack(stack).resourceCountIs('Custom::Bootstrap', 1);
  });

  it('bounds the time CloudFormation waits by the Lambda timeout plus a 30 second margin', () => {
    createBootstrap();

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 30 });
    template.hasResourceProperties('Custom::Bootstrap', { ServiceTimeout: '60' });
  });

  it('sends the admin client under oauthClients.adminUi only when one is given', () => {
    createBootstrap({ oauthClients: { adminUi: client('admin-client') } });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        adminUi:   Match.objectLike({ clientId: 'admin-client' }),
        webmailUi: Match.absent(),
      },
    });
  });

  it('exposes a handle that other resources can depend on to wait for the bootstrap custom resource', () => {
    const bootstrap = createBootstrap();
    const dependent = new cdk.CfnResource(stack, 'dependent', { type: 'Custom::Dependent' });
    dependent.node.addDependency(bootstrap.oauthClientsProvisioned);

    const template             = Template.fromStack(stack);
    const [bootstrapLogicalId] = Object.keys(template.findResources('Custom::Bootstrap'));

    template.hasResource('Custom::Dependent', { DependsOn: Match.arrayWith([bootstrapLogicalId]) });
  });
});
