/// <reference types="jest" />

/**
 * AdminUi tests: what the Admin UI adds on top of MailboxUi.
 *
 * The token-exchange function reads the `ADMIN_UI` config row, and the OAuth client is requested
 * from the auth provider as an Admin-API client named after the app.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as dynamodb                            from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import type { IMailboxAuthProvider }            from '../../auth/types';
import { DataTable }                            from '../../../resources/tables/data-tables';
import { AuditEventsQueue }                     from '../../../resources/queues/audit-events-queue';
import { AdminUi }                              from '../admin-ui';

describe('AdminUi', () => {
  let stack: cdk.Stack;
  const provisionAdminApiClient = jest.fn(() => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }));

  function createAuthProvider(): IMailboxAuthProvider {
    return {
      issuer: 'https://example.com/issuer',
      tokenEndpoint: 'https://example.com/token',
      authorizationEndpoint: 'https://example.com/authorize',
      authMethod: 'header',
      usePkce: false,
      scopeMap: {},
      policies: { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient,
      provisionJmapApiClient: () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons: () => [],
    };
  }

  function createAdminUi(): AdminUi {
    return new AdminUi(stack, 'admin-ui', {
      domainName: 'admin.example.com',
      configTable: new DataTable(new dynamodb.Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authProvider: createAuthProvider(),
      artifactResolver: new PinnedArtifactResolver({
        packages: {
          'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-admin-ui': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
    });
  }

  beforeEach(() => {
    provisionAdminApiClient.mockClear();
    stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('provisions an Admin-API client named admin-ui with the distribution callback URLs', () => {
    const adminUi = createAdminUi();

    expect(provisionAdminApiClient).toHaveBeenCalledTimes(1);
    expect(provisionAdminApiClient).toHaveBeenCalledWith({
      name: 'admin-ui',
      callbackUrls: [`https://${adminUi.distributionDomainName}/auth/callback`],
      logoutUrls: [`https://${adminUi.distributionDomainName}/`],
    });
  });

  it('points the token exchange at the ADMIN_UI config row', () => {
    createAdminUi();

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: 'idp-token-exchange-admin-ui', OAUTH_CLIENT_NAME: 'ADMIN_UI' } },
    });
  });
});
