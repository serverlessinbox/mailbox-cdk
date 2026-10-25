import { fromJson, isMessage, toJson }                  from '@bufbuild/protobuf';
import type { DescMessage }                             from '@bufbuild/protobuf';

import type { HandlerContext, MethodSpec, ServiceSpec } from './service-spec';

/** One method of a generated service: the name of the handler that serves it and the protobuf schemas of its messages. */
export type GeneratedMethodRuntime = {
  name:           string;
  handlerName:    string;
  requestSchema:  DescMessage;
  responseSchema: DescMessage;
};

/** A generated service: its route and its methods by name. */
export type GeneratedServiceRuntime = {
  basePath:    string;
  serviceName: string;
  methods:     Record<string, GeneratedMethodRuntime>;
};

/** Overrides for how a generated service validates requests and serializes responses. */
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

/**
 * Builds the `ServiceSpec` of a generated service from its runtime description and a record of handlers keyed
 * by handler name. Every method of the runtime must have a handler of that name.
 */
export class ServiceSpecBuilder<TAuth = unknown, TAudit = unknown> {
  constructor(
    private readonly runtime: GeneratedServiceRuntime,
    private readonly handlers: Record<string, unknown>,
    private readonly options: ServiceSpecFromRuntimeOptions = {},
  ) {}

  public build(): ServiceSpec<TAuth, TAudit> {
    const methods: Record<string, MethodSpec<unknown, unknown, TAuth, TAudit>> = {};

    for (const [methodName, meta] of Object.entries(this.runtime.methods)) {
      this.resolveHandler(methodName, meta);
      methods[methodName] = this.buildMethod(methodName, meta);
    }

    return {
      basePath:    this.runtime.basePath,
      serviceName: this.runtime.serviceName,
      methods,
    };
  }

  private buildMethod(methodName: string, meta: GeneratedMethodRuntime): MethodSpec<unknown, unknown, TAuth, TAudit> {
    return {
      name:              meta.name,
      validate:          this.options.getValidator?.(methodName, meta.handlerName) ?? ((req) => fromJson(meta.requestSchema, req)),
      serializeResponse: (resp) => this.serialize(methodName, meta, resp),
      handler:           (ctx, req) => this.callHandler(methodName, meta, ctx, req),
    };
  }

  private serialize(methodName: string, meta: GeneratedMethodRuntime, resp: unknown): unknown {
    if (this.options.serializeResponse) {
      return this.options.serializeResponse(methodName, resp);
    }

    if (!isMessage(resp, meta.responseSchema)) {
      throw new Error(`Response of ${this.runtime.serviceName}.${methodName} is not a ${meta.responseSchema.typeName} message`);
    }
    return toJson(meta.responseSchema, resp);
  }

  /**
   * Looks the handler up on every call, with the handlers record as `this`, so a handler replaced after the
   * build is the one called. A handler that throws before returning a promise throws from here too.
   */
  private callHandler(
    methodName: string,
    meta: GeneratedMethodRuntime,
    ctx: HandlerContext<TAuth, TAudit>,
    req: unknown,
  ): Promise<unknown> {
    const result: unknown = Reflect.apply(this.resolveHandler(methodName, meta), this.handlers, [ctx, req]);
    return Promise.resolve(result);
  }

  private resolveHandler(methodName: string, meta: GeneratedMethodRuntime): Function {
    const candidate = this.handlers[meta.handlerName];
    if (typeof candidate !== 'function') {
      throw new Error(`Missing handler for ${this.runtime.serviceName}.${methodName}: expected handlers.${meta.handlerName}()`);
    }
    return candidate;
  }
}
