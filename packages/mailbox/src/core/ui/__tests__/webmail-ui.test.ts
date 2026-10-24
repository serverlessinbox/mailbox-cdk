/// <reference types="jest" />

/**
 * WebmailUi tests: what the Webmail UI adds on top of MailboxUi.
 *
 * The token-exchange function reads the `WEBMAIL_UI` config row, so the env value must name that
 * row, and the function must wait on whatever writes it. The OAuth client is requested from the
 * auth provider as a JMAP-API client named after the app.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import * as dynamodb                            from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { AuditEventsQueue }                     from '../../../resources/queues/audit-events-queue';
import { DataTable }                            from '../../../resources/tables/data-tables';
import { AuthMethod }                           from '../../auth/auth-method';
import type { IMailboxAuthProvider }            from '../../auth/auth-provider';
import { Permission }                           from '../../auth/jmap-scopes';
import { WebmailUi }                            from '../webmail-ui';

interface SynthesizedFunction {
  Properties?: { Environment?: { Variables?: Record<string, string> } };
  DependsOn?:  string[];
}

describe('WebmailUi', () => {
  let stack: cdk.Stack;
  const provisionJmapApiClient = jest.fn(() => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }));

  function createAuthProvider(): IMailboxAuthProvider {
    return {
      issuer:                  'https://example.com/issuer',
      tokenEndpoint:           'https://example.com/token',
      authorizationEndpoint:   'https://example.com/authorize',
      authMethod:              AuthMethod.HEADER,
      usePkce:                 false,
      scopeMap:                {},
      policies:                { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient: () => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }),
      provisionJmapApiClient,
      createAdminApiAddons: () => [],
    };
  }

  function createWebmailUi(dependsOn?: cdk.CfnResource[]): WebmailUi {
    return new WebmailUi(stack, 'webmail-ui', {
      domainName:       'webmail.example.com',
      configTable:      new DataTable(new dynamodb.Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authProvider:     createAuthProvider(),
      artifactResolver: new PinnedArtifactResolver({
        packages:         {
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-webmail-ui': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      dependsOn,
    });
  }

  function tokenExchangeFunction(template: Template): SynthesizedFunction {
    const matching = Object.values<SynthesizedFunction>(template.findResources('AWS::Lambda::Function')).filter(
      (functionResource) => functionResource.Properties?.Environment?.Variables?.SERVICE_NAME === 'idp-token-exchange-webmail-ui',
    );
    expect(matching).toHaveLength(1);
    return matching[0];
  }

  beforeEach(() => {
    provisionJmapApiClient.mockClear();
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('provisions a JMAP-API client named webmail-ui with every permission and the distribution callback URLs', () => {
    const webmailUi = createWebmailUi();

    expect(provisionJmapApiClient).toHaveBeenCalledTimes(1);
    expect(provisionJmapApiClient).toHaveBeenCalledWith({
      name:         'webmail-ui',
      permissions:  Object.values(Permission),
      callbackUrls: [`https://${webmailUi.distributionDomainName}/auth/callback`],
      logoutUrls:   [`https://${webmailUi.distributionDomainName}/`],
    });
  });

  it('deploys the Webmail UI bundle published by the mailbox-webmail-ui artifact', () => {
    createWebmailUi();

    Template.fromStack(stack).hasResourceProperties('Custom::ContentDeployment', {
      sources: [Match.objectLike({ kind: 'zip', sourceKey: Match.stringLikeRegexp('mailbox-webmail-ui/.*webmail-ui\\.zip$'), targetPrefix: 'content/' })],
    });
  });

  it('points the token exchange at the WEBMAIL_UI config row', () => {
    createWebmailUi();

    const tokenExchangeResource = tokenExchangeFunction(Template.fromStack(stack));

    expect(tokenExchangeResource.Properties?.Environment?.Variables?.OAUTH_CLIENT_NAME).toBe('WEBMAIL_UI');
  });

  it('makes the token-exchange function wait on the resources it is given', () => {
    const prerequisite = new cdk.CfnResource(stack, 'prerequisite', { type: 'Custom::Prerequisite' });
    createWebmailUi([prerequisite]);

    const tokenExchangeResource = tokenExchangeFunction(Template.fromStack(stack));

    expect(tokenExchangeResource.DependsOn).toContain(stack.getLogicalId(prerequisite));
  });
});
