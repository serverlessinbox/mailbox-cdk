/// <reference types="jest" />

/**
 * JMapApi tests: what the construct itself decides.
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

import type { IMailboxAuthProvider }            from '../../../auth/types';
import { DataBlobStore }                        from '../../../data/data-blob-store';
import { DataTable }                            from '../../../data/data-tables';
import { EmailSendingQueue }                    from '../../../email/sending/email-sending-queue';
import { AuditEventsQueue }                     from '../../../features/audit-writing/audit-events-queue';
import { AuthKeyStoreTable }                    from '../../../features/auth-key-store/auth-key-store-table';
import type { IJmapApiAddon }                   from '../../addons';
import type { IWebSocketBroadcastPublisher }    from '../../websocket/websocket';
import { JMapApi }                              from '../jmap-api';
import type { JMapApiProps }                    from '../jmap-api';

describe('JMapApi', () => {
  let stack: cdk.Stack;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  function propsWith(overrides: Partial<JMapApiProps> = {}): JMapApiProps {
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
    return {
      configTable: dataTable('config-table'),
      itemTable: dataTable('item-table'),
      changelogTable: dataTable('changelog-table'),
      authKeyStoreTable: new AuthKeyStoreTable(stack, 'auth-key-store-table'),
      blobStore: new DataBlobStore(new Bucket(stack, 'blob-store')),
      emailSubmissionQueue: new EmailSendingQueue(stack, 'email-submission-queue'),
      auditEventsQueue: new AuditEventsQueue(stack, 'audit-events-queue'),
      cdnHost: 'cdn.example.com',
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
      identityProvisioner: LambdaFunction.fromFunctionArn(
        stack,
        'identity-provisioner-ref',
        'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
      ),
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
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
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  describe('without a custom domain', () => {
    it('serves on the API Gateway endpoint and publishes no domain target', () => {
      const sut = new JMapApi(stack, 'jmap-api', propsWith());

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.url)).toEqual({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] });
      expect(sut.domainTarget).toBeUndefined();
      expect(sut.domainCfnResource).toBeUndefined();
      template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
    });
  });

  describe('with a custom domain', () => {
    it('serves on the domain, maps the API onto it and publishes its regional target', () => {
      const sut = new JMapApi(stack, 'jmap-api', propsWith({ domainName: 'jmap.example.com', certificate: certificate() }));

      const template = Template.fromStack(stack);

      expect(sut.url).toBe('https://jmap.example.com');
      expect(sut.domainTarget).toBeDefined();
      expect(sut.domainCfnResource?.cfnResourceType).toBe('AWS::ApiGatewayV2::DomainName');
      template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
        DomainName: 'jmap.example.com',
        DomainNameConfigurations: [Match.objectLike({ EndpointType: 'REGIONAL', SecurityPolicy: 'TLS_1_2' })],
      });
      template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    });

    it('makes the domain depend on the certificate so the domain is deleted first', () => {
      const cert = certificate();
      new JMapApi(stack, 'jmap-api', propsWith({ domainName: 'jmap.example.com', certificate: cert }));

      Template.fromStack(stack).hasResource('AWS::ApiGatewayV2::DomainName', {
        DependsOn: Match.arrayWith([stack.getLogicalId(cert.node.defaultChild as cdk.CfnResource)]),
      });
    });

    it('throws when the certificate is missing', () => {
      expect(() => new JMapApi(stack, 'jmap-api', propsWith({ domainName: 'jmap.example.com' })))
        .toThrow('JMapApi: certificate is required when domainName is provided');
    });
  });

  describe('CORS preflight', () => {
    it('allows GET, POST and OPTIONS from the given origins', () => {
      new JMapApi(stack, 'jmap-api', propsWith({ allowedOrigins: ['https://webmail.example.com'] }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: {
          AllowOrigins: ['https://webmail.example.com'],
          AllowMethods: ['GET', 'POST', 'OPTIONS'],
          AllowHeaders: ['Content-Type', 'Authorization'],
          AllowCredentials: true,
          MaxAge: 3600,
        },
      });
    });

    it.each([[undefined], [[]]])('configures no CORS when allowedOrigins is %p', (allowedOrigins) => {
      new JMapApi(stack, 'jmap-api', propsWith({ allowedOrigins }));

      const api = Object.values(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(api.Properties.CorsConfiguration).toBeUndefined();
    });
  });

  describe('routes', () => {
    it('serves the session document anonymously and everything else behind the authorizer', () => {
      new JMapApi(stack, 'jmap-api', propsWith());

      const template        = Template.fromStack(stack);
      const authorizers     = template.findResources('AWS::ApiGatewayV2::Authorizer');
      const anonymousId     = Object.keys(authorizers)
        .find((id) => authorizers[id].Properties.AuthorizerResultTtlInSeconds === 0);
      const authenticatedId = Object.keys(authorizers)
        .find((id) => authorizers[id].Properties.AuthorizerResultTtlInSeconds !== 0);

      expect(anonymousId).toBeDefined();
      expect(authenticatedId).toBeDefined();
      expect(authorizers[anonymousId!].Properties.IdentitySource).toEqual([]);
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /.well-known/jmap',
        AuthorizerId: { Ref: anonymousId },
      });
      for (const routeKey of ['POST /', 'POST /upload/{accountId}']) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
          RouteKey: routeKey,
          AuthorizationType: 'CUSTOM',
          AuthorizerId: { Ref: authenticatedId },
        });
      }
    });

    it('mounts each addon on the HTTP API', () => {
      const first: IJmapApiAddon  = { addRoutes: jest.fn() };
      const second: IJmapApiAddon = { addRoutes: jest.fn() };

      new JMapApi(stack, 'jmap-api', propsWith({ jmapApiAddons: [first, second] }));

      for (const addon of [first, second]) {
        expect(addon.addRoutes).toHaveBeenCalledTimes(1);
        expect(addon.addRoutes).toHaveBeenCalledWith(expect.any(HttpApi));
      }
    });

    it('exposes the HTTP API it mounts the routes on', () => {
      const sut = new JMapApi(stack, 'jmap-api', propsWith());

      const apiId = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.httpApi.apiId)).toEqual({ Ref: apiId });
    });
  });

  describe('RFC 9728 protected-resource metadata', () => {
    const protectedResourceRouteKey = 'GET /.well-known/oauth-protected-resource';

    it('adds no route when no OAuth issuer is given', () => {
      new JMapApi(stack, 'jmap-api', propsWith());

      const routes = Object.values(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::Route'));

      expect(routes.map((route) => route.Properties.RouteKey)).not.toContain(protectedResourceRouteKey);
    });

    it('serves the document from the static-assets bucket without an authorizer', () => {
      new JMapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      const template = Template.fromStack(stack);
      const route    = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
        .find((candidate) => candidate.Properties.RouteKey === protectedResourceRouteKey);

      expect(route?.Properties.AuthorizationType).toBe('NONE');
      template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
        IntegrationType: 'HTTP_PROXY',
        IntegrationUri: { 'Fn::Join': ['', Match.arrayWith(['/.well-known/oauth-protected-resource'])] },
      });
    });

    it('throttles that route with PascalCase settings, which CloudFormation receives unmapped', () => {
      new JMapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        RouteSettings: {
          [protectedResourceRouteKey]: { ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 },
        },
      });
    });

    it('creates the stage only after the route that its route settings name', () => {
      new JMapApi(stack, 'jmap-api', propsWith({ oauthIssuerUrl: 'https://auth.example.com' }));

      const template = Template.fromStack(stack);
      const routes   = template.findResources('AWS::ApiGatewayV2::Route');
      const routeId  = Object.keys(routes)
        .find((id) => routes[id].Properties.RouteKey === protectedResourceRouteKey);

      template.hasResource('AWS::ApiGatewayV2::Stage', {
        DependsOn: Match.arrayWith([routeId]),
      });
    });
  });

  describe('enableWebSocketPublishing', () => {
    it('lets the handler Lambda invoke the broadcaster', () => {
      const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };
      const sut                                       = new JMapApi(stack, 'jmap-api', propsWith());

      sut.enableWebSocketPublishing('wss://ws.example.com', broadcaster);

      expect(broadcaster.grantInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
