/// <reference types="jest" />

/**
 * ApiGateway tests: the shared HTTP API the areas mount on. Pins what the host itself decides: the endpoint
 * or custom domain it serves on, the CORS preflight, the default stage, the logical id pin handed out for
 * the domain name, the frozen logical ids of its API, stage, domain and mapping, and that `mount` adds
 * exactly the route it is given. The host creates no Lambda, so a host-only stack has none.
 */

import { Match, Template }                          from 'aws-cdk-lib/assertions';
import { HttpLambdaAuthorizer }                     from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpMethod }                               from 'aws-cdk-lib/aws-apigatewayv2';
import type * as cdk                                from 'aws-cdk-lib';

import type { IApiArea }                            from '../api-area';
import { ApiGateway }                               from '../api-gateway';

import { certificate, inlineFunction, newApiStack } from './apis-helpers';

describe('ApiGateway', () => {
  let stack: cdk.Stack;

  beforeEach(() => {
    stack = newApiStack();
  });

  describe('without a custom domain', () => {
    it('serves on the API Gateway endpoint and publishes no domain target', () => {
      const sut = new ApiGateway(stack, 'admin-api', {});

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(stack.resolve(sut.url)).toEqual({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] });
      expect(sut.domainTarget).toBeUndefined();
      expect(sut.domainLogicalIdPin).toBeUndefined();
      template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
      template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 0);
    });

    it('keeps the default endpoint enabled, since the no-domain configuration serves through it', () => {
      new ApiGateway(stack, 'admin-api', {});

      Template.fromStack(stack).resourcePropertiesCountIs('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true }, 0);
    });
  });

  it('throttles its default stage', () => {
    new ApiGateway(stack, 'admin-api', {});

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingBurstLimit: 200, ThrottlingRateLimit: 100 },
    });
  });

  describe('with a custom domain', () => {
    it('disables the default execute-api endpoint', () => {
      new ApiGateway(stack, 'admin-api', { customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } });

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true });
    });

    it('serves on the domain, maps the API onto it and publishes its regional target', () => {
      const sut = new ApiGateway(stack, 'admin-api', { customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } });

      const template = Template.fromStack(stack);
      const apiId    = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];

      expect(sut.url).toBe('https://api.example.com');
      expect(sut.domainTarget).toBeDefined();
      template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'api.example.com' });
      template.hasResourceProperties('AWS::ApiGatewayV2::ApiMapping', { ApiId: { Ref: apiId }, Stage: '$default' });
    });

    it('hands out the logical id pin of its domain name', () => {
      const sut = new ApiGateway(stack, 'admin-api', { customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } });

      sut.domainLogicalIdPin?.overrideLogicalId('PinnedDomainName');

      const domainIds = Object.keys(Template.fromStack(stack).findResources('AWS::ApiGatewayV2::DomainName'));
      expect(domainIds).toEqual(['PinnedDomainName']);
    });

    it('keeps the logical ids of its API, stage, domain and mapping', () => {
      new ApiGateway(stack, 'admin-api', { customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } });

      const template = Template.fromStack(stack);
      expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))).toEqual(['adminapi060B38DA']);
      expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Stage'))).toEqual(['adminapiDefaultStage6951264C']);
      expect(Object.keys(template.findResources('AWS::ApiGatewayV2::DomainName'))).toEqual(['adminapidomain4B51C352']);
      expect(Object.keys(template.findResources('AWS::ApiGatewayV2::ApiMapping'))).toEqual(['adminapimappingEFAAC9E7']);
    });
  });

  describe('CORS preflight', () => {
    it('allows only POST and OPTIONS from the given origins', () => {
      new ApiGateway(stack, 'admin-api', { allowedOrigins: ['https://admin.example.com'] });

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
      new ApiGateway(stack, 'admin-api', { allowedOrigins });

      Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: Match.absent(),
      });
    });
  });

  describe('mount', () => {
    it('adds exactly the route of the area it is given, with its methods, integration and authorizer', () => {
      const sut            = new ApiGateway(stack, 'admin-api', {});
      const handler        = inlineFunction(stack, 'user-handler');
      const authorizer     = new HttpLambdaAuthorizer('user-authorizer', inlineFunction(stack, 'user-authorizer-fn'));
      const area: IApiArea = { routes: [{ path: '/user/{proxy+}', methods: [HttpMethod.POST], integrationId: 'user-api', handler, authorizer }] };

      sut.mount(area);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey:          'POST /user/{proxy+}',
        AuthorizationType: 'CUSTOM',
      });
      template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    });

    it('adds every route of the area, each with the methods it lists', () => {
      const sut            = new ApiGateway(stack, 'admin-api', {});
      const handler        = inlineFunction(stack, 'area-handler');
      const authorizer     = new HttpLambdaAuthorizer('area-authorizer', inlineFunction(stack, 'area-authorizer-fn'));
      const area: IApiArea = {
        routes: [
          { path: '/first/{proxy+}', methods: [HttpMethod.POST], integrationId: 'first', handler, authorizer },
          { path: '/second/{proxy+}', methods: [HttpMethod.GET, HttpMethod.POST], integrationId: 'second', handler, authorizer },
        ],
      };

      sut.mount(area);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /first/{proxy+}' });
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /second/{proxy+}' });
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /second/{proxy+}' });
      template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
    });
  });

  it('creates no Lambda function of its own', () => {
    new ApiGateway(stack, 'admin-api', { allowedOrigins: ['https://admin.example.com'], customDomain: { domainName: 'api.example.com', certificate: certificate(stack, 'api.example.com') } });

    Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 0);
  });
});
