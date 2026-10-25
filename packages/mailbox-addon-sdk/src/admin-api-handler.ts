import type { ApiGatewayV2EventLike, ApiGatewayV2ResultLike, JsonValue }   from './api-gateway';
import type { AuditContext, AuditEvent }                                   from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { JsonBodyReader }                                                  from './json-body-reader';
import type { ServiceRegistry }                                            from './service-registry';
import type { HandlerContext, MethodSpec, ServiceSpec }                    from './service-spec';

/** How the handler gets its services, its caller's identity and its audit sink. */
export type AdminApiHandlerOptions<TAuth> = {
  registry: ServiceRegistry<TAuth, AuditContext>;

  /**
   * Build auth context from the event. Kept pluggable on purpose (Cognito/Auth0/etc).
   */
  extractAuth: (event: ApiGatewayV2EventLike) => TAuth;

  /**
   * Optional audit sink (e.g. SQS). Called for non-read methods.
   */
  emitAuditEvent?: (event: AuditEvent) => Promise<void>;

  /**
   * Determines whether a method should be considered read-only.
   */
  isReadMethod?: (methodName: string) => boolean;

  /**
   * Extract tenantId for audit events. If omitted, tenantId is left undefined.
   */
  getTenantId?: (auth: TAuth) => string | undefined;

  /**
   * Extract actor for audit events.
   */
  getActor?: (auth: TAuth) => unknown;
};

/** The three parts of a request path; the service name is empty when the path does not carry one. */
type Route = {
  basePath:    string;
  serviceName: string;
  methodName:  string;
};

type AuditBase = Omit<AuditEvent, 'status' | 'errorMsg'>;

/**
 * Serves an API Gateway HTTP API event as an admin API call: POST only, routed by path to a registered
 * service method, whose request is validated and handled, its response serialized, and — for methods that are
 * not reads — an audit event emitted. A failure answers with the status its error maps to; it is never thrown.
 * An unparseable request body is the exception and is thrown.
 */
export class AdminApiHandler<TAuth> {
  private readonly bodyReader = new JsonBodyReader();
  private readonly isReadMethod: (methodName: string) => boolean;

  constructor(private readonly options: AdminApiHandlerOptions<TAuth>) {
    this.isReadMethod = options.isReadMethod ?? ((methodName) => this.startsWithReadVerb(methodName));
  }

  public async handle(event: ApiGatewayV2EventLike): Promise<ApiGatewayV2ResultLike> {
    if (this.httpMethodOf(event) !== 'POST') {
      return this.errorResponse(405, 'method not allowed');
    }

    let route: Route;
    try {
      route = this.parseRoute(event);
    } catch (thrown) {
      return this.errorResponse(400, this.messageOf(thrown));
    }

    const service = this.findService(route);
    if (!service) {
      return this.errorResponse(404, 'service not found');
    }

    const method = service.methods[route.methodName];
    if (!method) {
      return this.errorResponse(404, 'method not found');
    }

    let auth: TAuth;
    try {
      auth = this.options.extractAuth(event);
    } catch (thrown) {
      return this.errorResponse(this.statusCodeOf(thrown), this.messageOf(thrown));
    }

    const requestId                                    = event.requestContext?.requestId;
    const context: HandlerContext<TAuth, AuditContext> = {
      auth,
      audit: this.newAuditContext(route, service, requestId),
      requestId,
    };
    const reqBody                                      = this.bodyReader.read(event.body);

    return this.invoke(method, context, reqBody, this.isReadMethod(route.methodName));
  }

  private async invoke(
    method: MethodSpec<unknown, unknown, TAuth, AuditContext>,
    context: HandlerContext<TAuth, AuditContext>,
    reqBody: JsonValue,
    isReadMethod: boolean,
  ): Promise<ApiGatewayV2ResultLike> {
    try {
      const validatedReq = method.validate(reqBody);
      const rawResult    = await method.handler(context, validatedReq);
      const result       = method.serializeResponse ? method.serializeResponse(rawResult) : rawResult;

      if (this.isAudited(isReadMethod)) {
        await this.emitAudit({ ...this.auditBaseOf(context), status: 'success' });
      }

      return this.jsonResponse(200, result ?? {});
    } catch (thrown) {
      return this.answerFailure(thrown, context, isReadMethod);
    }
  }

  private async answerFailure(
    thrown: unknown,
    context: HandlerContext<TAuth, AuditContext>,
    isReadMethod: boolean,
  ): Promise<ApiGatewayV2ResultLike> {
    const message = this.messageOf(thrown);

    if (this.isAudited(isReadMethod)) {
      await this.emitFailureAudit(context, String(message));
    }

    return this.errorResponse(this.statusCodeOf(thrown), message);
  }

  private isAudited(isReadMethod: boolean): boolean {
    return !isReadMethod && this.options.emitAuditEvent !== undefined;
  }

  private async emitAudit(event: AuditEvent): Promise<void> {
    await this.options.emitAuditEvent?.(event);
  }

  /** A failing audit sink, or a failure to describe the actor, never changes the answer to a request that already failed. */
  private async emitFailureAudit(context: HandlerContext<TAuth, AuditContext>, errorMsg: string): Promise<void> {
    try {
      await this.emitAudit({ ...this.auditBaseOf(context), status: 'failure', errorMsg });
    } catch {
      return;
    }
  }

  private auditBaseOf(context: HandlerContext<TAuth, AuditContext>): AuditBase {
    const entityId = context.audit.entityId ?? 'unknown';
    return {
      tenantId:   this.options.getTenantId?.(context.auth),
      entityType: context.audit.entityType,
      entityId,
      entityName: context.audit.entityName ?? entityId,
      action:     context.audit.action,
      actor:      this.options.getActor?.(context.auth),
      changes:    context.audit.changes,
      metadata:   context.audit.metadata,
    };
  }

  private newAuditContext(route: Route, service: ServiceSpec<TAuth, AuditContext>, requestId: string | undefined): AuditContext {
    return {
      entityType: route.basePath.replace(/^\//, '').replace(/\/+$/, ''),
      action:     `${service.serviceName}/${route.methodName}`,
      metadata:   requestId ? { requestId } : undefined,
    };
  }

  private findService(route: Route): ServiceSpec<TAuth, AuditContext> | undefined {
    return route.serviceName
      ? this.options.registry.get(route.basePath, route.serviceName)
      : this.options.registry.getDefault(route.basePath);
  }

  private httpMethodOf(event: ApiGatewayV2EventLike): string {
    return (event.requestContext?.http?.method ?? '').toUpperCase();
  }

  /**
   * Reads `/{basePath}/{method}` (the shape the generated TypeScript clients call) or, with a third segment,
   * `/{basePath}/{service}/{method}`.
   */
  private parseRoute(event: ApiGatewayV2EventLike): Route {
    const rawPath = event.rawPath ?? '';
    const parts   = rawPath.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error(`invalid path: ${rawPath}`);
    }

    if (parts.length >= 3) {
      return { basePath: `/${parts[0]}`, serviceName: parts[1], methodName: parts[2] };
    }

    return { basePath: `/${parts[0]}`, serviceName: '', methodName: parts[1] };
  }

  private jsonResponse(statusCode: number, body: unknown): ApiGatewayV2ResultLike {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body:    JSON.stringify(body, (key: string, value: unknown) => this.serializableValue(key, value)),
    };
  }

  private errorResponse(statusCode: number, message: unknown): ApiGatewayV2ResultLike {
    return this.jsonResponse(statusCode, { error: { message } });
  }

  /** Drops protobuf's `$typeName` marker and writes a bigint, which JSON cannot hold, as a string. */
  private serializableValue(key: string, value: unknown): unknown {
    if (key === '$typeName') {return undefined;}
    return typeof value === 'bigint' ? value.toString() : value;
  }

  /** The `message` of whatever was thrown, as it is — an object may carry a non-string one — or else the thrown value as text. */
  private messageOf(thrown: unknown): unknown {
    const isObjectLike     = (typeof thrown === 'object' && thrown !== null) || typeof thrown === 'function';
    const message: unknown = isObjectLike ? Reflect.get(thrown, 'message') : undefined;
    return message ?? String(thrown);
  }

  private statusCodeOf(thrown: unknown): number {
    if (!thrown) {return 200;}

    if (thrown instanceof InvalidInputError) {return 400;}
    if (thrown instanceof NotFoundError) {return 404;}
    if (thrown instanceof ForbiddenError) {return 403;}

    if (thrown instanceof ConflictError) {
      const reason = (thrown.reason ?? thrown.message).toLowerCase();
      if (reason.includes('already exists')) {return 400;}
      return 409;
    }

    return 500;
  }

  private startsWithReadVerb(methodName: string): boolean {
    const name = methodName.toLowerCase();
    return name.startsWith('get') || name.startsWith('list');
  }
}
