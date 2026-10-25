/// <reference types="jest" />

/**
 * AdminApi tests: what the construct itself decides.
 *
 * Pins the custom-domain wiring (API mapped onto the domain, the domain's logical id pin handed
 * out), the CORS preflight switch, that every route is behind the Lambda authorizer, and that
 * addons are mounted with that same authorizer. A route that loses its authorizer stays green in
 * tsc and synth, so these assertions are the only guard.
 */

import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { HttpMethod }                                from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                            from 'aws-cdk-lib/aws-lambda';
import * as cdk                                      from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }         from '../../../contracts/websocket-push';
import type { IAdminApiAddon }                       from '../addons';
import { AdminApi }                                  from '../admin-api';
import type { AdminApiProps }                        from '../admin-api';

import {
  certificate,
  inlineFunction,
  newAdminApiProps,
  newApiStack,
  routeAndAdminHandlerRoute,
} from './apis-helpers';

describe('AdminApi', () => {
  let stack: cdk.Stack;
  let addonHandler: IFunction;

  function propsWith(overrides: Partial<AdminApiProps> = {}): AdminApiProps {
    return newAdminApiProps(stack, overrides);
  }

  function addonAt(basePath: string): IAdminApiAddon {
    return { routeSpec: { basePath, methods: [HttpMethod.POST], handler: addonHandler } };
  }

  beforeEach(() => {
    stack        = newApiStack();
    addonHandler = inlineFunction(stack, 'addon-handler');
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

  it('keeps the default endpoint enabled, since the no-domain configuration serves through it', () => {
    new AdminApi(stack, 'admin-api', propsWith());

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true }, 0);
  });

  it('throttles its default stage', () => {
    new AdminApi(stack, 'admin-api', propsWith());

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingBurstLimit: 200, ThrottlingRateLimit: 100 },
    });
  });

  describe('with a custom domain', () => {
    it('serves on the domain, maps the API onto it and publishes its regional target', () => {
      const customDomain = { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') };

      const sut = new AdminApi(stack, 'admin-api', propsWith({ customDomain }));

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(sut.url).toBe('https://api.example.com');
      expect(sut.domainTarget).toBeDefined();
      template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'api.example.com' });
      template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', { ApiId: { Ref: apiId }, Stage: '$default' });
    });

    it('hands out the logical id pin of its domain name', () => {
      const sut = new AdminApi(stack, 'admin-api', propsWith({ customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } }));

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

    it('creates the HTTP Lambda authorizer that its routes reference', () => {
      new AdminApi(stack, 'admin-api', propsWith());

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
        AuthorizerType: 'REQUEST',
      });
    });

    it.each(['/first', '/second'])('mounts the route of the addon at %s behind the authorizer of the handler route', (basePath) => {
      new AdminApi(stack, 'admin-api', propsWith({ addons: [addonAt('/first'), addonAt('/second')] }));

      const { route, handlerRoute } = routeAndAdminHandlerRoute(Template.fromStack(stack), `POST ${basePath}/{proxy+}`);

      expect(route.AuthorizationType).toBe('CUSTOM');
      expect(route.AuthorizerId).toBeDefined();
      expect(route.AuthorizerId).toEqual(handlerRoute.AuthorizerId);
    });

    it('mounts the methods the route spec lists and no others', () => {
      const addon: IAdminApiAddon = { routeSpec: { basePath: '/multi', methods: [HttpMethod.POST, HttpMethod.GET], handler: addonHandler } };

      new AdminApi(stack, 'admin-api', propsWith({ addons: [addon] }));

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /multi/{proxy+}' });
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /multi/{proxy+}' });
      template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
    });

    it('mounts nothing for an addon without a route spec', () => {
      new AdminApi(stack, 'admin-api', propsWith({ addons: [{}] }));

      Template.fromStack(stack).resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    });

    it('fails the synthesis when two addons use the same base path', () => {
      expect(() => new AdminApi(stack, 'admin-api', propsWith({ addons: [addonAt('/same'), addonAt('/same')] }))).toThrow(
        "Two Admin API addons use the base path '/same'; each addon needs its own.",
      );
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
