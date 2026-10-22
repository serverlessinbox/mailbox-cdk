import { create }                                                                               from '@bufbuild/protobuf';

import { SubscribeSchema }                                                                      from '../generated/pushws/push_ws_pb';
import { ServiceSpecBuilder, type GeneratedServiceRuntime, type ServiceSpecFromRuntimeOptions } from '../service-spec-builder';
import type { HandlerContext }                                                                  from '../service-spec';

/*
 * Pins how a generated service description becomes callable methods. A request is parsed and a response
 * written by the protobuf JSON mapping unless the caller overrides it, and a method with no handler must stop
 * the Lambda at startup rather than answer 500 on its first request.
 */

const runtime: GeneratedServiceRuntime = {
  basePath:    '/push',
  serviceName: 'PushService',
  methods:     {
    Subscribe: { name: 'Subscribe', handlerName: 'subscribe', requestSchema: SubscribeSchema, responseSchema: SubscribeSchema },
  },
};

const context: HandlerContext = { auth: 'caller', audit: {} };

function build(handlers: Record<string, unknown>, options?: ServiceSpecFromRuntimeOptions) {
  return new ServiceSpecBuilder(runtime, handlers, options).build();
}

describe('ServiceSpecBuilder', () => {
  describe('build', () => {
    it('carries the route and the method name of the runtime', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) });

      expect(spec).toMatchObject({ basePath: '/push', serviceName: 'PushService' });
      expect(spec.methods['Subscribe'].name).toBe('Subscribe');
    });

    it('fails naming the missing handler when a method has none', () => {
      expect(() => build({})).toThrow('Missing handler for PushService.Subscribe: expected handlers.subscribe()');
    });

    it('fails when the handler of a method is not a function', () => {
      expect(() => build({ subscribe: 'not a function' })).toThrow('Missing handler for PushService.Subscribe');
    });
  });

  describe('validate', () => {
    it('parses the request body with the protobuf JSON mapping', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) });

      const request = spec.methods['Subscribe'].validate({ id: 'c1', accountId: 'a1', types: ['Email'] });

      expect(request).toMatchObject({ id: 'c1', accountId: 'a1', types: ['Email'] });
    });

    it('rejects a body that does not fit the request schema', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) });

      expect(() => spec.methods['Subscribe'].validate({ id: 5 })).toThrow();
    });

    it('uses the validator the resolver names for the method and handler', () => {
      const getValidator = jest.fn<(req: unknown) => unknown, [string, string]>().mockReturnValue((req) => ({ custom: req }));
      const spec         = build({ subscribe: () => Promise.resolve(undefined) }, { getValidator });

      expect(spec.methods['Subscribe'].validate({ id: 5 })).toEqual({ custom: { id: 5 } });
      expect(getValidator).toHaveBeenCalledWith('Subscribe', 'subscribe');
    });

    it('falls back to the protobuf JSON mapping when the resolver has no validator', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) }, { getValidator: () => undefined });

      expect(spec.methods['Subscribe'].validate({ id: 'c1' })).toMatchObject({ id: 'c1', accountId: '' });
    });
  });

  describe('serializeResponse', () => {
    it('writes the response with the protobuf JSON mapping', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) });

      const json = spec.methods['Subscribe'].serializeResponse?.(create(SubscribeSchema, { id: 'c1', accountId: 'a1' }));

      expect(json).toEqual({ id: 'c1', accountId: 'a1' });
    });

    it('rejects a response that is not a message of the response schema', () => {
      const spec = build({ subscribe: () => Promise.resolve(undefined) });

      expect(() => spec.methods['Subscribe'].serializeResponse?.({ id: 'c1', accountId: 'a1' }))
        .toThrow('Response of PushService.Subscribe is not a pushws.v1.Subscribe message');
    });

    it('uses the serializer of the options, given the method name', () => {
      const serializeResponse = jest.fn<unknown, [string, unknown]>().mockReturnValue('custom');
      const spec              = build({ subscribe: () => Promise.resolve(undefined) }, { serializeResponse });

      const json = spec.methods['Subscribe'].serializeResponse?.('response');

      expect(json).toBe('custom');
      expect(serializeResponse).toHaveBeenCalledWith('Subscribe', 'response');
    });
  });

  describe('handler', () => {
    it('calls the handler of the method with the context and request, and the handlers record as this', async () => {
      const handlers = {
        marker: 'handlers-record',
        subscribe(this: { marker: string }, ctx: HandlerContext, req: unknown) {
          return Promise.resolve({ marker: this.marker, ctx, req });
        },
      };
      const spec     = build(handlers);

      const answer = await spec.methods['Subscribe'].handler(context, { id: 'c1' });

      expect(answer).toEqual({ marker: 'handlers-record', ctx: context, req: { id: 'c1' } });
    });

    it('calls the handler as it is at the time of the call, not as it was at build time', async () => {
      const handlers: Record<string, unknown> = { subscribe: () => Promise.resolve('first') };
      const spec                              = build(handlers);
      handlers['subscribe']                   = () => Promise.resolve('second');

      expect(await spec.methods['Subscribe'].handler(context, {})).toBe('second');
    });

    it('throws, rather than rejects, when the handler throws before returning a promise', () => {
      const spec = build({
        subscribe: () => {
          throw new Error('sync failure');
        },
      });

      expect(() => spec.methods['Subscribe'].handler(context, {})).toThrow('sync failure');
    });

    it('answers a promise of the value of a handler that does not return a promise', async () => {
      const spec = build({ subscribe: () => 'plain value' });

      await expect(spec.methods['Subscribe'].handler(context, {})).resolves.toBe('plain value');
    });
  });
});
