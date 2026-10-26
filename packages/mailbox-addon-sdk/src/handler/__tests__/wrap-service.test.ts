import { create }              from '@bufbuild/protobuf';

import { authorizedEvent }     from '../../__tests__/authorized-event-helpers';
import type { HandlerContext } from '../../caller/index';
import { wrapService }         from '../wrap-service';

import {
  GetThingResponseSchema,
  ListThingsResponseSchema,
  ThingServiceRuntime,
  type GetThingRequest,
  type GetThingResponse,
  type ListThingsRequest,
  type ListThingsResponse,
} from './fixtures/thing-service';
import { loggerDouble, sinkDouble } from './handler-helpers';

/*
 * Pins what an addon gets from `wrapService`: a handler for an API Gateway event that serves the methods of a
 * generated service through the shared request pipeline, and a compiler that rejects a handlers object that does
 * not match the generated runtime. The compile-time cases are `@ts-expect-error` lines: when the generic
 * signature stops rejecting them, the type check of this package fails.
 */

class ThingService {
  constructor(private readonly prefix: string) {}

  public async getThing(context: HandlerContext, request: GetThingRequest): Promise<GetThingResponse> {
    await context.recordAudit({ status: 'success', entityId: request.name });
    return create(GetThingResponseSchema, { name: `${this.prefix}${request.name}`, size: 7n });
  }

  public async listThings(_context: HandlerContext, request: ListThingsRequest): Promise<ListThingsResponse> {
    return create(ListThingsResponseSchema, { names: [`${this.prefix}${request.filter}`] });
  }
}

function served(): { handler: ReturnType<typeof wrapService>; sink: ReturnType<typeof sinkDouble> } {
  const sink = sinkDouble();
  return { handler: wrapService(ThingServiceRuntime, new ThingService('p-'), sink, loggerDouble()), sink };
}

describe('wrapService', () => {
  describe('serving a request', () => {
    it('answers the response of the method named by the path, encoded as protobuf JSON, from the service object', async () => {
      const { handler } = served();

      const result = await handler(authorizedEvent({ path: '/things/GetThing', body: '{"name":"widget"}' }));

      expect(result).toEqual(expect.objectContaining({ statusCode: 200, body: '{"name":"p-widget","size":"7"}' }));
    });

    it('records the audit of a method as the base path of the service and the service and method as the action', async () => {
      const { handler, sink } = served();

      await handler(authorizedEvent({ path: '/things/GetThing', body: '{"name":"widget"}' }));

      expect(sink.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'things', action: 'ThingService/GetThing', entityId: 'widget' }));
    });
  });

  describe('checking the handlers object against the generated runtime', () => {
    it('rejects a handlers object without a method of the service', () => {
      const incomplete = { getThing: () => Promise.resolve(create(GetThingResponseSchema)) };

      // @ts-expect-error listThings is missing
      wrapService(ThingServiceRuntime, incomplete, sinkDouble(), loggerDouble());
    });

    it('rejects a method that takes the request message of another method', () => {
      const wrongRequest = {
        getThing:   (_context: HandlerContext, _request: ListThingsRequest) => Promise.resolve(create(GetThingResponseSchema)),
        listThings: (_context: HandlerContext, _request: ListThingsRequest) => Promise.resolve(create(ListThingsResponseSchema)),
      };

      // @ts-expect-error getThing takes a ListThingsRequest
      wrapService(ThingServiceRuntime, wrongRequest, sinkDouble(), loggerDouble());
    });
  });
});
