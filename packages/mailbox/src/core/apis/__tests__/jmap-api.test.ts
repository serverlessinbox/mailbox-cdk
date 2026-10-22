/// <reference types="jest" />

/**
 * JmapApi tests: what the construct itself decides.
 *
 * Pins which routes are anonymous (only the JMAP session document), that every other route is
 * behind the Lambda authorizer, the custom-domain wiring, the CORS preflight switch, and the
 * RFC 9728 protected-resource route with its throttling. Making a route anonymous by accident, or
 * dropping the route-settings dependency (which fails the deploy, not the synth), stays green in
 * tsc and synth, so these assertions are the only guard.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { VENDOR_ACCOUNT_ID }                    from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { HttpApi }                              from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                 from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }           from 'aws-cdk-lib/aws-lambda';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }    from '../../../contracts/websocket-push';
import { DataBlobStore }                        from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                     from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                    from '../../../resources/queues/email-sending-queue';
import { AuthKeyStoreTable }                    from '../../../resources/tables/auth-key-store-table';
import { DataTable }                            from '../../../resources/tables/data-tables';
import type { IMailboxAuthProvider }            from '../../auth/types';
import type { IJmapApiAddon }                   from '../addons';
import { JmapApi }                              from '../jmap-api';
import type { JmapApiProps }                    from '../jmap-api';

describe('JmapApi', () => {
  let stack: cdk.Stack;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  function propsWith(overrides: Partial<JmapApiProps> = {}): JmapApiProps {
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
    return {
      configTable:          dataTable('config-table'),
      itemTable:            dataTable('item-table'),
      changelogTable:       dataTable('changelog-table'),
      authKeyStoreTable:    new AuthKeyStoreTable(stack, 'auth-key-store-table'),
      blobStore:            new DataBlobStore(new Bucket(stack, 'blob-store')),
      emailSubmissionQueue: new EmailSendingQueue(stack, 'email-submission-queue'),
      auditEventsQueue:     new AuditEventsQueue(stack, 'audit-events-queue'),
      cdnHost:              'cdn.example.com',
      artifactResolver:     new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk':        { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':         { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      authProvider,
      identityProvisioner: LambdaFunction.fromFunctionArn(
        stack,
        'identity-provisioner-ref',
        'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
      ),
      vendorAccountIds:    [VENDOR_ACCOUNT_ID],
      ...overrides,
    };
  }

  function certificate(): acm.Certificate {
    return new acm.Certificate(stack, 'certificate', {
      domainName: 'jmap.example.com',
      validation: acm.CertificateValidation.fromDns(),
    });
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  describe('without a custom domain', () => {
    it('serves on the API Gateway endpoint and publishes no domain target', () => {
      const sut = new JmapApi(stack, 'jmap-api', propsWith());

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.url)).toEqual({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] });
      expect(sut.domainTarget).toBeUndefined();
      expect(sut.domainLogicalIdPin).toBeUndefined();
      template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
    });
  });

  describe('with a custom domain', () => {
    it('serves on the domain, maps the API onto it and publishes its regional target', () => {
      const customDomain = { domainName: 'jmap.example.com', certificate: certificate() };

      const sut = new JmapApi(stack, 'jmap-api', propsWith({ customDomain }));

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(sut.url).toBe('https://jmap.example.com');
      expect(sut.domainTarget).toBeDefined();
      template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'jmap.example.com' });
      template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', { ApiId: { Ref: apiId }, Stage: '$default' });
    });

    it('hands out the logical id pin of its domain name', () => {
      const sut = new JmapApi(stack, 'jmap-api', propsWith({ customDomain: { domainName: 'jmap.example.com', certificate: certificate() } }));

      sut.domainLogicalIdPin?.overrideLogicalId('PinnedDomainName');

      const domainIds = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::DomainName'));
      expect(domainIds).toEqual(['PinnedDomainName']);
    });
  });

  describe('CORS preflight', () => {
    it('allows GET, POST and OPTIONS from the given origins', () => {
      new JmapApi(stack, 'jmap-api', propsWith({ allowedOrigins: ['https://webmail.example.com'] }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: {
          AllowOrigins:     ['https://webmail.example.com'],
          AllowMethods:     ['GET', 'POST', 'OPTIONS'],
          AllowHeaders:     ['Content-Type', 'Authorization'],
          AllowCredentials: true,
          MaxAge:           3600,
        },
      });
    });

    it.each([[undefined], [[]]])('configures no CORS when allowedOrigins is %p', (allowedOrigins) => {
      new JmapApi(stack, 'jmap-api', propsWith({ allowedOrigins }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: Match.absent(),
      });
    });
  });

  describe('routes', () => {
    it('serves the session document anonymously and everything else behind the authorizer', () => {
      new JmapApi(stack, 'jmap-api', propsWith());

      const template          = Template.fromStack(stack);
      const [anonymousId]     = Object.keys(template.findResources('AWS::ApiGatewayV2::Authorizer', {
        Properties: { AuthorizerResultTtlInSeconds: 0, IdentitySource: [] },
      }));
      const [authenticatedId] = Object.keys(template.findResources('AWS::ApiGatewayV2::Authorizer', {
        Properties: { AuthorizerResultTtlInSeconds: Match.not(0) },
      }));

      expect(anonymousId).toBeDefined();
      expect(authenticatedId).toBeDefined();
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey:     'GET /.well-known/jmap',
        AuthorizerId: { Ref: anonymousId },
      });
      for (const routeKey of ['POST /', 'POST /upload/{accountId}']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
          RouteKey:          routeKey,
          AuthorizationType: 'CUSTOM',
          AuthorizerId:      { Ref: authenticatedId },
        });
      }
    });

    it('mounts each addon on the HTTP API', () => {
      const first: IJmapApiAddon  = { addRoutes: jest.fn() };
      const second: IJmapApiAddon = { addRoutes: jest.fn() };

      new JmapApi(stack, 'jmap-api', propsWith({ jmapApiAddons: [first, second] }));

      for (const addon of [first, second]) {
        expect(addon.addRoutes).toHaveBeenCalledTimes(1);
        expect(addon.addRoutes).toHaveBeenCalledWith(expect.any(HttpApi));
      }
    });

    it('exposes the HTTP API it mounts the routes on', () => {
      const sut = new JmapApi(stack, 'jmap-api', propsWith());

      const apiId = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.httpApi.apiId)).toEqual({ Ref: apiId });
    });
  });

  describe('RFC 9728 protected-resource metadata', () => {
    const protectedResourceRouteKey = 'GET /.well-known/oauth-protected-resource';

    it('adds no route when no OAuth issuer is given', () => {
      new JmapApi(stack, 'jmap-api', propsWith());

      Template.fromStack(stack).resourcePropertiesCountIs('AWS::ApiGatewayV2::Route', { RouteKey: protectedResourceRouteKey }, 0);
    });

    it('serves the document from the static-assets bucket without an authorizer', () => {
      new JmapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey:          protectedResourceRouteKey,
        AuthorizationType: 'NONE',
      });
      template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
        IntegrationType: 'HTTP_PROXY',
        IntegrationUri:  { 'Fn::Join': ['', Match.arrayWith(['/.well-known/oauth-protected-resource'])] },
      });
    });

    it('throttles that route with PascalCase settings, which CloudFormation receives unmapped', () => {
      new JmapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        RouteSettings: {
          [protectedResourceRouteKey]: { ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 },
        },
      });
    });

    it('creates the stage only after the route that its route settings name', () => {
      new JmapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      const template  = Template.fromStack(stack);
      const [routeId] = Object.keys(template.findResources('AWS::ApiGatewayV2::Route', {
        Properties: { RouteKey: protectedResourceRouteKey },
      }));

      template.hasResource('AWS::ApiGatewayV2::Stage', {
        DependsOn: Match.arrayWith([routeId]),
      });
    });
  });

  describe('enableWebSocketPublishing', () => {
    it('lets the handler Lambda invoke the broadcaster', () => {
      const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };
      const sut                                       = new JmapApi(stack, 'jmap-api', propsWith());

      sut.enableWebSocketPublishing('wss://ws.example.com', broadcaster);

      expect(broadcaster.grantInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
