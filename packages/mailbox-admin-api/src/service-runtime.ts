import { fromJson, toJson } from '@bufbuild/protobuf';

import type { HandlerContext, MethodSpec, ServiceSpec } from './registry';

export type GeneratedMethodRuntime = {
  name: string;
  handlerName: string;
  requestSchema: unknown;
  responseSchema: unknown;
};

export type GeneratedServiceRuntime = {
  basePath: string;
  serviceName: string;
  methods: Record<string, GeneratedMethodRuntime>;
};

export type ServiceSpecFromRuntimeOptions = {
  /**
   * Optional validator resolver. If omitted, request bodies are parsed via protobuf JSON mapping.
   */
  getValidator?: (methodName: string, handlerName: string) => ((req: unknown) => unknown) | undefined;

  /**
   * Optional response serializer override. If omitted, protobuf JSON mapping is used.
   */
  serializeResponse?: (methodName: string, resp: unknown) => unknown;
};

export function createServiceSpecFromRuntime<TAuth = unknown, TAudit = unknown>(
  runtime: GeneratedServiceRuntime,
  handlers: Record<string, unknown>,
  opts: ServiceSpecFromRuntimeOptions = {}
): ServiceSpec<TAuth, TAudit> {
  const methods: Record<string, MethodSpec<any, any, TAuth, TAudit>> = {};

  for (const [methodName, meta] of Object.entries(runtime.methods)) {
    const handlerName = meta.handlerName;

    if (typeof (handlers as any)[handlerName] !== 'function') {
      throw new Error(`Missing handler for ${runtime.serviceName}.${methodName}: expected handlers.${handlerName}()`);
    }

    const validate =
      opts.getValidator?.(methodName, handlerName) ??
      ((req: unknown) => fromJson(meta.requestSchema as any, req as any) as any);

    const serializeResponse =
      opts.serializeResponse ??
      ((_: string, resp: unknown) => toJson(meta.responseSchema as any, resp as any) as any);

    methods[methodName] = {
      name: meta.name,
      validate: validate as any,
      serializeResponse: (resp) => serializeResponse(methodName, resp),
      handler: (ctx: HandlerContext<TAuth, TAudit>, req: unknown) => (handlers as any)[handlerName](ctx, req),
    };
  }

  return {
    basePath: runtime.basePath,
    serviceName: runtime.serviceName,
    methods,
  };
}
