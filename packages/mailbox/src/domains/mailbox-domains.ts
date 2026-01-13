import { Token } from 'aws-cdk-lib';

export const MAILBOX_ENDPOINTS = [
  'ws',
  'api',
  'jmap',
  'cdn',
  'webmail',
  'admin',
  'auth',
] as const;

export type MailboxEndpoint = typeof MAILBOX_ENDPOINTS[number];

export interface MailboxDomainNamesProps {
  /** Base domain, e.g. example.com */
  readonly domainName: string;

  /** Optional extra label between endpoint and base domain, e.g. "mailbox" -> api.mailbox.example.com */
  readonly prefix?: string;
}

export interface MailboxDomainNames {
  readonly domainName: string;
  readonly prefix?: string;

  readonly ws: string;
  readonly api: string;
  readonly jmap: string;
  readonly cdn: string;
  readonly webmail: string;
  readonly admin: string;
  readonly auth: string;

  fqdn(endpoint: MailboxEndpoint): string;
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

export class MailboxDomains implements MailboxDomainNames {
  public readonly domainName: string;
  public readonly prefix?: string;

  public readonly ws: string;
  public readonly api: string;
  public readonly jmap: string;
  public readonly cdn: string;
  public readonly webmail: string;
  public readonly admin: string;
  public readonly auth: string;

  constructor(props: MailboxDomainNamesProps) {
    this.domainName = normalizeDomainName(props.domainName);

    this.prefix = normalizePrefix(props.prefix);

    const base = this.prefix ? `${this.prefix}.${this.domainName}` : this.domainName;

    this.ws = `ws.${base}`;
    this.api = `api.${base}`;
    this.jmap = `jmap.${base}`;
    this.cdn = `cdn.${base}`;
    this.webmail = `webmail.${base}`;
    this.admin = `admin.${base}`;
    this.auth = `auth.${base}`;
  }

  public fqdn(endpoint: MailboxEndpoint): string {
    return this.all()[endpoint];
  }

  public all(): Record<MailboxEndpoint, string> {
    return {
      ws: this.ws,
      api: this.api,
      jmap: this.jmap,
      cdn: this.cdn,
      webmail: this.webmail,
      admin: this.admin,
      auth: this.auth,
    };
  }
}
