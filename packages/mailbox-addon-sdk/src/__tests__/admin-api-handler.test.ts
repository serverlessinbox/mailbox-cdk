import { AdminApiHandler, type AdminApiHandlerOptions }                    from '../admin-api-handler';
import type { ApiGatewayV2EventLike, ApiGatewayV2ResultLike }              from '../api-gateway';
import type { AuditContext, AuditEvent }                                   from '../audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../errors';
import { ServiceRegistry }                                                 from '../service-registry';
import type { HandlerContext, MethodSpec }                                 from '../service-spec';

/*
 * Pins the request pipeline of the admin API: routing, authentication, validation, the status each failure
 * maps to, and the audit trail of mutating calls. The audit trail is the record of who changed what, so a
 * mutation that is not audited, or an audit failure that changes the answer, is a defect here.
 */

interface TestAuth {
  readonly sub:      string;
  readonly tenantId: string;
}

type TestMethod = MethodSpec<unknown, unknown, TestAuth, AuditContext>;
type TestHandlerFn = TestMethod['handler'];

const AUTH: TestAuth = { sub: 'user-1', tenantId: 'tenant-1' };

function method(handler: TestHandlerFn, overrides: Partial<TestMethod> = {}): TestMethod {
  return { name: 'Method', validate: (req) => req, handler, ...overrides };
}

function buildHandler(methods: Record<string, TestMethod>, options: Partial<AdminApiHandlerOptions<TestAuth>> = {}): AdminApiHandler<TestAuth> {
  const registry = new ServiceRegistry<TestAuth, AuditContext>();
  registry.register({ basePath: '/idp-users', serviceName: 'IdpUsers', methods });
  return new AdminApiHandler({ registry, extractAuth: () => AUTH, ...options });
}

function post(path: string, body?: string, requestId?: string): ApiGatewayV2EventLike {
  return { rawPath: path, body, requestContext: { requestId, http: { method: 'POST' } } };
}

function bodyOf(result: ApiGatewayV2ResultLike): unknown {
  return JSON.parse(result.body ?? '');
}

function errorBody(message: unknown): unknown {
  return { error: { message } };
}

function auditSink(): jest.Mock<Promise<void>, [AuditEvent]> {
  return jest.fn<Promise<void>, [AuditEvent]>().mockResolvedValue(undefined);
}

function failing(error: unknown): TestHandlerFn {
  return () => Promise.reject(error instanceof Error ? error : new Error(String(error)));
}

describe('AdminApiHandler', () => {
  describe('routing', () => {
    it('answers 405 to anything but POST, with a JSON body', async () => {
      const handler = buildHandler({});

      const result = await handler.handle({ rawPath: '/idp-users/Get', requestContext: { http: { method: 'get' } } });

      expect(result.statusCode).toBe(405);
      expect(result.headers).toEqual({ 'content-type': 'application/json; charset=utf-8' });
      expect(bodyOf(result)).toEqual(errorBody('method not allowed'));
    });

    it('serves a POST whatever the case of its method', async () => {
      const handler = buildHandler({ Echo: method(() => Promise.resolve({ echoed: 1 })) });

      const result = await handler.handle({ rawPath: '/idp-users/Echo', requestContext: { http: { method: 'post' } } });

      expect(result.statusCode).toBe(200);
    });

    it('answers 405 when the event names no HTTP method', async () => {
      const result = await buildHandler({}).handle({ rawPath: '/idp-users/Get', requestContext: {} });

      expect(result.statusCode).toBe(405);
    });

    it('answers 400 with the path when it has fewer than two segments', async () => {
      const result = await buildHandler({}).handle(post('/idp-users'));

      expect(result.statusCode).toBe(400);
      expect(bodyOf(result)).toEqual(errorBody('invalid path: /idp-users'));
    });

    it('serves the only service of the base path from /{basePath}/{method}', async () => {
      const handler = buildHandler({ Echo: method(() => Promise.resolve({ echoed: 1 })) });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(result.statusCode).toBe(200);
      expect(bodyOf(result)).toEqual({ echoed: 1 });
    });

    it('serves the named service from /{basePath}/{service}/{method}', async () => {
      const handler = buildHandler({ Echo: method(() => Promise.resolve({ echoed: 2 })) });

      const result = await handler.handle(post('/idp-users/idpusers/Echo'));

      expect(bodyOf(result)).toEqual({ echoed: 2 });
    });

    it('answers 404 when the base path has no services', async () => {
      const result = await buildHandler({}).handle(post('/other/Echo'));

      expect(result.statusCode).toBe(404);
      expect(bodyOf(result)).toEqual(errorBody('service not found'));
    });

    it('answers 404 when the named service is not registered', async () => {
      const result = await buildHandler({}).handle(post('/idp-users/Missing/Echo'));

      expect(bodyOf(result)).toEqual(errorBody('service not found'));
    });

    it('answers 404 when the service has no such method', async () => {
      const result = await buildHandler({ Echo: method(() => Promise.resolve({})) }).handle(post('/idp-users/Missing'));

      expect(result.statusCode).toBe(404);
      expect(bodyOf(result)).toEqual(errorBody('method not found'));
    });
  });

  describe('authentication', () => {
    it('answers the status of the error extractAuth throws and never calls the method', async () => {
      const call    = jest.fn<Promise<unknown>, [HandlerContext<TestAuth, AuditContext>, unknown]>();
      const handler = buildHandler({ Echo: method(call) }, {
        extractAuth: () => {
          throw new ForbiddenError('no subject');
        },
      });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(result.statusCode).toBe(403);
      expect(bodyOf(result)).toEqual(errorBody('no subject'));
      expect(call).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    it('gives the method a context with the auth, the request id and an audit record naming the call', async () => {
      const call    = jest.fn<Promise<unknown>, [HandlerContext<TestAuth, AuditContext>, unknown]>().mockResolvedValue({});
      const handler = buildHandler({ Echo: method(call) });

      await handler.handle(post('/idp-users/Echo', undefined, 'req-1'));

      expect(call).toHaveBeenCalledWith(
        { auth: AUTH, requestId: 'req-1', audit: { entityType: 'idp-users', action: 'IdpUsers/Echo', metadata: { requestId: 'req-1' } } },
        expect.anything(),
      );
    });

    it('leaves the audit metadata empty when the event carries no request id', async () => {
      const call    = jest.fn<Promise<unknown>, [HandlerContext<TestAuth, AuditContext>, unknown]>().mockResolvedValue({});
      const handler = buildHandler({ Echo: method(call) });

      await handler.handle(post('/idp-users/Echo'));

      expect(call.mock.calls[0][0].audit.metadata).toBeUndefined();
    });

    it('validates the parsed JSON body and hands the validated value to the method', async () => {
      const call    = jest.fn<Promise<unknown>, [HandlerContext<TestAuth, AuditContext>, unknown]>().mockResolvedValue({});
      const handler = buildHandler({ Echo: method(call, { validate: (req) => ({ validated: req }) }) });

      await handler.handle(post('/idp-users/Echo', '{"name":"x"}'));

      expect(call.mock.calls[0][1]).toEqual({ validated: { name: 'x' } });
    });

    it('validates an empty object when the body is missing or empty', async () => {
      const validate = jest.fn<unknown, [unknown]>().mockReturnValue({});
      const handler  = buildHandler({ Echo: method(() => Promise.resolve({}), { validate }) });

      await handler.handle(post('/idp-users/Echo', undefined));
      await handler.handle(post('/idp-users/Echo', ''));

      expect(validate.mock.calls).toEqual([[{}], [{}]]);
    });

    it('rejects instead of answering when the body is not JSON', async () => {
      const handler = buildHandler({ Echo: method(() => Promise.resolve({})) });

      await expect(handler.handle(post('/idp-users/Echo', '{not json'))).rejects.toThrow('invalid JSON body');
    });

    it('answers the status of the validation error and never calls the method', async () => {
      const call    = jest.fn<Promise<unknown>, [HandlerContext<TestAuth, AuditContext>, unknown]>();
      const handler = buildHandler({
        Echo: method(call, {
          validate: () => {
            throw new InvalidInputError('name is required');
          },
        }),
      });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(result.statusCode).toBe(400);
      expect(bodyOf(result)).toEqual(errorBody('name is required'));
      expect(call).not.toHaveBeenCalled();
    });
  });

  describe('response', () => {
    it('serializes the handler result with the method serializer', async () => {
      const handler = buildHandler({
        Echo: method(() => Promise.resolve('raw'), { serializeResponse: (resp) => ({ serialized: resp }) }),
      });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(bodyOf(result)).toEqual({ serialized: 'raw' });
    });

    it('writes a bigint as a string and drops the protobuf $typeName marker at every depth', async () => {
      const handler = buildHandler({
        Echo: method(() => Promise.resolve({ $typeName: 'a.B', count: BigInt('9007199254740993'), nested: { $typeName: 'a.C', echoed: true } })),
      });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(result.body).toBe('{"count":"9007199254740993","nested":{"echoed":true}}');
    });

    it('answers an empty object when the handler returns nothing', async () => {
      const handler = buildHandler({ Echo: method(() => Promise.resolve(undefined)) });

      const result = await handler.handle(post('/idp-users/Echo'));

      expect(result.body).toBe('{}');
    });
  });

  describe('status of a failure', () => {
    const statusOf = async (error: unknown): Promise<number> => {
      const handler = buildHandler({ Echo: method(failing(error)) });
      return (await handler.handle(post('/idp-users/Echo'))).statusCode;
    };

    it('maps each known error to its status and anything else to 500', async () => {
      expect(await statusOf(new InvalidInputError('bad'))).toBe(400);
      expect(await statusOf(new NotFoundError('gone'))).toBe(404);
      expect(await statusOf(new ForbiddenError('no'))).toBe(403);
      expect(await statusOf(new Error('boom'))).toBe(500);
    });

    it('maps a conflict to 409, or to 400 when it says the entity already exists', async () => {
      expect(await statusOf(new ConflictError('state changed'))).toBe(409);
      expect(await statusOf(new ConflictError('User Already Exists'))).toBe(400);
      expect(await statusOf(new ConflictError('create failed', 'already exists'))).toBe(400);
      expect(await statusOf(new ConflictError('already exists elsewhere', 'stale version'))).toBe(409);
    });

    it('answers the message of a thrown object that is not an Error, or the thrown value itself', async () => {
      const objectHandler = buildHandler({ Echo: method(() => Promise.reject({ message: 'plain object' })) });
      const stringHandler = buildHandler({ Echo: method(() => Promise.reject('plain string')) });

      expect(bodyOf(await objectHandler.handle(post('/idp-users/Echo')))).toEqual(errorBody('plain object'));
      expect(bodyOf(await stringHandler.handle(post('/idp-users/Echo')))).toEqual(errorBody('plain string'));
    });

    it('answers a message that is not a string as it is, and its text in the audit event', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({ DeleteUser: method(() => Promise.reject({ message: 42 })) }, { emitAuditEvent });

      const result = await handler.handle(post('/idp-users/DeleteUser'));

      expect(bodyOf(result)).toEqual(errorBody(42));
      expect(emitAuditEvent.mock.calls[0][0].errorMsg).toBe('42');
    });
  });

  describe('audit', () => {
    it('emits no audit event for a read method, by the default get and list prefixes in any case', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({ GetUser: method(() => Promise.resolve({})), listUsers: method(() => Promise.resolve({})) }, { emitAuditEvent });

      await handler.handle(post('/idp-users/GetUser'));
      await handler.handle(post('/idp-users/listUsers'));

      expect(emitAuditEvent).not.toHaveBeenCalled();
    });

    it('uses the given isReadMethod instead of the default prefixes', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler(
        { GetUser: method(() => Promise.resolve({})), Search: method(() => Promise.resolve({})) },
        { emitAuditEvent, isReadMethod: (name) => name === 'Search' },
      );

      await handler.handle(post('/idp-users/GetUser'));
      await handler.handle(post('/idp-users/Search'));

      expect(emitAuditEvent.mock.calls.map(([event]) => event.action)).toEqual(['IdpUsers/GetUser']);
    });

    it('emits a success event naming the tenant, the actor and what the handler recorded', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({
        CreateUser: method((ctx) => {
          ctx.audit.entityId   = 'user-9';
          ctx.audit.entityName = 'Nine';
          ctx.audit.changes    = [{ field: 'enabled' }];
          return Promise.resolve({});
        }),
      }, { emitAuditEvent, getTenantId: (auth) => auth.tenantId, getActor: (auth) => ({ id: auth.sub }) });

      await handler.handle(post('/idp-users/CreateUser', undefined, 'req-1'));

      expect(emitAuditEvent).toHaveBeenCalledTimes(1);
      expect(emitAuditEvent.mock.calls[0][0]).toEqual({
        tenantId:   'tenant-1',
        entityType: 'idp-users',
        entityId:   'user-9',
        entityName: 'Nine',
        action:     'IdpUsers/CreateUser',
        status:     'success',
        actor:      { id: 'user-1' },
        changes:    [{ field: 'enabled' }],
        metadata:   { requestId: 'req-1' },
      });
    });

    it('names an entity the handler did not record as unknown and defaults the entity name to its id', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({ CreateUser: method(() => Promise.resolve({})) }, { emitAuditEvent });

      await handler.handle(post('/idp-users/CreateUser'));

      expect(emitAuditEvent.mock.calls[0][0]).toMatchObject({ entityId: 'unknown', entityName: 'unknown', tenantId: undefined, actor: undefined });
    });

    it('serves a mutation without calling the tenant or actor lookups when there is no audit sink', async () => {
      const getActor = jest.fn<unknown, [TestAuth]>();
      const handler  = buildHandler({ CreateUser: method(() => Promise.resolve({ echoed: 1 })) }, { getActor });

      const result = await handler.handle(post('/idp-users/CreateUser'));

      expect(result.statusCode).toBe(200);
      expect(getActor).not.toHaveBeenCalled();
    });

    it('emits a failure event with the error message and answers the error status', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({ DeleteUser: method(failing(new NotFoundError('no such user'))) }, { emitAuditEvent });

      const result = await handler.handle(post('/idp-users/DeleteUser'));

      expect(result.statusCode).toBe(404);
      expect(emitAuditEvent.mock.calls[0][0]).toMatchObject({ action: 'IdpUsers/DeleteUser', status: 'failure', errorMsg: 'no such user' });
    });

    it('emits no event for a failing read method', async () => {
      const emitAuditEvent = auditSink();
      const handler        = buildHandler({ GetUser: method(failing(new NotFoundError('no such user'))) }, { emitAuditEvent });

      const result = await handler.handle(post('/idp-users/GetUser'));

      expect(result.statusCode).toBe(404);
      expect(emitAuditEvent).not.toHaveBeenCalled();
    });

    it('answers the original error when the failure event cannot be emitted', async () => {
      const emitAuditEvent = jest.fn<Promise<void>, [AuditEvent]>().mockRejectedValue(new Error('queue down'));
      const handler        = buildHandler({ DeleteUser: method(failing(new NotFoundError('no such user'))) }, { emitAuditEvent });

      const result = await handler.handle(post('/idp-users/DeleteUser'));

      expect(result.statusCode).toBe(404);
      expect(bodyOf(result)).toEqual(errorBody('no such user'));
    });

    it('answers the original error when the actor lookup throws while describing a failure', async () => {
      const handler = buildHandler({ DeleteUser: method(failing(new NotFoundError('no such user'))) }, {
        emitAuditEvent: auditSink(),
        getActor:       () => {
          throw new Error('no actor');
        },
      });

      const result = await handler.handle(post('/idp-users/DeleteUser'));

      expect(result.statusCode).toBe(404);
    });

    it('answers a failure, and tries a failure event, when the success event cannot be emitted', async () => {
      const emitAuditEvent = jest.fn<Promise<void>, [AuditEvent]>()
        .mockRejectedValueOnce(new Error('queue down'))
        .mockResolvedValue(undefined);
      const handler        = buildHandler({ CreateUser: method(() => Promise.resolve({})) }, { emitAuditEvent });

      const result = await handler.handle(post('/idp-users/CreateUser'));

      expect(result.statusCode).toBe(500);
      expect(emitAuditEvent.mock.calls.map(([event]) => event.status)).toEqual(['success', 'failure']);
    });
  });
});
