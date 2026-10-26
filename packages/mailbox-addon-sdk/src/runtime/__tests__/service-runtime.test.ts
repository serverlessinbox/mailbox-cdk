import * as t                                                from 'typanion';

import { ADMIN_CONTEXT, authorizedEvent, type EventOptions } from '../../__tests__/authorized-event-helpers';
import type { AuditEntry, AuditEvent, AuditSink }            from '../../audit/index';
import { CallerContextReader, type HandlerContext }          from '../../caller';
import {
  AlreadyExistsError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
}                                                            from '../../errors';
import type { JsonValue }                                    from '../../json';
import type { RequestLogger }                                from '../request-logger';
import type { ServiceMethod }                                from '../service-method';
import { ServiceRuntime }                                    from '../service-runtime';

import errorStatusTable                                      from './fixtures/error-status-table.json';

/*
 * Pins the request pipeline of an addon service: who may call a method, in which order a request is checked,
 * and the status every failure answers with. A method that is open by default, a body that is read before the
 * caller is, or a server error that carries its cause in the answer are defects of the published runtime.
 * What a handler records through its context is completed from the request: a tenant, action or actor taken from
 * anywhere else would attribute a change to the wrong caller, and a secret that reaches the sink is stored for good.
 * The error table is checked against the golden fixture shared with the Go admin API registry
 * (mailbox-idl: admin-api/fixtures/addon-sdk-parity/error-status-table.json).
 */

const ERROR_CATEGORIES = ['InvalidInput', 'Unauthenticated', 'Forbidden', 'NotFound', 'AlreadyExists', 'Conflict', 'Other'] as const;

type ErrorCategory = typeof ERROR_CATEGORIES[number];

const isStatusTable = t.isArray(t.isObject({ error: t.isEnum(ERROR_CATEGORIES), status: t.isNumber() }));

const CAUSE = 'secret cause text';

const THROWN_BY_CATEGORY: Readonly<Record<ErrorCategory, () => unknown>> = {
  InvalidInput:    () => new InvalidInputError(CAUSE),
  Unauthenticated: () => new UnauthenticatedError(CAUSE),
  Forbidden:       () => new ForbiddenError(CAUSE),
  NotFound:        () => new NotFoundError(CAUSE),
  AlreadyExists:   () => new AlreadyExistsError(CAUSE),
  Conflict:        () => new ConflictError(CAUSE),
  Other:           () => new Error(CAUSE),
};

function readStatusTable(): t.InferType<typeof isStatusTable> {
  const rows: unknown = errorStatusTable;
  t.assert(rows, isStatusTable);
  return rows;
}

function loggerDouble(): jest.Mocked<RequestLogger> {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), flush: jest.fn() };
}

/** A service method whose calls the test can inspect. */
interface MethodDouble extends ServiceMethod {
  readonly invoke: jest.Mock<Promise<unknown>, [HandlerContext, JsonValue]>;
}

function methodReturning(result: unknown, admin?: boolean): MethodDouble {
  return { admin, invoke: jest.fn<Promise<unknown>, [HandlerContext, JsonValue]>().mockResolvedValue(result) };
}

function methodThrowing(thrown: unknown): ServiceMethod {
  return { invoke: () => Promise.reject(thrown) };
}

function sinkDouble(): jest.Mocked<AuditSink> {
  return { record: jest.fn<Promise<void>, [AuditEvent]>().mockResolvedValue(undefined) };
}

interface Fixture {
  readonly runtime: ServiceRuntime;
  readonly logger:  jest.Mocked<RequestLogger>;
  readonly sink:    jest.Mocked<AuditSink>;
}

function fixtureWith(methods: Record<string, ServiceMethod>, adminGroups: readonly string[] = ['admin'], sink: jest.Mocked<AuditSink> = sinkDouble()): Fixture {
  const logger  = loggerDouble();
  const runtime = new ServiceRuntime('/idp-users', 'IdpUsersService', new Map(Object.entries(methods)), adminGroups, new CallerContextReader(), sink, logger);
  return { runtime, logger, sink };
}

function recordedEvent(fixture: Fixture): AuditEvent {
  expect(fixture.sink.record).toHaveBeenCalledTimes(1);
  return fixture.sink.record.mock.calls[0][0];
}

function callWith(fixture: Fixture, options: EventOptions = {}): ReturnType<ServiceRuntime['handle']> {
  return fixture.runtime.handle(authorizedEvent({ path: '/idp-users/Do', ...options }));
}

describe('ServiceRuntime', () => {
  describe('routing', () => {
    it('serves a method by the base path and its name, and answers its result as JSON', async () => {
      const method  = methodReturning({ users: [] });
      const fixture = fixtureWith({ Do: method });

      const result = await callWith(fixture, { body: '{"limit":5}' });

      expect(result).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"users":[]}' });
      const [context, body] = method.invoke.mock.calls[0];
      expect(context.caller).toEqual({ tenantId: 'tenant-1', principalId: 'principal-1', principalName: 'jane', displayName: 'Jane Doe', groups: ['admin'] });
      expect(context.requestId).toBe('request-1');
      expect(typeof context.recordAudit).toBe('function');
      expect(body).toEqual({ limit: 5 });
    });

    it('answers an empty object when the method returns nothing', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning(undefined) }));

      expect(result.body).toBe('{}');
    });

    it('answers 405 to anything but POST without running the method', async () => {
      const method = methodReturning({});

      const result = await callWith(fixtureWith({ Do: method }), { method: 'get' });

      expect(result).toEqual(expect.objectContaining({ statusCode: 405, body: 'method not allowed' }));
      expect(method.invoke).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown method', '/idp-users/Missing'],
      ['an inherited object name', '/idp-users/constructor'],
      ['another base path', '/other/Do'],
      ['a path below the method', '/idp-users/Do/extra'],
      ['the base path alone', '/idp-users'],
    ])('answers 404 for %s', async (_title, path) => {
      const result = await callWith(fixtureWith({ Do: methodReturning({}) }), { path });

      expect(result).toEqual(expect.objectContaining({ statusCode: 404, body: 'method not found' }));
    });

    it.each(['idp-users', '/idp-users/', 'idp-users//'])('takes the base path %p with or without its slashes', (basePath) => {
      const runtime = new ServiceRuntime(basePath, 'IdpUsersService', new Map(), [], new CallerContextReader(), sinkDouble(), loggerDouble());

      expect(runtime.basePath).toBe('/idp-users');
    });
  });

  describe('caller', () => {
    it('answers 401 to a request without a tenant, before the method runs', async () => {
      const method = methodReturning({});

      const result = await callWith(fixtureWith({ Do: method }), { context: { ...ADMIN_CONTEXT, tenantId: undefined } });

      expect(result).toEqual(expect.objectContaining({ statusCode: 401, body: 'unauthenticated' }));
      expect(method.invoke).not.toHaveBeenCalled();
    });

    it('answers 500 without the cause when the authorizer context is malformed', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({}) }), { context: { ...ADMIN_CONTEXT, groups: 'not json' } });

      expect(result).toEqual(expect.objectContaining({ statusCode: 500, body: 'internal server error' }));
    });
  });

  describe('admin gate', () => {
    const NON_ADMIN = { ...ADMIN_CONTEXT, groups: '["member"]' };

    it('refuses a non-admin caller on a method that does not declare itself open', async () => {
      const method = methodReturning({});

      const result = await callWith(fixtureWith({ Do: method }), { context: NON_ADMIN });

      expect(result).toEqual(expect.objectContaining({ statusCode: 403, body: 'forbidden' }));
      expect(method.invoke).not.toHaveBeenCalled();
    });

    it('refuses everyone when no admin group is configured', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({}) }, []));

      expect(result.statusCode).toBe(403);
    });

    it('serves a non-admin caller on a method declared open', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({ done: true }, false) }), { context: NON_ADMIN });

      expect(result.statusCode).toBe(200);
    });

    it('serves an admin caller on a method that declares itself admin-only', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({ done: true }, true) }));

      expect(result.statusCode).toBe(200);
    });

    it('checks the caller before the body: a non-admin caller with a broken body is refused, not told the body is invalid', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({}) }), { context: NON_ADMIN, body: '{not json' });

      expect(result.statusCode).toBe(403);
    });

    it('checks authentication before the body: an anonymous request with a broken body answers 401', async () => {
      const result = await callWith(fixtureWith({ Do: methodReturning({}) }), { context: {}, body: '{not json' });

      expect(result.statusCode).toBe(401);
    });
  });

  describe('body', () => {
    it('answers 400 for a body that is not JSON', async () => {
      const method = methodReturning({});

      const result = await callWith(fixtureWith({ Do: method }), { body: '{not json' });

      expect(result).toEqual(expect.objectContaining({ statusCode: 400, body: 'invalid JSON body' }));
      expect(method.invoke).not.toHaveBeenCalled();
    });
  });

  describe('error table', () => {
    it.each(readStatusTable())('answers $error with $status as the golden fixture says', async ({ error, status }) => {
      const result = await callWith(fixtureWith({ Do: methodThrowing(THROWN_BY_CATEGORY[error]()) }));

      expect(result.statusCode).toBe(status);
    });

    it('answers the message of a refusal and never the cause of a server error', async () => {
      const refused = await callWith(fixtureWith({ Do: methodThrowing(new InvalidInputError(CAUSE)) }));
      const failed  = await callWith(fixtureWith({ Do: methodThrowing(new Error(CAUSE)) }));

      expect(refused.body).toBe(CAUSE);
      expect(failed.body).toBe('internal server error');
    });

    it.each([[undefined], [null], [0], ['']])('answers 500 for a thrown %p', async (thrown) => {
      const result = await callWith(fixtureWith({ Do: methodThrowing(thrown) }));

      expect(result.statusCode).toBe(500);
    });
  });

  describe('audit', () => {
    const SINK_CAUSE = 'queue is gone';

    function failingSink(): jest.Mocked<AuditSink> {
      return { record: jest.fn<Promise<void>, [AuditEvent]>().mockRejectedValue(new Error(SINK_CAUSE)) };
    }

    /** A method that records `entry` through its context, and answers `{ recorded: true }`, or the message of the failure when recording rejects. */
    function methodRecording(entry: AuditEntry): ServiceMethod {
      return {
        invoke: async (context) => {
          try {
            await context.recordAudit(entry);
            return { recorded: true };
          } catch (thrown) {
            return { rejected: thrown instanceof Error ? thrown.message : String(thrown) };
          }
        },
      };
    }

    it('completes the entry of a handler into the event: the tenant, the action and the actor come from the request', async () => {
      const entry   = { status: 'success', entityId: 'alice', entityName: 'alice@example.com', changes: [{ field: 'email', oldValue: 'a@old', newValue: 'a@new' }] } as const;
      const fixture = fixtureWith({ Do: methodRecording(entry) });

      const result = await callWith(fixture);

      expect(result.body).toBe('{"recorded":true}');
      expect(recordedEvent(fixture)).toEqual({
        tenantId:   'tenant-1',
        entityType: 'idp-users',
        action:     'IdpUsersService/Do',
        actor:      { actorType: 'user', actorId: 'principal-1', username: 'jane', ipAddress: '203.0.113.7' },
        ...entry,
      });
    });

    it('carries the status and the message of a failure', async () => {
      const fixture = fixtureWith({ Do: methodRecording({ status: 'failure', errorMsg: 'no such user' }) });

      await callWith(fixture);

      expect(recordedEvent(fixture)).toEqual(expect.objectContaining({ status: 'failure', errorMsg: 'no such user' }));
    });

    it('names the entity unknown when the handler gave no id, and names it by its id when it gave no name', async () => {
      const fixture = fixtureWith({ Do: methodRecording({ status: 'success' }), Named: methodRecording({ status: 'success', entityId: 'alice' }) });

      await callWith(fixture);
      await callWith(fixture, { path: '/idp-users/Named' });

      expect(fixture.sink.record.mock.calls.map(([event]) => [event.entityId, event.entityName])).toEqual([['unknown', 'unknown'], ['alice', 'alice']]);
    });

    it('redacts the values of a secret field in the changes and leaves the other fields as they are', async () => {
      const changes = [
        { field: 'initialPassword', newValue: 'hunter2' },
        { field: 'apiKey', oldValue: 'old-key', newValue: 'new-key' },
        { field: 'email', oldValue: 'a@old', newValue: 'a@new' },
      ];
      const fixture = fixtureWith({ Do: methodRecording({ status: 'success', changes }) });

      await callWith(fixture);

      expect(recordedEvent(fixture).changes).toEqual([
        { field: 'initialPassword', newValue: '[REDACTED]' },
        { field: 'apiKey', oldValue: '[REDACTED]', newValue: '[REDACTED]' },
        { field: 'email', oldValue: 'a@old', newValue: 'a@new' },
      ]);
    });

    it('rejects the handler call when the sink cannot record the event', async () => {
      const fixture = fixtureWith({ Do: methodRecording({ status: 'success' }) }, ['admin'], failingSink());

      const result = await callWith(fixture);

      expect(result.body).toBe(`{"rejected":"${SINK_CAUSE}"}`);
    });

    it('answers a sink rejection the handler does not handle like any other handler error', async () => {
      const unhandling: ServiceMethod = { invoke: (context) => context.recordAudit({ status: 'success' }) };
      const fixture                   = fixtureWith({ Do: unhandling }, ['admin'], failingSink());

      const result = await callWith(fixture);

      expect(result).toEqual(expect.objectContaining({ statusCode: 500, body: 'internal server error' }));
    });

    it('records nothing on its own', async () => {
      const fixture = fixtureWith({ Do: methodReturning({}), Failing: methodThrowing(new Error(CAUSE)) });

      await callWith(fixture);
      await callWith(fixture, { path: '/idp-users/Failing' });

      expect(fixture.sink.record).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs the cause of a server error and flushes the trace once', async () => {
      const fixture = fixtureWith({ Do: methodThrowing(new Error(CAUSE)) });

      await callWith(fixture);

      expect(fixture.logger.error).toHaveBeenCalledWith('request failed', { requestId: 'request-1', cause: CAUSE });
      expect(fixture.logger.flush).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a refused request', methodThrowing(new ForbiddenError(CAUSE))],
      ['a served request', methodReturning({})],
    ])('does not flush the trace of %s', async (_title, method) => {
      const fixture = fixtureWith({ Do: method });

      await callWith(fixture);

      expect(fixture.logger.flush).not.toHaveBeenCalled();
      expect(fixture.logger.error).not.toHaveBeenCalled();
    });
  });
});
