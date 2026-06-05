import { MAILBOX_ENDPOINTS, MailboxDomains, MailboxEndpoint } from './mailbox-domains';

export interface MailboxDomainContextProps {
  readonly domains: MailboxDomains;

  /** Which endpoints are considered part of this rollout (synth-time). Default: all endpoints. */
  readonly enabledEndpoints?: MailboxEndpoint[];

  /** Which enabled endpoints should be allowed as browser origins (https://...). Default: webmail + admin. */
  readonly uiEndpoints?: MailboxEndpoint[];

  /** Extra origins not derived from mailbox domains. */
  readonly extraAllowedOrigins?: string[];
}

const DEFAULT_UI_ENDPOINTS: readonly MailboxEndpoint[] = ['webmail', 'admin'];

export class MailboxDomainContext {
  public readonly domains: MailboxDomains;
  public readonly enabledEndpoints: readonly MailboxEndpoint[];
  public readonly uiEndpoints: readonly MailboxEndpoint[];
  public readonly extraAllowedOrigins: readonly string[];

  constructor(props: MailboxDomainContextProps) {
    this.domains = props.domains;

    const enabled = (props.enabledEndpoints ?? MAILBOX_ENDPOINTS).slice();
    this.enabledEndpoints = uniqueEndpoints(enabled);

    const ui = (props.uiEndpoints ?? DEFAULT_UI_ENDPOINTS).slice();
    this.uiEndpoints = uniqueEndpoints(ui).filter((e) => this.isEnabled(e));

    this.extraAllowedOrigins = (props.extraAllowedOrigins ?? []).slice();
  }

  public isEnabled(endpoint: MailboxEndpoint): boolean {
    return this.enabledEndpoints.includes(endpoint);
  }

  /** Browser origins suitable for CORS allowOrigins. */
  public corsAllowedOrigins(): string[] {
    const derived = this.uiEndpoints.map((e) => `https://${this.domains.fqdn(e)}`);
    return [...derived, ...this.extraAllowedOrigins];
  }

  /** Hostnames for enabled endpoints. */
  public enabledDomains(): Partial<Record<MailboxEndpoint, string>> {
    const all = this.domains.all();
    const out: Partial<Record<MailboxEndpoint, string>> = {};
    for (const endpoint of this.enabledEndpoints) {
      out[endpoint] = all[endpoint];
    }
    return out;
  }
}

function uniqueEndpoints(endpoints: readonly MailboxEndpoint[]): MailboxEndpoint[] {
  const set = new Set<MailboxEndpoint>();
  for (const endpoint of endpoints) {
    set.add(endpoint);
  }
  return [...set];
}
