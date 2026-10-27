/// <reference types="jest" />

/**
 * AdminApi tests: what the admin area itself decides, on a real shared API it is mounted on.
 *
 * Pins that every admin route is served under `/admin` and none at the root, that the handler route gets
 * the plain authorizer and each addon route the principal-lookup authorizer, and the duplicate base-path
 * guard. A route that loses its authorizer, or gets the wrong one, stays green in tsc and synth, so these
 * assertions are the only guard.
 */

import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { HttpMethod }                                from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                            from 'aws-cdk-lib/aws-lambda';
import * as cdk                                      from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }         from '../../../contracts/websocket-push';
import type { IAdminApiAddon }                       from '../addons';
import { AdminApi }                                  from '../admin-api';
import type { AdminApiProps }                        from '../admin-api';
import { ApiGateway }                                from '../api-gateway';

import {
  authorizerOfRoute,
  inlineFunction,
  newAdminApiProps,
  newApiStack,
  routeOf,
} from './apis-helpers';

describe('AdminApi', () => {
  let stack: cdk.Stack;
  let gateway: ApiGateway;
  let addonHandler: IFunction;

  function propsWith(overrides: Partial<AdminApiProps> = {}): AdminApiProps {
    return newAdminApiProps(stack, overrides);
  }

  function addonAt(basePath: string): IAdminApiAddon {
    return { routeSpec: { basePath, methods: [HttpMethod.POST], handler: addonHandler } };
  }

  function mountedAdminApi(overrides: Partial<AdminApiProps> = {}): AdminApi {
    const sut = new AdminApi(stack, 'admin', propsWith(overrides));

    gateway.mount(sut);

    return sut;
  }

  beforeEach(() => {
    stack        = newApiStack();
    gateway      = new ApiGateway(stack, 'admin-api', {});
    addonHandler = inlineFunction(stack, 'addon-handler');
  });

  it('creates its handler Lambda under itself', () => {
    const sut = new AdminApi(stack, 'admin', propsWith());

    expect(sut.node.tryFindChild('api-handler')).toBeDefined();
  });

  it('lists the addon routes, then the handler route', () => {
    const sut = new AdminApi(stack, 'admin', propsWith({ addons: [addonAt('/first'), addonAt('/second')] }));

    expect(sut.routes.map((route) => route.path)).toEqual(['/admin/first/{proxy+}', '/admin/second/{proxy+}', '/admin/{proxy+}']);
  });

  it('mounts the handler route under /admin behind the plain authorizer', () => {
    mountedAdminApi();

    const { functionEnvironment } = authorizerOfRoute(Template.fromStack(stack), 'POST /admin/{proxy+}');

    expect(functionEnvironment).toMatchObject({ AUTH_POLICY_NAME: 'ADMIN_API', PRINCIPAL_LOOKUP: 'off' });
  });

  it('mounts no route at the root of the shared API', () => {
    mountedAdminApi({ addons: [addonAt('/first')] });

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /{proxy+}' }, 0);
  });

  it.each(['/first', '/second'])('mounts the route of the addon at /admin%s behind the principal-lookup authorizer', (basePath) => {
    mountedAdminApi({ addons: [addonAt('/first'), addonAt('/second')] });

    const { functionEnvironment } = authorizerOfRoute(Template.fromStack(stack), `POST /admin${basePath}/{proxy+}`);

    expect(functionEnvironment).toMatchObject({ PRINCIPAL_LOOKUP: 'on' });
  });

  it('gives the addon routes and the handler route two distinct authorizers, under the shared API', () => {
    mountedAdminApi({ addons: [addonAt('/first')] });

    const template = Template.fromStack(stack);

    expect(routeOf(template, 'POST /admin/first/{proxy+}').AuthorizerId).not.toEqual(routeOf(template, 'POST /admin/{proxy+}').AuthorizerId);
    expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Authorizer')).sort()).toEqual([
      'adminapiauthorizer35A63265',
      'adminapilookupauthorizerD8B2A7F4',
    ]);
  });

  it('caches the answer of the principal-lookup authorizer for 60 seconds', () => {
    mountedAdminApi({ addons: [addonAt('/first')] });

    const { cacheTtlSeconds } = authorizerOfRoute(Template.fromStack(stack), 'POST /admin/first/{proxy+}');

    expect(cacheTtlSeconds).toBe(60);
  });

  it('turns the lookup on for only one function, under its own service name', () => {
    mountedAdminApi({ addons: [addonAt('/first')] });

    const template        = Template.fromStack(stack);
    const lookupFunctions = template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: { PRINCIPAL_LOOKUP: 'on' } } },
    });

    expect(Object.keys(lookupFunctions)).toHaveLength(1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ PRINCIPAL_LOOKUP: 'on', SERVICE_NAME: 'authorizer-admin-api-lookup' }) },
    });
  });

  it('mounts the methods the route spec lists and no others', () => {
    const addon: IAdminApiAddon = { routeSpec: { basePath: '/multi', methods: [HttpMethod.POST, HttpMethod.GET], handler: addonHandler } };

    mountedAdminApi({ addons: [addon] });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /admin/multi/{proxy+}' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /admin/multi/{proxy+}' });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);
  });

  it('mounts nothing for an addon without a route spec', () => {
    mountedAdminApi({ addons: [{}] });

    Template.fromStack(stack).resourceCountIs('AWS::ApiGatewayV2::Route', 1);
  });

  it('fails the synthesis when two addons use the same base path', () => {
    expect(() => new AdminApi(stack, 'admin', propsWith({ addons: [addonAt('/same'), addonAt('/same')] }))).toThrow(
      "Two Admin API addons use the base path '/same'; each addon needs its own.",
    );
  });

  describe('enableWebSocketPublishing', () => {
    it('lets the handler Lambda invoke the broadcaster', () => {
      const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };
      const sut                                       = new AdminApi(stack, 'admin', propsWith());

      sut.enableWebSocketPublishing(broadcaster);

      expect(broadcaster.grantInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
