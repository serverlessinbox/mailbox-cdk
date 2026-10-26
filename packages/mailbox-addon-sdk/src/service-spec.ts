import type { JsonValue } from './json/index';

/** What a service handler is called with besides the request: the caller's auth, its audit record and the request id. */
export type HandlerContext<TAuth = unknown, TAudit = unknown> = {
  auth:       TAuth;
  audit:      TAudit;
  requestId?: string;
};

/** One RPC method of a service: how its request body is validated, handled and serialized. */
export type MethodSpec<TReq, TResp, TAuth = unknown, TAudit = unknown> = {
  name:     string;
  validate: (req: JsonValue) => TReq;
  handler:  (ctx: HandlerContext<TAuth, TAudit>, req: TReq) => Promise<TResp>;

  /** Optional: serialize the handler result to JSON-safe output (e.g. protobuf JSON mapping). */
  serializeResponse?: (resp: TResp) => unknown;
};

/**
 * A service the admin API serves. Its methods are stored with unknown request and response types, because a
 * request is only known to be valid after the method's own `validate` has accepted it.
 */
export type ServiceSpec<TAuth = unknown, TAudit = unknown> = {
  /** First path segment (e.g. /idp-users) */
  basePath: string;
  /** Second path segment (e.g. IdpUsers) */
  serviceName: string;
  methods:     Record<string, MethodSpec<unknown, unknown, TAuth, TAudit>>;
};
