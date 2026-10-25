import { Fn, Token }                      from 'aws-cdk-lib';

import type { MailboxSubdomainOverrides } from '../../mailbox-props';

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

/** One of the endpoints a Mailbox serves under its domain. */
export type MailboxEndpoint = typeof MAILBOX_ENDPOINTS[number];

/** What the endpoint names of a Mailbox are built from. */
export interface MailboxDomainNamesProps {
  /**
   * Base domain, e.g. example.com. Absent when the Mailbox has no domain: the base domain is then
   * empty and every name is its label followed by a dot.
   */
  readonly domainName?: string;

  /** Optional extra label between endpoint and base domain, e.g. "mailbox" -> api.mailbox.example.com */
  readonly prefix?: string;

  /** Override the subdomain label for any endpoint. All labels must be valid single DNS labels (no dots). */
  readonly subdomainOverrides?: MailboxSubdomainOverrides;

  /** The CloudFormation condition that is true when an unresolved `prefix` is non-empty at deploy time. */
  readonly prefixConditionName?: string;
}

/** The base domain of a Mailbox and the name of each endpoint under it. */
export interface IMailboxDomainNames {
  readonly domainName: string;
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
}

/**
 * The validated base domain and namespace of a Mailbox, and the full and zone-relative name of each
 * of its endpoints. Holds names only: it creates no construct.
 */
export class MailboxDomains implements IMailboxDomainNames {
  private static readonly DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  public readonly domainName: string;
  public readonly relativeNamespaceSuffix: string;

  public readonly ws: string;
  public readonly api: string;
  public readonly jmap: string;
  public readonly cdn: string;
  public readonly webmail: string;
  public readonly admin: string;
  public readonly auth: string;
  public readonly mcp: string;

  /** The subdomain label of each endpoint: its override, else its default. */
  private readonly labels: Record<MailboxEndpoint, string>;

  constructor(props: MailboxDomainNamesProps) {
    this.domainName = props.domainName === undefined ? '' : this.normalizeDomainName(props.domainName);

    const prefix = this.normalizePrefix(props.prefix);

    const base = this.namespaced(
      prefix,
      props.prefixConditionName,
      (namespace) => `${namespace}.${this.domainName}`,
      this.domainName,
    );

    this.relativeNamespaceSuffix = this.namespaced(
      prefix,
      props.prefixConditionName,
      (namespace) => `.${namespace}`,
      '',
    );

    const { subdomainOverrides } = props;

    this.labels = {
      ws:      this.resolveLabel('ws', subdomainOverrides?.ws),
      api:     this.resolveLabel('api', subdomainOverrides?.api),
      jmap:    this.resolveLabel('jmap', subdomainOverrides?.jmap),
      webmail: this.resolveLabel('webmail', subdomainOverrides?.webmail),
      admin:   this.resolveLabel('admin', subdomainOverrides?.admin),
      cdn:     this.resolveLabel('cdn', subdomainOverrides?.cdn),
      auth:    'auth',
      mcp:     this.resolveLabel('mcp', subdomainOverrides?.mcp),
    };

    this.ws      = `${this.labels.ws}.${base}`;
    this.api     = `${this.labels.api}.${base}`;
    this.jmap    = `${this.labels.jmap}.${base}`;
    this.webmail = `${this.labels.webmail}.${base}`;
    this.admin   = `${this.labels.admin}.${base}`;
    this.cdn     = `${this.labels.cdn}.${base}`;
    this.auth    = `${this.labels.auth}.${base}`;
    this.mcp     = `${this.labels.mcp}.${base}`;
  }

  public fqdn(endpoint: MailboxEndpoint): string {
    return this[endpoint];
  }

  public relativeLabel(endpoint: MailboxEndpoint): string {
    return `${this.labels[endpoint]}${this.relativeNamespaceSuffix}`;
  }

  /**
   * The endpoint's override, else its own name. A token is known only at deploy time, so it is
   * passed through unchecked; any other override is lower-cased and must be a single DNS label.
   */
  private resolveLabel(endpoint: MailboxEndpoint, override: string | undefined): string {
    if (override === undefined) {
      return endpoint;
    }

    if (Token.isUnresolved(override)) {
      return override;
    }

    const normalized = override.trim().toLowerCase();
    if (!MailboxDomains.DNS_LABEL_RE.test(normalized)) {
      throw new Error(`subdomain override "${endpoint}" must be a single valid DNS label, got: "${override}"`);
    }

    return normalized;
  }

  private normalizeDomainName(domainName: string): string {
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
      if (!MailboxDomains.DNS_LABEL_RE.test(label)) {
        throw new Error(`domainName contains invalid DNS label: ${label}`);
      }
    }

    return normalized;
  }

  private normalizePrefix(prefix?: string): string | undefined {
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

    if (!MailboxDomains.DNS_LABEL_RE.test(normalized)) {
      throw new Error(`prefix is not a valid DNS label, got: ${prefix}`);
    }

    return normalized;
  }

  /**
   * Picks between a name with the namespace and one without. An unresolved prefix is known only at
   * deploy time, so the pick is a CloudFormation `Fn::If` on the namespace condition.
   */
  private namespaced(
    prefix: string | undefined,
    conditionName: string | undefined,
    withNamespace: (prefix: string) => string,
    withoutNamespace: string,
  ): string {
    if (!prefix) {
      return withoutNamespace;
    }

    if (Token.isUnresolved(prefix) && conditionName) {
      return Fn.conditionIf(conditionName, withNamespace(prefix), withoutNamespace).toString();
    }

    return withNamespace(prefix);
  }
}
