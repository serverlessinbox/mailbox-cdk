import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import type { AuthorizedEvent }                   from '../caller/authorized-event';
import type { CallerContextReader }               from '../caller/caller-context-reader';
import type { Caller }                            from '../caller/caller';
import {
  AlreadyExistsError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
}                                                 from '../errors';
import { JsonBodyReader }                         from '../json-body-reader';

import type { RequestLogger }                     from './request-logger';
import type { ServiceMethod }                     from './service-method';

/** An error class and the HTTP status it answers with. */
interface StatusRule {
  readonly errorClass: abstract new (...args: never[]) => Error;
  readonly status:     number;
}

const STATUS_RULES: readonly StatusRule[] = [
  { errorClass: InvalidInputError, status: 400 },
  { errorClass: UnauthenticatedError, status: 401 },
  { errorClass: ForbiddenError, status: 403 },
  { errorClass: NotFoundError, status: 404 },
  { errorClass: AlreadyExistsError, status: 409 },
  { errorClass: ConflictError, status: 409 },
];

const SERVER_ERROR_STATUS = 500;
const SERVER_ERROR_BODY   = 'internal server error';

/**
 * Serves the one service of an addon Lambda: an API Gateway HTTP API request is read as a call of one of the
 * service's methods and answered with plain text on failure. Per request it reads the caller, checks that the
 * caller may call the method, reads the body and runs the method. The caller is read before the body, so a
 * request that is not authenticated learns nothing about its body.
 *
 * A failure answers with the status its error maps to; a failure that maps to none is a server error, whose
 * answer never carries its cause. The cause is logged, and the trace of that request is flushed.
 */
export class ServiceRuntime {
  public readonly basePath: string;
  private readonly bodyReader = new JsonBodyReader();

  constructor(
    basePath: string,
    private readonly methods: ReadonlyMap<string, ServiceMethod>,
    private readonly adminGroups: readonly string[],
    private readonly callerReader: CallerContextReader,
    private readonly logger: RequestLogger,
  ) {
    this.basePath = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  }

  public async handle(event: AuthorizedEvent): Promise<APIGatewayProxyStructuredResultV2> {
    const requestId = event.requestContext.requestId;
    this.logger.debug('request received', { requestId, path: event.rawPath });

    try {
      return await this.serve(event, requestId);
    } catch (thrown) {
      return this.answerFailure(thrown, requestId);
    }
  }

  private async serve(event: AuthorizedEvent, requestId: string): Promise<APIGatewayProxyStructuredResultV2> {
    if (event.requestContext.http.method.toUpperCase() !== 'POST') {
      return this.textResponse(405, 'method not allowed');
    }

    const method = this.methodOf(event.rawPath);

    const caller = this.callerReader.read(event);
    this.logger.debug('caller read', { requestId, tenantId: caller.tenantId, principalId: caller.principalId });
    this.authorize(method, caller);

    const body   = this.bodyReader.read(event.body);
    const result = await method.invoke({ caller, requestId }, body);
    this.logger.debug('request served', { requestId });

    return this.jsonResponse(result ?? {});
  }

  private methodOf(rawPath: string): ServiceMethod {
    const prefix = `${this.basePath}/`;
    const method = rawPath.startsWith(prefix) ? this.methods.get(rawPath.slice(prefix.length)) : undefined;
    if (!method) {
      throw new NotFoundError('method not found');
    }
    return method;
  }

  /** A method is admin-only unless it declares `admin: false`; the callers that are admin come from the configured admin groups. */
  private authorize(method: ServiceMethod, caller: Caller): void {
    if (method.admin === false) {
      return;
    }
    if (!caller.groups.some((group) => this.adminGroups.includes(group))) {
      throw new ForbiddenError('forbidden');
    }
  }

  private answerFailure(thrown: unknown, requestId: string): APIGatewayProxyStructuredResultV2 {
    const status = this.statusOf(thrown);
    const cause  = this.causeOf(thrown);

    if (status === SERVER_ERROR_STATUS) {
      this.logger.error('request failed', { requestId, cause });
      this.logger.flush();
      return this.textResponse(status, SERVER_ERROR_BODY);
    }

    this.logger.warn('request refused', { requestId, status, cause });
    return this.textResponse(status, cause);
  }

  private statusOf(thrown: unknown): number {
    const rule = STATUS_RULES.find((candidate) => thrown instanceof candidate.errorClass);
    return rule?.status ?? SERVER_ERROR_STATUS;
  }

  private causeOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }

  private textResponse(statusCode: number, body: string): APIGatewayProxyStructuredResultV2 {
    return { statusCode, headers: { 'content-type': 'text/plain; charset=utf-8' }, body };
  }

  private jsonResponse(result: unknown): APIGatewayProxyStructuredResultV2 {
    return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) };
  }
}
