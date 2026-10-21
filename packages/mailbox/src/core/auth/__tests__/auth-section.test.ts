/// <reference types="jest" />

/**
 * AuthSection takes over the `auth` group node. These tests pin what the section owns: the component
 * tag its subtree carries, and the construct ids it builds under itself (their paths are part of
 * every resource's logical ID, so a rename replaces deployed resources).
 */
import { ArtifactZone, PinnedArtifactResolver }                       from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID }                  from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                   from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                       from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                                     from 'aws-cdk-lib/aws-s3';
import { ReceiptRuleSet }                                             from 'aws-cdk-lib/aws-ses';
import * as cdk                                                       from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, CfnResource, TagManager }     from 'aws-cdk-lib';

import { DataBlobStore }                                              from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                                           from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                                          from '../../../resources/queues/email-sending-queue';
import { DataTable }                                                  from '../../../resources/tables/data-tables';
import { AuthSection }                                                from '../auth-section';
import type { IMailboxAuthProvider }                                  from '../types';

describe('AuthSection', () => {
  let stack: cdk.Stack;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  function newSection(): AuthSection {
    const authProvider: IMailboxAuthProvider = {
      issuer: 'https://example.com/issuer',
      tokenEndpoint: 'https://example.com/token',
      authorizationEndpoint: 'https://example.com/authorize',
      authMethod: 'header',
      usePkce: false,
      scopeMap: {},
      policies: { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient: () => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }),
      provisionJmapApiClient: () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons: () => [],
    };
    return new AuthSection(stack, 'auth', {
      artifactResolver: new PinnedArtifactResolver({
        packages: {
          'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      authProvider,
      data: {
        configTable: dataTable('config-table'),
        itemTable: dataTable('item-table'),
        changelogTable: dataTable('changelog-table'),
        auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
        blobStore: new DataBlobStore(new Bucket(stack, 'blob-store')),
        derivedDomainName: 'example.com',
      },
      email: {
        submissionQueue: new EmailSendingQueue(stack, 'email-submission-queue'),
        sesConfigSetName: 'config-set',
      },
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('tags every taggable resource under it with the auth component', () => {
    const section = newSection();
    section.addBootstrap({
      email: { sesRuleSet: new ReceiptRuleSet(stack, 'ses-rule-set', {}) },
      ui: {},
      edge: {},
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
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
      ui: {},
      edge: {},
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
    });

    expect(section.node.tryFindChild('bootstrap')).toBeDefined();
  });
});
