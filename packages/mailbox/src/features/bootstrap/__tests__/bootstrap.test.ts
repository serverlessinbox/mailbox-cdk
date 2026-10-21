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

import type { OAuthAuthorizationCodeClientConfig }   from '../../../auth/types';
import { DataTable }                                 from '../../../resources/tables/data-tables';
import { AuthKeyStoreTable }                         from '../../../resources/tables/auth-key-store-table';
import { Bootstrap }                                 from '../bootstrap';
import type { BootstrapProps }                       from '../bootstrap';

describe('Bootstrap', () => {
  let stack: cdk.Stack;

  function client(clientId: string): OAuthAuthorizationCodeClientConfig {
    return { flow: 'authorization_code', clientId, scopes: ['openid'], redirectUri: '/' };
  }

  function createBootstrap(overrides: Partial<BootstrapProps> = {}): Bootstrap {
    return new Bootstrap(stack, 'bootstrap', {
      configTable: new DataTable(new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
      })),
      authKeyStoreTable: new AuthKeyStoreTable(stack, 'auth-key-store'),
      artifactResolver: new PinnedArtifactResolver({
        packages: { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      domain: 'example.com',
      oidcIssuer: 'https://example.com/issuer',
      sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}),
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
      ...overrides,
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('sends the webmail client under oauthClients.webmailUi only when one is given', () => {
    createBootstrap({ oauthClients: { webmailUi: client('webmail-client') } });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        webmailUi: Match.objectLike({ clientId: 'webmail-client', redirectUri: '/' }),
        adminUi: Match.absent(),
      },
    });
  });

  it('requests the client id as audience unless a requested audience is given', () => {
    createBootstrap({
      oauthClients: {
        adminUi: client('admin-client'),
        webmailUi: { ...client('webmail-client'), requestedAudience: 'webmail-audience' },
      },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        adminUi: Match.objectLike({ requestedAudience: 'admin-client' }),
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

  it('sends the default tenant name and local part when none are given', () => {
    createBootstrap();
    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      tenantName: 'default-tenant',
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
    const [lambda] = Object.values(template.findResources('AWS::Lambda::Function'));
    template.hasResourceProperties('Custom::Bootstrap', {
      ServiceTimeout: String(lambda.Properties.Timeout + 30),
    });
  });

  it('sends the admin client under oauthClients.adminUi only when one is given', () => {
    createBootstrap({ oauthClients: { adminUi: client('admin-client') } });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
      oauthClients: {
        adminUi: Match.objectLike({ clientId: 'admin-client' }),
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

    expect(template.toJSON().Resources[stack.getLogicalId(dependent)].DependsOn).toContain(bootstrapLogicalId);
  });
});
