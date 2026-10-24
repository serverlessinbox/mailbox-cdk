/// <reference types="jest" />

/**
 * AdminUi tests: what the Admin UI adds on top of MailboxUi.
 *
 * The token-exchange function reads the `ADMIN_UI` config row, the OAuth client is requested from the
 * auth provider as an Admin-API client named after the app, and the runtime config the Admin UI writes
 * to `config/config.json` carries the URLs it is given alongside the config it is given.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as dynamodb                            from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';
import * as t                                   from 'typanion';

import { AuditEventsQueue }                     from '../../../resources/queues/audit-events-queue';
import { DataTable }                            from '../../../resources/tables/data-tables';
import { AuthMethod }                           from '../../auth/auth-method';
import type { IMailboxAuthProvider }            from '../../auth/auth-provider';
import { AdminUi }                              from '../admin-ui';
import type { AdminUiProps }                    from '../admin-ui';

const CONFIG_JSON_KEY = 'config/config.json';

const isContentDeploymentProperties = t.isPartial({
  sources: t.isArray(t.isPartial({ kind: t.isString() })),
});

const isDataSource = t.isPartial({ key: t.isString(), body: t.isString() });

const isUrlOnlyConfig = t.isObject({
  apiUrl:     t.isString(),
  webmailUrl: t.isString(),
});

const isWrittenConfig = t.isObject({
  featureFlag: t.isBoolean(),
  apiUrl:      t.isString(),
  webmailUrl:  t.isString(),
});

/** The bodies of every `config/config.json` source the template deploys into the Admin UI bucket. */
function writtenConfigBodies(template: Template): string[] {
  const bodies: string[] = [];
  for (const resource of Object.values(template.findResources('Custom::ContentDeployment'))) {
    t.assert(resource.Properties, isContentDeploymentProperties);
    for (const source of resource.Properties.sources) {
      if (source.kind !== 'data') {
        continue;
      }
      t.assert(source, isDataSource);
      if (source.key === CONFIG_JSON_KEY) {
        bodies.push(source.body);
      }
    }
  }
  return bodies;
}

describe('AdminUi', () => {
  let stack: cdk.Stack;
  const provisionAdminApiClient = jest.fn(() => ({ clientId: 'admin-client', requestScopeList: [], groups: [] }));

  function createAuthProvider(): IMailboxAuthProvider {
    return {
      issuer:                'https://example.com/issuer',
      tokenEndpoint:         'https://example.com/token',
      authorizationEndpoint: 'https://example.com/authorize',
      authMethod:            AuthMethod.HEADER,
      usePkce:               false,
      scopeMap:              {},
      policies:              { adminApi: { audiences: ['admin-api'] }, jmapApi: { audiences: ['jmap-api'] } },
      provisionAdminApiClient,
      provisionJmapApiClient: () => ({ clientId: 'webmail-client', requestScopeList: [], groups: [] }),
      createAdminApiAddons:   () => [],
    };
  }

  function createAdminUi(overrides: Partial<AdminUiProps> = {}): AdminUi {
    return new AdminUi(stack, 'admin-ui', {
      domainName:       'admin.example.com',
      configTable:      new DataTable(new dynamodb.Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      })),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      authProvider:     createAuthProvider(),
      artifactResolver: new PinnedArtifactResolver({
        packages:         {
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-admin-ui':   { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      ...overrides,
    });
  }

  beforeEach(() => {
    provisionAdminApiClient.mockClear();
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('provisions an Admin-API client named admin-ui with the distribution callback URLs', () => {
    const adminUi = createAdminUi();

    expect(provisionAdminApiClient).toHaveBeenCalledTimes(1);
    expect(provisionAdminApiClient).toHaveBeenCalledWith({
      name:         'admin-ui',
      callbackUrls: [`https://${adminUi.distributionDomainName}/auth/callback`],
      logoutUrls:   [`https://${adminUi.distributionDomainName}/`],
    });
  });

  it('points the token exchange at the ADMIN_UI config row', () => {
    createAdminUi();

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: 'idp-token-exchange-admin-ui', OAUTH_CLIENT_NAME: 'ADMIN_UI' } },
    });
  });

  it('writes the UI config it is given with the API and webmail URLs merged in', () => {
    createAdminUi({
      apiUrl:     'https://api.admin.example.com',
      webmailUrl: 'https://mail.example.com',
      uiConfig:   { featureFlag: true },
    });

    const bodies = writtenConfigBodies(Template.fromStack(stack));
    expect(bodies).toHaveLength(1);
    const written: unknown = JSON.parse(bodies[0] ?? '');
    t.assert(written, isWrittenConfig);
    expect(written).toEqual({
      featureFlag: true,
      apiUrl:      'https://api.admin.example.com',
      webmailUrl:  'https://mail.example.com',
    });
  });

  it('writes the API and webmail URLs to the UI config when no other UI config is given', () => {
    createAdminUi({
      apiUrl:     'https://api.admin.example.com',
      webmailUrl: 'https://mail.example.com',
    });

    const bodies = writtenConfigBodies(Template.fromStack(stack));
    expect(bodies).toHaveLength(1);
    const written: unknown = JSON.parse(bodies[0] ?? '');
    t.assert(written, isUrlOnlyConfig);
    expect(written).toEqual({
      apiUrl:     'https://api.admin.example.com',
      webmailUrl: 'https://mail.example.com',
    });
  });
});
