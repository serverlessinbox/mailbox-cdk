import { fromJson, toJson, type Message }                          from '@bufbuild/protobuf';

import type { AuthorizedEvent }                                    from '../caller/authorized-event';
import type { HandlerContext }                                     from '../caller/handler-context';
import { InvalidInputError, NotFoundError }                        from '../errors/index';
import type { JsonValue }                                          from '../json/index';

import type { Dispatch }                                           from './addon-handler';
import type { GeneratedMethod, GeneratedService, MessageHandlers } from './generated-service';

/**
 * The methods of one generated service, found by the last segment of the request path. A request body is decoded
 * into the request message of its method and the response message is encoded back, both strictly with the
 * generated protobuf schemas. The path is not matched against the base path of the service: which paths reach
 * the Lambda is decided before it runs.
 */
export class ServiceRoutes {
  private readonly dispatches = new Map<string, Dispatch>();

  constructor(
    runtime: GeneratedService,
    private readonly handlers: MessageHandlers,
  ) {
    for (const method of Object.values(runtime.methods)) {
      this.dispatches.set(method.name, this.dispatchFor(runtime, method));
    }
  }

  /** A path whose last segment names no method of the service is a `NotFoundError`. */
  public dispatchOf(event: AuthorizedEvent): Dispatch {
    const segment  = event.rawPath.split('/').pop() ?? '';
    const dispatch = this.dispatches.get(segment);

    if (!dispatch) {
      throw new NotFoundError('method not found');
    }

    return dispatch;
  }

  private dispatchFor(runtime: GeneratedService, method: GeneratedMethod): Dispatch {
    return {
      endpoint: {
        entityType: runtime.basePath.replace(/^\//, ''),
        action:     `${runtime.serviceName}/${method.name}`,
      },
      work:     (context, body) => this.serve(method, context, body),
    };
  }

  private async serve(method: GeneratedMethod, context: HandlerContext, body: JsonValue): Promise<JsonValue> {
    const request  = this.decode(method, body);
    const response = await this.handlers[method.handlerName](context, request);

    return toJson(method.responseSchema, response);
  }

  private decode(method: GeneratedMethod, body: JsonValue): Message {
    try {
      return fromJson(method.requestSchema, body);
    } catch (thrown) {
      throw this.invalidBody(thrown);
    }
  }

  private invalidBody(thrown: unknown): InvalidInputError {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    return new InvalidInputError(`invalid request body: ${reason}`);
  }
}
