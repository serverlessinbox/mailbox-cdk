import type { AuditEvent, AuditSink }                     from '../../audit/index';
import { toPrincipalId, toTenantId, type HandlerContext } from '../../caller/index';
import type { RequestLogger }                             from '../request-logger';

/** A logger that records what it is asked to write. */
export function loggerDouble(): jest.Mocked<RequestLogger> {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), flush: jest.fn() };
}

/** An audit sink that accepts every event and remembers it. */
export function sinkDouble(): jest.Mocked<AuditSink> {
  return { record: jest.fn<Promise<void>, [AuditEvent]>().mockResolvedValue(undefined) };
}

/** The context of a request from a fixed admin caller, whose audit recording is a spy. */
export function contextDouble(): jest.Mocked<HandlerContext> {
  return {
    caller:      {
      tenantId:      toTenantId('tenant-1'),
      principalId:   toPrincipalId('principal-1'),
      principalName: 'jane',
      displayName:   'Jane Doe',
      groups:        ['admin'],
    },
    requestId:   'request-1',
    recordAudit: jest.fn<Promise<void>, Parameters<HandlerContext['recordAudit']>>().mockResolvedValue(undefined),
  };
}
