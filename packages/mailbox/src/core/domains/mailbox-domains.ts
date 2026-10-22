import { Fn, Token } from 'aws-cdk-lib';

export const MAILBOX_ENDPOINTS = [
  'ws',
  'api',
  'jmap',
  'cdn',
  'webmail',
  'admin',
  'auth',
  'mcp',
] as const;

export type MailboxEndpoint = typeof MAILBOX_ENDPOINTS[number];

export interface MailboxDomainNamesProps {
  /** Base domain, e.g. example.com */
  readonly domainName: string;

  /** Optional extra label between endpoint and base domain, e.g. "mailbox" -> api.mailbox.example.com */
  readonly prefix?: string;

  /** Override the subdomain label for any endpoint. All labels must be valid single DNS labels (no dots). */
  readonly subdomainOverrides?: {
    admin?:   string;
    webmail?: string;
    jmap?:    string;
    api?:     string;
    ws?:      string;
  };

  readonly prefixConditionName?: string;
}

export interface IMailboxDomainNames {
  readonly domainName: string;
  readonly prefix?:    string;
  /** The namespace suffix for relative labels: either ".{prefix}" or "", resolved once at construction. */
  readonly relativeNamespaceSuffix: string;

  readonly ws:      string;
  readonly api:     string;
  readonly jmap:    string;
  readonly cdn:     string;
  readonly webmail: string;
  readonly admin:   string;
  readonly auth:    string;
  readonly mcp:     string;

  fqdn(endpoint: MailboxEndpoint): string;
  /** Subdomain label(s) relative to the hosted zone root, safe to pass as Route53 recordName. */
  relativeLabel(endpoint: MailboxEndpoint): string;
  all(): Record<MailboxEndpoint, string>;
}

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeDomainName(domainName: string): string {
  if (Token.isUnresolved(domainName)) {
    return domainName;
  }

  const normalized = domainName.trim().toLowerCase().replace(/\.+$/, '');
  if (!normalized) {
    throw new Error('domainName is required');
  }

  if (normalized.includes('://') || normalized.includes('/')) {
    throw new Error(`domainName must be a bare DNS name, got: ${domainName}`);
  }

  const labels = normalized.split('.');
  for (const label of labels) {
    if (!DNS_LABEL_RE.test(label)) {
      throw new Error(`domainName contains invalid DNS label: ${label}`);
    }
  }

  return normalized;
}

function normalizePrefix(prefix?: string): string | undefined {
  if (prefix === undefined) {
    return undefined;
  }

  if (Token.isUnresolved(prefix)) {
    return prefix;
  }

  const normalized = prefix.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('.')) {
    throw new Error(`prefix must be a single DNS label (no dots), got: ${prefix}`);
  }

  if (!DNS_LABEL_RE.test(normalized)) {
    throw new Error(`prefix is not a valid DNS label, got: ${prefix}`);
  }

  return normalized;
}

export class MailboxDomains implements IMailboxDomainNames {
  public readonly domainName: string;
  public readonly prefix?: string;
  public readonly relativeNamespaceSuffix: string;

  public readonly ws: string;
  public readonly api: string;
  public readonly jmap: string;
  public readonly cdn: string;
  public readonly webmail: string;
  public readonly admin: string;
  public readonly auth: string;
  public readonly mcp: string;

  /** Per-endpoint relative labels (subdomain label + optional namespace, without the zone). */
  private readonly relativeLabels: Record<MailboxEndpoint, string>;

  constructor(props: MailboxDomainNamesProps) {
    this.domainName = normalizeDomainName(props.domainName);

    this.prefix = normalizePrefix(props.prefix);

    // Compute base domain (e.g. "example.com" or "mailbox.example.com")
    const base = (() => {
      if (this.prefix && Token.isUnresolved(this.prefix) && props.prefixConditionName) {
        return Fn.conditionIf(
          props.prefixConditionName,
          `${this.prefix}.${this.domainName}`,
          this.domainName,
        ).toString();
      }
      return this.prefix ? `${this.prefix}.${this.domainName}` : this.domainName;
    })();

    // Compute relative namespace suffix (e.g. ".mailbox" or "") — resolved once via Fn.conditionIf if needed
    this.relativeNamespaceSuffix = (() => {
      if (this.prefix && Token.isUnresolved(this.prefix) && props.prefixConditionName) {
        return Fn.conditionIf(
          props.prefixConditionName,
          `.${this.prefix}`,
          '',
        ).toString();
      }
      return this.prefix ? `.${this.prefix}` : '';
    })();

    const { subdomainOverrides } = props;

    this.ws      = `${subdomainOverrides?.ws ?? 'ws'}.${base}`;
    this.api     = `${subdomainOverrides?.api ?? 'api'}.${base}`;
    this.jmap    = `${subdomainOverrides?.jmap ?? 'jmap'}.${base}`;
    this.webmail = `${subdomainOverrides?.webmail ?? 'webmail'}.${base}`;
    this.admin   = `${subdomainOverrides?.admin ?? 'admin'}.${base}`;
    // cdn, auth, mcp remain hardcoded — not exposed in MailboxOverrides.subdomains
    this.cdn  = `cdn.${base}`;
    this.auth = `auth.${base}`;
    this.mcp  = `mcp.${base}`;

    // Build relative record names (subdomain label + optional namespace, without the zone).
    // These are safe to pass as Route53 recordName — CDK will append the zone automatically.
    this.relativeLabels = {
      ws:      `${subdomainOverrides?.ws ?? 'ws'}${this.relativeNamespaceSuffix}`,
      api:     `${subdomainOverrides?.api ?? 'api'}${this.relativeNamespaceSuffix}`,
      jmap:    `${subdomainOverrides?.jmap ?? 'jmap'}${this.relativeNamespaceSuffix}`,
      webmail: `${subdomainOverrides?.webmail ?? 'webmail'}${this.relativeNamespaceSuffix}`,
      admin:   `${subdomainOverrides?.admin ?? 'admin'}${this.relativeNamespaceSuffix}`,
      cdn:     `cdn${this.relativeNamespaceSuffix}`,
      auth:    `auth${this.relativeNamespaceSuffix}`,
      mcp:     `mcp${this.relativeNamespaceSuffix}`,
    };
  }

  public fqdn(endpoint: MailboxEndpoint): string {
    return this.all()[endpoint];
  }

  public relativeLabel(endpoint: MailboxEndpoint): string {
    return this.relativeLabels[endpoint];
  }

  public all(): Record<MailboxEndpoint, string> {
    return {
      ws:      this.ws,
      api:     this.api,
      jmap:    this.jmap,
      cdn:     this.cdn,
      webmail: this.webmail,
      admin:   this.admin,
      auth:    this.auth,
      mcp:     this.mcp,
    };
  }
}
