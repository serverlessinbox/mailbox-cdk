import * as t                          from 'typanion';

import type { AuditSink }              from '../audit/index';
import type { AuthorizedEvent }        from '../caller/authorized-event';
import type { HandlerContext }         from '../caller/handler-context';
import { InvalidInputError }           from '../errors/index';
import type { JsonValue }              from '../json/index';

import type { AddonHandler, Dispatch } from './addon-handler';
import { RequestCore }                 from './request-core';
import type { RequestLogger }          from './request-logger';

/** The work of a free-form plugin endpoint: the validated body in, the JSON answer out. */
export type HandlerRun<Body> = (context: HandlerContext, body: Body) => Promise<JsonValue>;

/**
 * Serves one free-form plugin endpoint: the body is validated with a typanion schema before `run` sees it, and
 * the request is audited as the path it reached, because the endpoint has no generated service to name it.
 */
export function wrapHandler<Body>(
  bodySchema: t.StrictValidator<unknown, Body>,
  run: HandlerRun<Body>,
  auditSink: AuditSink,
  logger: RequestLogger,
): AddonHandler {
  const route = new HandlerRoute(bodySchema, run);
  const core  = new RequestCore(auditSink, logger);

  return (event) => core.handle(event, (incoming) => route.dispatchOf(incoming));
}

/** The single endpoint of a plugin: validates the body against its schema, then runs the plugin's work. */
class HandlerRoute<Body> {
  constructor(
    private readonly bodySchema: t.StrictValidator<unknown, Body>,
    private readonly run: HandlerRun<Body>,
  ) {}

  public dispatchOf(event: AuthorizedEvent): Dispatch {
    const action       = event.rawPath.replace(/^\//, '');
    const [entityType] = action.split('/');

    return {
      endpoint: { entityType, action },
      work:     (context, body) => this.serve(context, body),
    };
  }

  private async serve(context: HandlerContext, body: JsonValue): Promise<JsonValue> {
    return this.run(context, this.validated(body));
  }

  private validated(body: JsonValue): Body {
    const errors: string[] = [];

    if (!this.bodySchema(body, { errors })) {
      throw new InvalidInputError(`invalid request body: ${errors.join('; ')}`);
    }

    return body;
  }
}
