import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { AuditRecorder }                          from '../audit/audit-recorder';
import type { AuditSink }                         from '../audit/index';
import type { AuthorizedEvent }                   from '../caller/authorized-event';
import { CallerContextReader }                    from '../caller/caller-context-reader';
import type { Caller }                            from '../caller/caller';
import type { HandlerContext }                    from '../caller/handler-context';
import {
  AlreadyExistsError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthenticatedError,
}                                                 from '../errors/index';
import { JsonBodyReader, type JsonValue }         from '../json/index';

import type { Dispatch }                          from './addon-handler';
import type { RequestLogger }                     from './request-logger';

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
 * What every addon Lambda does for a request, whatever it serves: read the caller, read the body, hand both to
 * the work of the endpoint and answer. The caller is read before the body, so a request that is not
 * authenticated learns nothing about its body. The core does no admin or group check: who may reach the Lambda
 * is decided before it runs.
 *
 * The core records nothing in the audit on its own. The work records its audit event through the `recordAudit`
 * of its context; a sink failure rejects that call and is the work's to handle.
 *
 * A failure answers with the status its error maps to, as plain text; a failure that maps to none is a server
 * error, whose answer never carries its cause. The cause is logged and the trace of that request is flushed.
 */
export class RequestCore {
  private readonly callerReader = new CallerContextReader();
  private readonly bodyReader   = new JsonBodyReader();

  constructor(
    private readonly auditSink: AuditSink,
    private readonly logger: RequestLogger,
  ) {}

  /** `dispatchOf` runs inside the failure handling, so an unknown method answers 404 through the same mapping. */
  public async handle(event: AuthorizedEvent, dispatchOf: (event: AuthorizedEvent) => Dispatch): Promise<APIGatewayProxyStructuredResultV2> {
    const requestId = event.requestContext.requestId;
    this.logger.debug('request received', { requestId, path: event.rawPath });

    try {
      return await this.serve(event, requestId, dispatchOf);
    } catch (thrown) {
      return this.answerFailure(thrown, requestId);
    }
  }

  private async serve(
    event: AuthorizedEvent,
    requestId: string,
    dispatchOf: (event: AuthorizedEvent) => Dispatch,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const dispatch = dispatchOf(event);

    const caller = this.callerReader.read(event);
    this.logger.debug('caller read', { requestId, tenantId: caller.tenantId, principalId: caller.principalId });

    const body    = this.bodyReader.read(event.body);
    const context = this.contextOf(event, dispatch, caller);

    const result = await dispatch.work(context, body);
    this.logger.debug('request served', { requestId });

    return this.jsonResponse(result);
  }

  private contextOf(event: AuthorizedEvent, dispatch: Dispatch, caller: Caller): HandlerContext {
    const recorder = new AuditRecorder(this.auditSink, caller, event.requestContext.http.sourceIp, dispatch.endpoint.entityType, dispatch.endpoint.action);

    return {
      caller,
      requestId:   event.requestContext.requestId,
      recordAudit: (entry) => recorder.record(entry),
    };
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

  private jsonResponse(result: JsonValue): APIGatewayProxyStructuredResultV2 {
    return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) };
  }
}
