export type HandlerContext<TAuth = unknown, TAudit = unknown> = {
  auth: TAuth;
  audit: TAudit;
  requestId?: string;
};

export type MethodSpec<TReq, TResp, TAuth = unknown, TAudit = unknown> = {
  name: string;
  validate: (req: unknown) => TReq;
  handler: (ctx: HandlerContext<TAuth, TAudit>, req: TReq) => Promise<TResp>;

  /** Optional: serialize the handler result to JSON-safe output (e.g. protobuf JSON mapping). */
  serializeResponse?: (resp: TResp) => unknown;
};

export type ServiceSpec<TAuth = unknown, TAudit = unknown> = {
  /** First path segment (e.g. /idp-users) */
  basePath: string;
  /** Second path segment (e.g. IdpUsers) */
  serviceName: string;
  methods: Record<string, MethodSpec<any, any, TAuth, TAudit>>;
};

export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export class ServiceRegistry<TAuth = unknown, TAudit = unknown> {
  private readonly services = new Map<string, Map<string, ServiceSpec<TAuth, TAudit>>>();

  register(service: ServiceSpec<TAuth, TAudit>): void {
    const basePath   = normalizeBasePath(service.basePath);
    const baseKey    = basePath.toLowerCase();
    const serviceKey = service.serviceName.toLowerCase();

    const perBase = this.services.get(baseKey) ?? new Map<string, ServiceSpec<TAuth, TAudit>>();
    perBase.set(serviceKey, { ...service, basePath });
    this.services.set(baseKey, perBase);
  }

  get(basePath: string, serviceName: string): ServiceSpec<TAuth, TAudit> | undefined {
    const perBase = this.services.get(normalizeBasePath(basePath).toLowerCase());
    return perBase?.get(serviceName.toLowerCase());
  }

  getDefault(basePath: string): ServiceSpec<TAuth, TAudit> | undefined {
    const perBase = this.services.get(normalizeBasePath(basePath).toLowerCase());
    if (!perBase) {return undefined;}
    if (perBase.size !== 1) {return undefined;}
    return perBase.values().next().value;
  }
}
