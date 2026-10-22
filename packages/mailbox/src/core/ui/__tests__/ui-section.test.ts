/// <reference types="jest" />

/**
 * UiSection takes over the `ui` group node. These tests pin what the section owns: the component
 * tag its subtree carries, and the UIs it builds under itself at fixed ids and under their enabling
 * conditions (the ids are part of every resource's logical ID, so a rename replaces deployed
 * resources).
 */
import { ArtifactZone, PinnedArtifactResolver }                   from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys }                                 from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                               from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                   from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                                   from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, CfnResource, TagManager } from 'aws-cdk-lib';
import { DependencyGroup }                                        from 'constructs';

import { AuditEventsQueue }                                       from '../../../resources/queues/audit-events-queue';
import { DataTable }                                              from '../../../resources/tables/data-tables';
import type { IMailboxAuthProvider }                              from '../../auth/types';
import { MailboxDomains }                                         from '../../domains/mailbox-domains';
import { UiSection }                                              from '../ui-section';
import type { UiSectionProps }                                    from '../ui-section';

describe('UiSection', () => {
  let stack: cdk.Stack;

  function newSection(overrides: Partial<UiSectionProps> = {}): UiSection {
    const authProvider: IMailboxAuthProvider = {
      issuer:                  'https://example.com/issuer',
      tokenEndpoint:           'https://example.com/token',
      authorizationEndpoint:   'https://example.com/authorize',
      authMethod:              'header',
      usePkce:                 false,
      scopeMap:                {},
      policies:                { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient: () => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }),
      provisionJmapApiClient:  () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons:    () => [],
    };
    return new UiSection(stack, 'ui', {
      artifactResolver: new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk':        { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-admin-ui':   { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-webmail-ui': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      authProvider,
      enableAdminUi:   true,
      enableWebmailUi: true,
      mailboxDomains:  new MailboxDomains({ domainName: 'example.com' }),
      data:            {
        configTable:      new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
        auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      },
      auth:            { oauthClientsProvisioned: new DependencyGroup() },
      apis:            { adminApiAddons: [] },
      edge:            {},
      ...overrides,
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('tags every taggable resource under it with the ui component', () => {
    const section = newSection();

    Template.fromStack(stack);

    const tags = section.node.findAll()
      .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
      .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['ui']));
  });

  it('creates both UIs under the section when both are enabled', () => {
    const section = newSection();

    expect(section.node.tryFindChild('admin-ui')).toBeDefined();
    expect(section.node.tryFindChild('webmail-ui')).toBeDefined();
    expect(Object.keys(section.oauthClients).sort()).toEqual(['adminUi', 'webmailUi']);
  });

  it('creates only the Admin UI when the Webmail UI is disabled', () => {
    const section = newSection({ enableWebmailUi: false });

    expect(section.node.tryFindChild('admin-ui')).toBeDefined();
    expect(section.node.tryFindChild('webmail-ui')).toBeUndefined();
    expect(section.webmailUiOrigins).toEqual([]);
  });

  it('creates only the Webmail UI when the Admin UI is disabled', () => {
    const section = newSection({ enableAdminUi: false });

    expect(section.node.tryFindChild('admin-ui')).toBeUndefined();
    expect(section.node.tryFindChild('webmail-ui')).toBeDefined();
    expect(section.adminUiOrigins).toEqual([]);
  });
});
