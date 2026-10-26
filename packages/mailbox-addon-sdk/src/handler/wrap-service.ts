import type { AuditSink }                                            from '../audit/index';

import type { AddonHandler }                                         from './addon-handler';
import type { GeneratedService, MessageHandlers, ServiceHandlersOf } from './generated-service';
import { RequestCore }                                               from './request-core';
import type { RequestLogger }                                        from './request-logger';
import { ServiceRoutes }                                             from './service-routes';

/**
 * Serves an IDL-generated service: the method is the last segment of the request path and its body is decoded and
 * encoded with the generated protobuf schemas. The compiler rejects a handlers object that lacks a method of the
 * service or types a request, a response or the context differently.
 */
export function wrapService<Service extends GeneratedService>(
  runtime: Service,
  handlers: ServiceHandlersOf<Service>,
  auditSink: AuditSink,
  logger: RequestLogger,
): AddonHandler;
export function wrapService(
  runtime: GeneratedService,
  handlers: MessageHandlers,
  auditSink: AuditSink,
  logger: RequestLogger,
): AddonHandler {
  const routes = new ServiceRoutes(runtime, handlers);
  const core   = new RequestCore(auditSink, logger);

  return (event) => core.handle(event, (incoming) => routes.dispatchOf(incoming));
}
