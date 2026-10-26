import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import type { AuthorizedEvent }                   from '../caller/authorized-event';
import type { HandlerContext }                    from '../caller/handler-context';
import type { JsonValue }                         from '../json/index';

/** A real API Gateway HTTP API handler: the lookup authorizer's context is on the event. */
export type AddonHandler = (event: AuthorizedEvent) => Promise<APIGatewayProxyStructuredResultV2>;

/** What a request is audited as: the kind of entity it touches and the action it performs. */
export interface Endpoint {
  readonly entityType: string;
  readonly action:     string;
}

/** The work of one endpoint: the decoded body in, the JSON answer out. */
export type RequestWork = (context: HandlerContext, body: JsonValue) => Promise<JsonValue>;

/** The endpoint a request reaches, and the work that serves it. */
export interface Dispatch {
  readonly endpoint: Endpoint;
  readonly work:     RequestWork;
}
