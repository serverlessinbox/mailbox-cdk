/// <reference types="jest" />

/**
 * AdminApi tests: what the construct itself decides.
 *
 * Pins the custom-domain wiring (API mapped onto the domain, the domain's logical id pin handed
 * out), the CORS preflight switch, that every route is behind the Lambda authorizer, and that
 * addons are mounted with that same authorizer. A route that loses its authorizer stays green in
 * tsc and synth, so these assertions are the only guard.
 */

import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { HttpLambdaAuthorizer }                      from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpApi }                                   from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                      from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }                      from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }                from 'aws-cdk-lib/aws-lambda';
import { Bucket }                                    from 'aws-cdk-lib/aws-s3';
import * as cdk                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }             from 'aws-cdk-lib';

import { DataBlobStore }                             from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                          from '../../../resources/queues/audit-events-queue';
import { EmailSendingQueue }                         from '../../../resources/queues/email-sending-queue';
import { AuthKeyStoreTable }                         from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                 from '../../../resources/tables/data-tables';
import type { IAdminApiAddon }                       from '../addons';
import { AdminApi }                                  from '../admin-api';
import type { AdminApiProps }                        from '../admin-api';
import type { IWebSocketBroadcastPublisher }         from '../websocket';

describe('AdminApi', () => {
  let stack: cdk.Stack;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
  }

  function propsWith(overrides: Partial<AdminApiProps> = {}): AdminApiProps {
    return {
      configTable:          dataTable('config-table'),
      itemTable:            dataTable('item-table'),
      auditLogTable:        dataTable('audit-log-table'),
      changelogTable:       dataTable('changelog-table'),
      mailFeedbackTable:    dataTable('mail-feedback-table'),
      authKeyStoreTable:    new AuthKeyStoreTable(stack, 'auth-key-store-table'),
      blobStore:            new DataBlobStore(new Bucket(stack, 'blob-store')),
      emailSubmissionQueue: new EmailSendingQueue(stack, 'email-submission-queue'),
      auditEventsQueue:     new AuditEventsQueue(stack, 'audit-events-queue'),
      artifactResolver:     new PinnedArtifactResolver({
        packages:         {
          'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      identityProvisioner:  LambdaFunction.fromFunctionArn(
        stack,
        'identity-provisioner-ref',
        'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
      ),
      sesRuleSetName:       'test-rule-set',
      sesConfigSetName:     'test-config-set',
      systemSenderAddress:  'noreply@example.com',
      vendorLink:           { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
      ...overrides,
    };
  }

  function certificate(): acm.Certificate {
    return new acm.Certificate(stack, 'certificate', {
      domainName: 'api.example.com',
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
      const sut = new AdminApi(stack, 'admin-api', propsWith());

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.url)).toEqual({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] });
      expect(sut.domainTarget).toBeUndefined();
      expect(sut.domainLogicalIdPin).toBeUndefined();
      template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
      template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 0);
    });
  });

  describe('with a custom domain', () => {
    it('serves on the domain, maps the API onto it and publishes its regional target', () => {
      const customDomain = { domainName: 'api.example.com', certificate: certificate() };

      const sut = new AdminApi(stack, 'admin-api', propsWith({ customDomain }));

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(sut.url).toBe('https://api.example.com');
      expect(sut.domainTarget).toBeDefined();
      template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'api.example.com' });
      template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', { ApiId: { Ref: apiId }, Stage: '$default' });
    });

    it('hands out the logical id pin of its domain name', () => {
      const sut = new AdminApi(stack, 'admin-api', propsWith({ customDomain: { domainName: 'api.example.com', certificate: certificate() } }));

      sut.domainLogicalIdPin?.overrideLogicalId('PinnedDomainName');

      const domainIds = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::DomainName'));
      expect(domainIds).toEqual(['PinnedDomainName']);
    });
  });

  describe('CORS preflight', () => {
    it('allows only POST and OPTIONS from the given origins', () => {
      new AdminApi(stack, 'admin-api', propsWith({ allowedOrigins: ['https://admin.example.com'] }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: {
          AllowOrigins:     ['https://admin.example.com'],
          AllowMethods:     ['POST', 'OPTIONS'],
          AllowHeaders:     ['Content-Type', 'Authorization'],
          AllowCredentials: true,
          MaxAge:           3600,
        },
      });
    });

    it.each([[undefined], [[]]])('configures no CORS when allowedOrigins is %p', (allowedOrigins) => {
      new AdminApi(stack, 'admin-api', propsWith({ allowedOrigins }));

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: Match.absent(),
      });
    });
  });

  describe('routes', () => {
    it('routes every POST through the Lambda authorizer', () => {
      new AdminApi(stack, 'admin-api', propsWith());

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey:          'POST /{proxy+}',
        AuthorizationType: 'CUSTOM',
        AuthorizerId:      Match.anyValue(),
      });
    });

    it('mounts each addon with the API and the same authorizer', () => {
      const first: IAdminApiAddon  = { addRoutes: jest.fn() };
      const second: IAdminApiAddon = { addRoutes: jest.fn() };

      new AdminApi(stack, 'admin-api', propsWith({ addons: [first, second] }));

      for (const addon of [first, second]) {
        expect(addon.addRoutes).toHaveBeenCalledTimes(1);
        expect(addon.addRoutes).toHaveBeenCalledWith(expect.any(HttpApi), expect.any(HttpLambdaAuthorizer));
      }
    });
  });

  describe('enableWebSocketPublishing', () => {
    it('lets the handler Lambda invoke the broadcaster', () => {
      const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };
      const sut                                       = new AdminApi(stack, 'admin-api', propsWith());

      sut.enableWebSocketPublishing(broadcaster);

      expect(broadcaster.grantInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
