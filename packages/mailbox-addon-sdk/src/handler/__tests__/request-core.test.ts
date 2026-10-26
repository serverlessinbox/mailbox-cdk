import * as t                                                from 'typanion';

import { ADMIN_CONTEXT, authorizedEvent, type EventOptions } from '../../__tests__/authorized-event-helpers';
import type { AuditEntry, AuditEvent, AuditSink }            from '../../audit/index';
import type { HandlerContext }                               from '../../caller';
import {
  AlreadyExistsError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
}                                                            from '../../errors';
import type { JsonValue }                                    from '../../json';
import type { Dispatch, RequestWork }                        from '../addon-handler';
import { RequestCore }                                       from '../request-core';
import type { RequestLogger }                                from '../request-logger';

import errorStatusTable                                      from './fixtures/error-status-table.json';

/*
 * Pins the request pipeline every addon Lambda shares: the order a request is checked in, what the work is
 * handed, and the status every failure answers with. A body that is read before the caller is, a server error
 * that carries its cause in the answer, or a trace that is flushed for a refused request are defects of the
 * published SDK. The error table is checked against the golden fixture shared with the Go admin API registry
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

const ENDPOINT = { entityType: 'idp-users', action: 'IdpUsersService/Do' };

function readStatusTable(): t.InferType<typeof isStatusTable> {
  const rows: unknown = errorStatusTable;
  t.assert(rows, isStatusTable);
  return rows;
}

function loggerDouble(): jest.Mocked<RequestLogger> {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), flush: jest.fn() };
}

function sinkDouble(): jest.Mocked<AuditSink> {
  return { record: jest.fn<Promise<void>, [AuditEvent]>().mockResolvedValue(undefined) };
}

type WorkDouble = jest.Mock<Promise<JsonValue>, [HandlerContext, JsonValue]>;

function workReturning(result: JsonValue): WorkDouble {
  return jest.fn<Promise<JsonValue>, [HandlerContext, JsonValue]>().mockResolvedValue(result);
}

function workThrowing(thrown: unknown): RequestWork {
  return () => Promise.reject(thrown);
}

interface Fixture {
  readonly core:   RequestCore;
  readonly logger: jest.Mocked<RequestLogger>;
  readonly sink:   jest.Mocked<AuditSink>;
}

function fixture(sink: jest.Mocked<AuditSink> = sinkDouble()): Fixture {
  const logger = loggerDouble();
  return { core: new RequestCore(sink, logger), logger, sink };
}

function callWith(subject: Fixture, work: RequestWork, options: EventOptions = {}): ReturnType<RequestCore['handle']> {
  const dispatch: Dispatch = { endpoint: ENDPOINT, work };
  return subject.core.handle(authorizedEvent(options), () => dispatch);
}

describe('RequestCore', () => {
  describe('serving', () => {
    it('hands the work the caller, the request id and the decoded body, and answers its result as JSON', async () => {
      const work = workReturning({ users: [] });

      const result = await callWith(fixture(), work, { body: '{"limit":5}' });

      expect(result).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"users":[]}' });
      const [context, body] = work.mock.calls[0];
      expect(context.caller).toEqual({ tenantId: 'tenant-1', principalId: 'principal-1', principalName: 'jane', displayName: 'Jane Doe', groups: ['admin'] });
      expect(context.requestId).toBe('request-1');
      expect(body).toEqual({ limit: 5 });
    });

    it('hands the work an empty object when the request has no body', async () => {
      const work = workReturning({});

      await callWith(fixture(), work);

      expect(work.mock.calls[0][1]).toEqual({});
    });

    it('asks the dispatch for the event it serves', async () => {
      const subject    = fixture();
      const dispatchOf = jest.fn<Dispatch, [Parameters<RequestCore['handle']>[0]]>().mockReturnValue({ endpoint: ENDPOINT, work: workReturning({}) });
      const event      = authorizedEvent({ path: '/idp-users/Other' });

      await subject.core.handle(event, dispatchOf);

      expect(dispatchOf).toHaveBeenCalledWith(event);
    });
  });

  describe('order of the checks', () => {
    it('answers 401 to a request without a tenant, before the work runs', async () => {
      const work = workReturning({});

      const result = await callWith(fixture(), work, { context: { ...ADMIN_CONTEXT, tenantId: undefined } });

      expect(result).toEqual(expect.objectContaining({ statusCode: 401, body: 'unauthenticated' }));
      expect(work).not.toHaveBeenCalled();
    });

    it('answers 401 to an unauthenticated request with a broken body: the caller is read before the body', async () => {
      const result = await callWith(fixture(), workReturning({}), { context: {}, body: '{not json' });

      expect(result.statusCode).toBe(401);
    });

    it('answers 404 for an unknown method to an unauthenticated request: the dispatch is resolved before the caller', async () => {
      const unknownMethod = (): Dispatch => {
        throw new NotFoundError('method not found');
      };

      const result = await fixture().core.handle(authorizedEvent({ context: {} }), unknownMethod);

      expect(result).toEqual(expect.objectContaining({ statusCode: 404, body: 'method not found' }));
    });

    it('answers 400 for a body that is not JSON, without running the work', async () => {
      const work = workReturning({});

      const result = await callWith(fixture(), work, { body: '{not json' });

      expect(result).toEqual(expect.objectContaining({ statusCode: 400, body: 'invalid JSON body' }));
      expect(work).not.toHaveBeenCalled();
    });

    it('answers 500 without the cause when the authorizer context is malformed', async () => {
      const result = await callWith(fixture(), workReturning({}), { context: { ...ADMIN_CONTEXT, groups: 'not json' } });

      expect(result).toEqual(expect.objectContaining({ statusCode: 500, body: 'internal server error' }));
    });
  });

  describe('error table', () => {
    it.each(readStatusTable())('answers $error with $status as the golden fixture says', async ({ error, status }) => {
      const result = await callWith(fixture(), workThrowing(THROWN_BY_CATEGORY[error]()));

      expect(result.statusCode).toBe(status);
    });

    it('answers the message of a refusal as plain text and never the cause of a server error', async () => {
      const refused = await callWith(fixture(), workThrowing(new InvalidInputError(CAUSE)));
      const failed  = await callWith(fixture(), workThrowing(new Error(CAUSE)));

      expect(refused).toEqual(expect.objectContaining({ headers: { 'content-type': 'text/plain; charset=utf-8' }, body: CAUSE }));
      expect(failed.body).toBe('internal server error');
    });

    it.each([[undefined], [null], [0], ['']])('answers 500 for a thrown %p', async (thrown) => {
      const result = await callWith(fixture(), workThrowing(thrown));

      expect(result.statusCode).toBe(500);
    });
  });

  describe('audit', () => {
    const SINK_CAUSE = 'queue is gone';

    function failingSink(): jest.Mocked<AuditSink> {
      return { record: jest.fn<Promise<void>, [AuditEvent]>().mockRejectedValue(new Error(SINK_CAUSE)) };
    }

    function workRecording(entry: AuditEntry): RequestWork {
      return async (context) => {
        await context.recordAudit(entry);
        return { recorded: true };
      };
    }

    it('records the entry of the work as the endpoint of the dispatch, for the caller and source address of the request', async () => {
      const subject = fixture();

      const result = await callWith(subject, workRecording({ status: 'success', entityId: 'alice' }));

      expect(result.body).toBe('{"recorded":true}');
      expect(subject.sink.record).toHaveBeenCalledTimes(1);
      expect(subject.sink.record.mock.calls[0][0]).toEqual(expect.objectContaining({
        tenantId:   'tenant-1',
        entityType: 'idp-users',
        action:     'IdpUsersService/Do',
        actor:      { actorType: 'user', actorId: 'principal-1', username: 'jane', ipAddress: '203.0.113.7' },
      }));
    });

    it('answers a sink rejection the work does not handle like any other failure of the work', async () => {
      const result = await callWith(fixture(failingSink()), workRecording({ status: 'success' }));

      expect(result).toEqual(expect.objectContaining({ statusCode: 500, body: 'internal server error' }));
    });

    it('records nothing on its own', async () => {
      const subject = fixture();

      await callWith(subject, workReturning({}));
      await callWith(subject, workThrowing(new Error(CAUSE)));

      expect(subject.sink.record).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs the cause of a server error and flushes the trace once', async () => {
      const subject = fixture();

      await callWith(subject, workThrowing(new Error(CAUSE)));

      expect(subject.logger.error).toHaveBeenCalledWith('request failed', { requestId: 'request-1', cause: CAUSE });
      expect(subject.logger.flush).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a refused request', workThrowing(new ForbiddenError(CAUSE))],
      ['a served request', workReturning({})],
    ])('does not flush the trace of %s', async (_title, work) => {
      const subject = fixture();

      await callWith(subject, work);

      expect(subject.logger.flush).not.toHaveBeenCalled();
      expect(subject.logger.error).not.toHaveBeenCalled();
    });
  });
});
