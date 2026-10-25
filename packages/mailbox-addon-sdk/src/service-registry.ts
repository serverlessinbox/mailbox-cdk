import type { ServiceSpec } from './service-spec';

/**
 * The services the admin API serves, looked up by base path and service name. Both are matched
 * case-insensitively, and a base path is matched with or without its leading and trailing slash.
 */
export class ServiceRegistry<TAuth = unknown, TAudit = unknown> {
  private readonly services = new Map<string, Map<string, ServiceSpec<TAuth, TAudit>>>();

  public register(service: ServiceSpec<TAuth, TAudit>): void {
    const basePath   = this.normalizeBasePath(service.basePath);
    const baseKey    = basePath.toLowerCase();
    const serviceKey = service.serviceName.toLowerCase();

    const perBase = this.services.get(baseKey) ?? new Map<string, ServiceSpec<TAuth, TAudit>>();
    perBase.set(serviceKey, { ...service, basePath });
    this.services.set(baseKey, perBase);
  }

  public get(basePath: string, serviceName: string): ServiceSpec<TAuth, TAudit> | undefined {
    const perBase = this.services.get(this.normalizeBasePath(basePath).toLowerCase());
    return perBase?.get(serviceName.toLowerCase());
  }

  /** The only service registered under the base path; none when the base path has zero or several. */
  public getDefault(basePath: string): ServiceSpec<TAuth, TAudit> | undefined {
    const perBase = this.services.get(this.normalizeBasePath(basePath).toLowerCase());
    if (!perBase) {return undefined;}
    if (perBase.size !== 1) {return undefined;}
    return perBase.values().next().value;
  }

  private normalizeBasePath(basePath: string): string {
    const trimmed = basePath.replace(/\/+$/, '');
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}
