import type { HttpMethod, IHttpRouteAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                        from 'aws-cdk-lib/aws-lambda';

/**
 * One route an API area serves on the shared HTTP API: every request that matches `path` and one of
 * `methods` is forwarded to `handler` behind `authorizer`.
 */
export interface ApiRoute {
  /** The route path, starting with a slash, for example `/user/{proxy+}`. */
  readonly path: string;
  /** The HTTP methods the route accepts. */
  readonly methods: HttpMethod[];
  /** The integration's id, unique among the integrations of the shared HTTP API. */
  readonly integrationId: string;
  /** The Lambda function that serves the route. */
  readonly handler: IFunction;
  /** The authorizer that guards the route. */
  readonly authorizer: IHttpRouteAuthorizer;
}

/** An API area the shared HTTP API serves: the routes the area offers. */
export interface IApiArea {
  /** Every route of the area, in the order the shared HTTP API adds them. */
  readonly routes: ApiRoute[];
}
