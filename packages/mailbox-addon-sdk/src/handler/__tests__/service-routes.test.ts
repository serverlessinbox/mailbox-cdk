import { create, type Message }             from '@bufbuild/protobuf';

import { authorizedEvent }                  from '../../__tests__/authorized-event-helpers';
import type { HandlerContext }              from '../../caller/index';
import { InvalidInputError, NotFoundError } from '../../errors/index';
import type { JsonValue }                   from '../../json/index';
import { ServiceRoutes }                    from '../service-routes';

import {
  GetThingRequestSchema,
  GetThingResponseSchema,
  ListThingsResponseSchema,
  ThingServiceRuntime,
} from './fixtures/thing-service';
import { contextDouble }        from './handler-helpers';

/*
 * Pins how a generated service is served: the method comes from the last path segment, the body is decoded and
 * the answer encoded with the generated protobuf schemas, and the handler is called on its own object. A body
 * that is not decoded, an answer that is not encoded (an int64 is a bigint, which JSON cannot write) or a
 * handler called detached from its service are defects of every addon that serves a generated service.
 */

type HandlerDouble = jest.Mock<Promise<Message>, [HandlerContext, Message]>;

interface Handlers extends Record<string, HandlerDouble> {
  readonly getThing:   HandlerDouble;
  readonly listThings: HandlerDouble;
}

function handlers(): Handlers {
  return {
    getThing:   jest.fn<Promise<Message>, [HandlerContext, Message]>().mockResolvedValue(create(GetThingResponseSchema, { name: 'widget', size: 42n })),
    listThings: jest.fn<Promise<Message>, [HandlerContext, Message]>().mockResolvedValue(create(ListThingsResponseSchema, { names: ['a', 'b'] })),
  };
}

function work(subject: Handlers, path: string, body: JsonValue): Promise<JsonValue> {
  const dispatch = new ServiceRoutes(ThingServiceRuntime, subject).dispatchOf(authorizedEvent({ path }));
  return dispatch.work(contextDouble(), body);
}

describe('ServiceRoutes', () => {
  describe('finding the method', () => {
    it('serves the method named by the last path segment', async () => {
      const subject = handlers();

      await work(subject, '/things/ListThings', {});

      expect(subject.listThings).toHaveBeenCalledTimes(1);
      expect(subject.getThing).not.toHaveBeenCalled();
    });

    it('does not take the method from the first segment', async () => {
      const subject = handlers();

      await work(subject, '/GetThing/ListThings', {});

      expect(subject.listThings).toHaveBeenCalledTimes(1);
      expect(subject.getThing).not.toHaveBeenCalled();
    });

    it('does not look at the base path of the service', async () => {
      const subject = handlers();

      await work(subject, '/elsewhere/GetThing', {});

      expect(subject.getThing).toHaveBeenCalledTimes(1);
    });

    it.each(['/things/Unknown', '/things/', '/things/getThing', '/things/__proto__'])('answers not found for the path %s', (path) => {
      const routes = new ServiceRoutes(ThingServiceRuntime, handlers());

      expect(() => routes.dispatchOf(authorizedEvent({ path }))).toThrow(new NotFoundError('method not found'));
    });

    it('audits a method as the entity type of the base path and the service and method as the action', () => {
      const dispatch = new ServiceRoutes(ThingServiceRuntime, handlers()).dispatchOf(authorizedEvent({ path: '/things/GetThing' }));

      expect(dispatch.endpoint).toEqual({ entityType: 'things', action: 'ThingService/GetThing' });
    });
  });

  describe('serving the method', () => {
    it('hands the handler the context and the request message decoded from the body', async () => {
      const subject  = handlers();
      const context  = contextDouble();
      const dispatch = new ServiceRoutes(ThingServiceRuntime, subject).dispatchOf(authorizedEvent({ path: '/things/GetThing' }));

      await dispatch.work(context, { name: 'widget' });

      expect(subject.getThing).toHaveBeenCalledWith(context, create(GetThingRequestSchema, { name: 'widget' }));
    });

    it('answers the response message as protobuf JSON, so an int64 is written as a string', async () => {
      const answer = await work(handlers(), '/things/GetThing', { name: 'widget' });

      expect(answer).toEqual({ name: 'widget', size: '42' });
    });

    it('calls the handler on the handlers object, so a service can use its own members', async () => {
      const subject = handlers();

      await work(subject, '/things/GetThing', {});

      expect(subject.getThing.mock.contexts[0]).toBe(subject);
    });

    it.each([
      ['a field of the wrong type', { name: 5 }],
      ['a field the message does not have', { name: 'widget', colour: 'red' }],
    ])('answers invalid input for a body with %s, without calling the handler', async (_title, body) => {
      const subject = handlers();

      await expect(work(subject, '/things/GetThing', body)).rejects.toThrow(InvalidInputError);
      await expect(work(subject, '/things/GetThing', body)).rejects.toThrow(/^invalid request body: /);
      expect(subject.getThing).not.toHaveBeenCalled();
    });

    it('lets a failure of the handler pass unchanged', async () => {
      const subject = handlers();
      const failure = new NotFoundError('no such thing');
      subject.getThing.mockRejectedValue(failure);

      await expect(work(subject, '/things/GetThing', {})).rejects.toBe(failure);
    });
  });
});
