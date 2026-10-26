/// <reference types="jest" />

/**
 * AuthSection takes over the `auth` group node. These tests pin what the section owns: the component
 * tag its subtree carries, and the construct ids it builds under itself (their paths are part of
 * every resource's logical ID, so a rename replaces deployed resources).
 */
import { ArtifactZone, PinnedArtifactResolver }                       from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID }                  from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                            from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                       from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                                     from 'aws-cdk-lib/aws-s3';
import { ReceiptRuleSet }                                             from 'aws-cdk-lib/aws-ses';
import * as cdk                                                       from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, CfnResource, TagManager }     from 'aws-cdk-lib';

import { DataBlobStore }                                              from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                                           from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                                          from '../../../resources/queues/email-sending-queue';
import { DataTable }                                                  from '../../../resources/tables/data-tables';
import type { IOAuthUi }                                              from '../../ui/ui-section';
import { AuthMethod }                                                 from '../auth-method';
import type { AuthPolicyConfig, IMailboxAuthProvider }                from '../auth-provider';
import { AuthSection }                                                from '../auth-section';

describe('AuthSection', () => {
  let stack: cdk.Stack;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  const adminApiWithGroups: AuthPolicyConfig = { audiences: ['admin-api'], requireAnyOfGroups: ['admins'] };

  function newSection(adminApi: AuthPolicyConfig = adminApiWithGroups): AuthSection {
    const authProvider: IMailboxAuthProvider = {
      issuer:                  'https://example.com/issuer',
      tokenEndpoint:           'https://example.com/token',
      authorizationEndpoint:   'https://example.com/authorize',
      authMethod:              AuthMethod.HEADER,
      usePkce:                 false,
      scopeMap:                {},
      policies:                { adminApi, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient: () => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }),
      provisionJmapApiClient:  () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons:    () => [],
    };
    return new AuthSection(stack, 'auth', {
      artifactResolver: new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk':        { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      authProvider,
      data:       {
        configTable:      dataTable('config-table'),
        itemTable:        dataTable('item-table'),
        changelogTable:   dataTable('changelog-table'),
        auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
        blobStore:        new DataBlobStore(new Bucket(stack, 'blob-store')),
      },
      email:      {
        submissionQueue:  new EmailSendingQueue(stack, 'email-submission-queue'),
        sesConfigSetName: 'config-set',
      },
      vendorLink: { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
      domainName: 'example.com',
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('tags every taggable resource under it with the auth component', () => {
    const section = newSection();
    section.addBootstrap({
      email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
      ui:    {},
      edge:  {},
    });

    Template.fromStack(stack);

    const tags = section.node.findAll()
      .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
      .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['auth']));
  });

  it('creates the auth key store and the identity provisioner under the section itself', () => {
    const section = newSection();

    for (const childId of ['auth-key-store', 'identity-provisioner']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
    expect(section.node.tryFindChild('bootstrap')).toBeUndefined();
  });

  it('addBootstrap creates the bootstrap under the section', () => {
    const section = newSection();

    section.addBootstrap({
      email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
      ui:    {},
      edge:  {},
    });

    expect(section.node.tryFindChild('bootstrap')).toBeDefined();
  });

  it('sends system mail from the given domain and bootstraps for it', () => {
    const section = newSection();

    section.addBootstrap({
      email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
      ui:    {},
      edge:  {},
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SYSTEM_SENDER_ADDRESS: 'noreply@example.com' }) },
    });
    template.hasResourceProperties('Custom::Bootstrap', { domain: 'example.com' });
  });

  it('bootstraps with the hosted zone the edge section offers', () => {
    const section = newSection();

    section.addBootstrap({
      email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
      ui:    {},
      edge:  { dnsZone: { hostedZoneId: 'Z0TESTZONE', grantRecordManagement: jest.fn() } },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', { hostedZoneId: 'Z0TESTZONE' });
  });

  describe('Admin API admin groups', () => {
    const noGroupsMessage = /Admin API admin policy has no groups/;

    function bootstrap(section: AuthSection): void {
      section.addBootstrap({
        email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
        ui:    {},
        edge:  {},
      });
    }

    it('fails synthesis when the provider requires an empty group list', () => {
      const section = newSection({ audiences: ['admin-api'], requireAnyOfGroups: [] });

      expect(() => bootstrap(section)).toThrow(noGroupsMessage);
    });

    it('fails synthesis when neither the provider nor the Admin UI names a group', () => {
      const section = newSection({ audiences: ['admin-api'], requireAnyOfGroups: undefined });

      expect(() => bootstrap(section)).toThrow(noGroupsMessage);
    });

    it('passes the group list the provider requires', () => {
      bootstrap(newSection({ audiences: ['admin-api'], requireAnyOfGroups: ['ops'] }));

      Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
        authPolicies: { adminApi: Match.objectLike({ requireAnyOfGroups: ['ops'] }) },
      });
    });

    it('passes a group list that is only known at deploy time', () => {
      const groupsParameter = new cdk.CfnParameter(stack, 'groups', { type: 'String' });
      const groupsToken     = cdk.Fn.split(',', groupsParameter.valueAsString);

      bootstrap(newSection({ audiences: ['admin-api'], requireAnyOfGroups: groupsToken }));

      Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
        authPolicies: { adminApi: Match.objectLike({ requireAnyOfGroups: Match.anyValue() }) },
      });
    });
  });

  describe('with enabled UIs', () => {
    const adminUi: IOAuthUi   = {
      oauthClient:      { clientId: 'admin-client', requestScopeList: ['admin-api/admin'], groups: ['admins'] },
      oauthRedirectUri: 'https://admin.example.com/callback',
    };
    const webmailUi: IOAuthUi = {
      oauthClient:      { clientId: 'webmail-client', requestScopeList: ['jmap-api/mail'], groups: [] },
      oauthRedirectUri: 'https://webmail.example.com/callback',
    };

    it('bootstraps the OAuth client of each UI with the OIDC scopes and the scopes it requests', () => {
      const section = newSection();

      section.addBootstrap({
        email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
        ui:    { adminUi, webmailUi },
        edge:  {},
      });

      Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
        oauthClients: {
          adminUi:   Match.objectLike({
            clientId:    'admin-client',
            scopes:      ['openid', 'email', 'profile', 'admin-api/admin'],
            redirectUri: 'https://admin.example.com/callback',
          }),
          webmailUi: Match.objectLike({
            clientId:    'webmail-client',
            scopes:      ['openid', 'email', 'profile', 'jmap-api/mail'],
            redirectUri: 'https://webmail.example.com/callback',
          }),
        },
      });
    });

    it('requires the groups of the Admin UI client for the Admin API when the provider requires none', () => {
      const section = newSection({ audiences: ['admin-api'] });

      section.addBootstrap({
        email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
        ui:    { adminUi },
        edge:  {},
      });

      Template.fromStack(stack).hasResourceProperties('Custom::Bootstrap', {
        authPolicies: { adminApi: Match.objectLike({ requireAnyOfGroups: ['admins'] }) },
      });
    });
  });
});
