import { statusCodeForError }                                            from './errors';
import type { ServiceRegistry }                                          from './registry';
import type { ApiGatewayV2EventLike, ApiGatewayV2ResultLike, JsonValue } from './types';

export type AuditEvent = {
  tenantId?: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  action: string;
  status: 'success' | 'failure';
  errorMsg?: string;
  actor?: unknown;
  changes?: unknown[];
  metadata?: Record<string, string>;
};

export type AuditContext = {
  entityType: string;
  entityId?: string;
  entityName?: string;
  changes?: unknown[];
  metadata?: Record<string, string>;
  action: string;
};

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

function json(statusCode: number, body: JsonValue): ApiGatewayV2ResultLike {
  const safeBody = JSON.stringify(body, (key, value) => {
    if (key === '$typeName') {return undefined;}
    return typeof value === 'bigint' ? value.toString() : value;
  });
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: safeBody,
  };
}

function parsePath(
  event: ApiGatewayV2EventLike
): { basePath: string; service?: string; method: string } {
  const rawPath = event.rawPath ?? '';
  const parts   = rawPath.split('/').filter(Boolean);
  // Prefer: /{basePath}/{method} (matches generated TS clients)
  // Fallback: /{basePath}/{service}/{method}
  if (parts.length < 2) {
    throw new Error(`invalid path: ${rawPath}`);
  }

  if (parts.length >= 3) {
    return { basePath: `/${parts[0]}`, service: parts[1], method: parts[2] };
  }

  return { basePath: `/${parts[0]}`, method: parts[1] };
}

function safeParseJson(body: string | null | undefined): unknown {
  if (!body) {return {};}
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('invalid JSON body');
  }
}

export function createAdminApiHandler<TAuth>(options: AdminApiHandlerOptions<TAuth>) {
  const isRead = options.isReadMethod ?? ((m) => {
    const name = m.toLowerCase();
    return name.startsWith('get') || name.startsWith('list');
  });

  return async (event: ApiGatewayV2EventLike): Promise<ApiGatewayV2ResultLike> => {
    const httpMethod = (event.requestContext?.http?.method ?? '').toUpperCase();
    if (httpMethod !== 'POST') {
      return json(405, { error: { message: 'method not allowed' } });
    }

    let basePath: string;
    let serviceName: string;
    let methodName: string;

    try {
      const parsed = parsePath(event);
      basePath     = parsed.basePath;
      serviceName  = parsed.service ?? '';
      methodName   = parsed.method;
    } catch (e) {
      return json(400, { error: { message: (e as Error).message } });
    }

    const service = serviceName
      ? options.registry.get(basePath, serviceName)
      : options.registry.getDefault(basePath);
    if (!service) {
      return json(404, { error: { message: 'service not found' } });
    }

    const method = service.methods[methodName];
    if (!method) {
      return json(404, { error: { message: 'method not found' } });
    }

    let auth: TAuth;
    try {
      auth = options.extractAuth(event);
    } catch (e) {
      const status = statusCodeForError(e);
      return json(status, { error: { message: (e as Error)?.message ?? String(e) } });
    }

    const requestId           = (event.requestContext as any)?.requestId ?? undefined;
    const audit: AuditContext = {
      entityType: basePath.replace(/^\//, '').replace(/\/+$/, ''),
      action: `${service.serviceName}/${methodName}`,
      metadata: requestId ? { requestId } : undefined,
    };

    const ctx = {
      auth,
      audit,
      requestId,
    };

    const reqBody = safeParseJson(event.body);

    const isReadMethod = isRead(methodName);

    try {
      const validatedReq = method.validate(reqBody);
      const rawResult    = await method.handler(ctx as any, validatedReq);
      const result       = method.serializeResponse ? method.serializeResponse(rawResult) : rawResult;

      if (!isReadMethod && options.emitAuditEvent) {
        const entityId = audit.entityId ?? 'unknown';
        await options.emitAuditEvent({
          tenantId: options.getTenantId?.(auth),
          entityType: audit.entityType,
          entityId,
          entityName: audit.entityName ?? entityId,
          action: audit.action,
          status: 'success',
          actor: options.getActor?.(auth),
          changes: audit.changes,
          metadata: audit.metadata,
        });
      }

      return json(200, (result ?? {}) as JsonValue);
    } catch (e) {
      const status = statusCodeForError(e);

      if (!isReadMethod && options.emitAuditEvent) {
        const entityId = audit.entityId ?? 'unknown';
        try {
          await options.emitAuditEvent({
            tenantId: options.getTenantId?.(auth),
            entityType: audit.entityType,
            entityId,
            entityName: audit.entityName ?? entityId,
            action: audit.action,
            status: 'failure',
            errorMsg: (e as Error)?.message ?? String(e),
            actor: options.getActor?.(auth),
            changes: audit.changes,
            metadata: audit.metadata,
          });
        } catch {
          // swallow audit failures
        }
      }

      return json(status, { error: { message: (e as Error)?.message ?? String(e) } });
    }
  };
}
