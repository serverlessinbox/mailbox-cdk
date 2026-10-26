import * as t                                                from 'typanion';

import { ADMIN_CONTEXT, authorizedEvent, type EventOptions } from '../../__tests__/authorized-event-helpers';
import { CallerContextReader, type HandlerContext }          from '../../caller';
import {
  AlreadyExistsError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
}                                                            from '../../errors';
import type { JsonValue }                                    from '../../json-value';
import type { RequestLogger }                                from '../request-logger';
import type { ServiceMethod }                                from '../service-method';
import { ServiceRuntime }                                    from '../service-runtime';

import errorStatusTable                                      from './fixtures/error-status-table.json';

/*
 * Pins the request pipeline of an addon service: who may call a method, in which order a request is checked,
 * and the status every failure answers with. A method that is open by default, a body that is read before the
 * caller is, or a server error that carries its cause in the answer are defects of the published runtime.
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

interface Fixture {
  readonly runtime: ServiceRuntime;
  readonly logger:  jest.Mocked<RequestLogger>;
}

function fixtureWith(methods: Record<string, ServiceMethod>, adminGroups: readonly string[] = ['admin']): Fixture {
  const logger = loggerDouble();
  return { runtime: new ServiceRuntime('/idp-users', new Map(Object.entries(methods)), adminGroups, new CallerContextReader(), logger), logger };
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
      expect(method.invoke).toHaveBeenCalledWith(
        { caller: { tenantId: 'tenant-1', principalId: 'principal-1', principalName: 'jane', displayName: 'Jane Doe', groups: ['admin'] }, requestId: 'request-1' },
        { limit: 5 },
      );
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
      const runtime = new ServiceRuntime(basePath, new Map(), [], new CallerContextReader(), loggerDouble());

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
