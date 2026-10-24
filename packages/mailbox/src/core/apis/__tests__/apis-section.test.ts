/// <reference types="jest" />

/**
 * ApisSection takes over the `apis` group node. These tests pin what the section owns: the component
 * tag its subtree carries, the scope the auth provider's addons are created under, and the endpoints
 * it adds on request at fixed ids (their paths are part of every resource's logical ID, so a rename
 * replaces deployed resources), and the logical ids it pins on the custom domains, which are unique
 * per account and region and so cannot be replaced next to their old selves.
 */
import { ArtifactZone, PinnedArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID }               from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                         from 'aws-cdk-lib/assertions';
import * as acm                                                    from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }                                    from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }                              from 'aws-cdk-lib/aws-lambda';
import { Bucket }                                                  from 'aws-cdk-lib/aws-s3';
import * as cdk                                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, CfnResource, TagManager }  from 'aws-cdk-lib';
import type { Construct }                                          from 'constructs';

import { DataBlobStore }                                           from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                                        from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                                       from '../../../resources/queues/email-sending-queue';
import { AuthKeyStoreTable }                                       from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                               from '../../../resources/tables/data-tables';
import { AuthMethod }                                              from '../../auth/auth-method';
import type { IMailboxAuthProvider }                               from '../../auth/auth-provider';
import { MailboxDomains }                                          from '../../domains/mailbox-domains';
import type { IAdminApiAddon }                                     from '../addons';
import { ApisSection }                                             from '../apis-section';
import type { ApisEndpointsProps, IApisEdgeInputs }                from '../apis-section';

describe('ApisSection', () => {
  let stack: cdk.Stack;
  let addonScope: Construct | undefined;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  function newSection(): ApisSection {
    const addon: IAdminApiAddon              = { addRoutes: () => undefined };
    const authProvider: IMailboxAuthProvider = {
      issuer:                  'https://example.com/issuer',
      tokenEndpoint:           'https://example.com/token',
      authorizationEndpoint:   'https://example.com/authorize',
      authMethod:              AuthMethod.HEADER,
      usePkce:                 false,
      scopeMap:                {},
      policies:                { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient: () => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }),
      provisionJmapApiClient:  () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons:    (scope) => {
        addonScope = scope;
        return [addon];
      },
    };
    return new ApisSection(stack, 'apis', {
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
      data:           {
        configTable:       dataTable('config-table'),
        itemTable:         dataTable('item-table'),
        changelogTable:    dataTable('changelog-table'),
        auditLogTable:     dataTable('audit-log-table'),
        mailFeedbackTable: dataTable('mail-feedback-table'),
        blobStore:         new DataBlobStore(new Bucket(stack, 'blob-store')),
        auditEventsQueue:  new AuditEventsQueue(stack, 'audit-events-queue'),
      },
      auth:           {
        authKeyStoreTable:   new AuthKeyStoreTable(stack, 'auth-key-store-table'),
        identityProvisioner: LambdaFunction.fromFunctionArn(
          stack,
          'identity-provisioner-ref',
          'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
        ),
      },
      email:          {
        submissionQueue:  new EmailSendingQueue(stack, 'email-submission-queue'),
        sesRuleSetName:   'rule-set',
        sesConfigSetName: 'config-set',
      },
      vendorLink:     { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: 'serverless-inbox:stack' },
      jmapApiBaseUrl: 'https://jmap.example.com',
    });
  }

  function endpointsProps(overrides: Partial<ApisEndpointsProps> = {}): ApisEndpointsProps {
    return {
      cdnHost:        'https://cdn.example.com',
      mailboxDomains: new MailboxDomains({ domainName: 'example.com' }),
      edge:           {},
      ui:             { adminUiOrigins: [], webmailUiOrigins: [] },
      ...overrides,
    };
  }

  beforeEach(() => {
    addonScope = undefined;
    stack      = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('tags every taggable resource under it with the api component', () => {
    const section = newSection();
    section.addEndpoints(endpointsProps());

    Template.fromStack(stack);

    const tags = section.node.findAll()
      .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
      .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['api', 'messaging']));
  });

  it('creates the auth provider addons under the section itself', () => {
    const section = newSection();

    expect(addonScope).toBe(section);
    expect(section.adminApiAddons).toHaveLength(1);
  });

  it('addEndpoints creates the jmap, websocket and admin APIs under the section, without the MCP API by default', () => {
    const section = newSection();

    section.addEndpoints(endpointsProps());

    for (const childId of ['jmap-api', 'websocket-push', 'admin-api']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
    expect(section.node.tryFindChild('mcp-api')).toBeUndefined();
  });

  it('addEndpoints creates the MCP API under the section when it is enabled', () => {
    const section = newSection();

    section.addEndpoints(endpointsProps({
      enableMcp: true,
      edge:      { regionalCertificate: acm.Certificate.fromCertificateArn(stack, 'regional-certificate', 'arn:aws:acm:us-west-2:123456789012:certificate/regional') },
    }));

    expect(section.node.tryFindChild('mcp-api')).toBeDefined();
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'mcp.example.com' });
  });

  it('addEndpoints sends system mail from the domain of the mailbox domains', () => {
    const section = newSection();

    section.addEndpoints(endpointsProps());

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SYSTEM_SENDER_ADDRESS: 'noreply@example.com' }) },
    });
  });

  describe('addEndpoints custom domains', () => {
    function importedCertificate(id: string): acm.ICertificate {
      return acm.Certificate.fromCertificateArn(stack, id, `arn:aws:acm:us-west-2:123456789012:certificate/${id}`);
    }

    function edgeWithAllCertificates(): IApisEdgeInputs {
      return {
        apiCertificate:  importedCertificate('api-certificate'),
        jmapCertificate: importedCertificate('jmap-certificate'),
        wsCertificate:   importedCertificate('ws-certificate'),
      };
    }

    it('pins the logical ids of the three custom domains so a reparented construct does not replace them', () => {
      const section = newSection();

      section.addEndpoints(endpointsProps({ edge: edgeWithAllCertificates() }));

      const domainIds = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::DomainName'));
      expect(domainIds.sort()).toEqual([
        'Mailboxadminapidomain8793AE5D',
        'Mailboxjmapapidomain47B62A36',
        'MailboxwebsocketpushdomainCACDAF3B',
      ]);
    });

    it('serves the admin, JMAP and WebSocket APIs on their mailbox domains when the edge section has their certificates', () => {
      const section = newSection();

      const endpoints = section.addEndpoints(endpointsProps({ edge: edgeWithAllCertificates() }));

      const template = Template.fromStack(stack);
      for (const domainName of ['api.example.com', 'jmap.example.com', 'ws.example.com']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: domainName });
      }
      expect(endpoints.adminApiDomainTarget).toBeDefined();
      expect(endpoints.jmapApiDomainTarget).toBeDefined();
      expect(endpoints.webSocketDomainTarget).toBeDefined();
    });

    it('serves the WebSocket API on no custom domain when the edge section offers no WebSocket certificate', () => {
      const section = newSection();

      const endpoints = section.addEndpoints(endpointsProps({ edge: { apiCertificate: importedCertificate('api-certificate') } }));

      Template.fromStack(stack).resourcePropertiesCountIs('AWS::ApiGatewayV2::DomainName', { DomainName: 'ws.example.com' }, 0);
      expect(endpoints.webSocketDomainTarget).toBeUndefined();
    });
  });

  it('addEndpoints throws when the MCP API is enabled and the edge section has no regional certificate', () => {
    const section = newSection();

    expect(() => section.addEndpoints(endpointsProps({ enableMcp: true }))).toThrow('enableMcp needs the regional certificate');
  });
});
