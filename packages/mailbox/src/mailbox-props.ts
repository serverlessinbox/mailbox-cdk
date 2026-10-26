import type { IArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import type * as acm                   from 'aws-cdk-lib/aws-certificatemanager';
import type * as route53               from 'aws-cdk-lib/aws-route53';

import type { SesReceivingMode }       from './contracts/ses-receiving-mode';
import type { IAdminApiAddonProvider } from './core/apis/addons';
import type { IMailboxAuthProvider }   from './core/auth/auth-provider';
import type { MailboxKmsConfig }       from './core/kms';
import type { SendStackFailuresMode }  from './platform/ops/stack-failure-detection';

/**
 * Your own ACM certificates for the endpoints a Mailbox serves, for when you manage DNS and
 * certificates yourself. Every field left out falls back to the certificate the Mailbox creates
 * itself, which requires `MailboxProps.hostedZone`.
 */
export interface MailboxCertificateOverrides {
  /**
   * Certificate attached to the CDN's alternate domain name (cdn.<domain>). It must be issued in
   * us-east-1, because CloudFront only accepts certificates from there.
   *
   * Used only when `MailboxProps.hostedZone` is not set; with a hosted zone the Mailbox's own
   * edge certificate is used and this field is ignored. Without a hosted zone and without this
   * certificate, the CDN is served on its default CloudFront domain.
   */
  readonly cloudFront?: acm.ICertificate;
  /**
   * Certificate attached to the Admin UI's alternate domain name (admin.<domain>). It must be
   * issued in us-east-1, because CloudFront only accepts certificates from there.
   *
   * Takes precedence over the edge certificate the Mailbox creates when a hosted zone is given.
   * Without a hosted zone and without this certificate, the Admin UI is served on its default
   * CloudFront domain.
   */
  readonly adminUi?: acm.ICertificate;
  /**
   * Certificate attached to the Webmail UI's alternate domain name (webmail.<domain>). It must be
   * issued in us-east-1, because CloudFront only accepts certificates from there.
   *
   * Takes precedence over the edge certificate the Mailbox creates when a hosted zone is given.
   * Without a hosted zone and without this certificate, the Webmail UI is served on its default
   * CloudFront domain.
   */
  readonly webmailUi?: acm.ICertificate;
  /**
   * Certificate for the Admin API's custom domain (api.<domain>). It must be issued in the same
   * region as the stack, because API Gateway custom domains use regional certificates.
   *
   * Takes precedence over the regional certificate the Mailbox creates when a hosted zone is
   * given. Without a hosted zone and without this certificate, the Admin API gets no custom
   * domain, and the Admin UI is not given an API URL.
   */
  readonly api?: acm.ICertificate;
  /**
   * Certificate for the JMAP API's custom domain (jmap.<domain>). It must be issued in the same
   * region as the stack, because API Gateway custom domains use regional certificates.
   *
   * Takes precedence over the regional certificate the Mailbox creates when a hosted zone is
   * given. Without a hosted zone and without this certificate, the JMAP API gets no custom
   * domain, and the Webmail UI is not given an API URL.
   */
  readonly jmap?: acm.ICertificate;
  /**
   * Certificate for the WebSocket push custom domain (ws.<domain>). It must be issued in the same
   * region as the stack, because API Gateway custom domains use regional certificates.
   *
   * Used only when `MailboxProps.hostedZone` is set: it then takes precedence over the regional
   * certificate the Mailbox creates. Without a hosted zone the WebSocket endpoint gets no custom
   * domain and this field is ignored.
   */
  readonly ws?: acm.ICertificate;
}

/**
 * Subdomain labels for the endpoints a Mailbox serves. Each label is a single DNS label, so it
 * must not contain dots. A label you leave out keeps its default.
 */
export interface MailboxSubdomainOverrides {
  /**
   * Label for the Admin UI: `<label>.<domain>`.
   * @default "admin"
   */
  readonly admin?: string;
  /**
   * Label for the Webmail UI: `<label>.<domain>`.
   * @default "webmail"
   */
  readonly webmail?: string;
  /**
   * Label for the JMAP API: `<label>.<domain>`.
   * @default "jmap"
   */
  readonly jmap?: string;
  /**
   * Label for the Admin API: `<label>.<domain>`.
   * @default "api"
   */
  readonly api?: string;
  /**
   * Label for the WebSocket push endpoint: `<label>.<domain>`.
   * @default "ws"
   */
  readonly ws?: string;
  /**
   * Label for the blob CDN: `<label>.<domain>`.
   * @default "cdn"
   */
  readonly cdn?: string;
  /**
   * Label for the MCP endpoint: `<label>.<domain>`.
   * @default "mcp"
   */
  readonly mcp?: string;
}

/**
 * Replacements for the certificates and subdomain labels a Mailbox would otherwise generate.
 */
export interface MailboxOverrides {
  /**
   * Your own ACM certificates per endpoint. When omitted, the Mailbox creates the certificates it
   * needs, which requires `MailboxProps.hostedZone`. Supply individual fields to bypass that
   * for specific endpoints, for example with manual DNS or a cross-account certificate.
   */
  readonly certificates?: MailboxCertificateOverrides;

  /**
   * Subdomain labels per endpoint. Each endpoint keeps its default label (the property name, for
   * example "admin") unless overridden here. Every label must be a single DNS label (no dots).
   */
  readonly subdomains?: MailboxSubdomainOverrides;
}

/**
 * Settings of a {@link Mailbox}: the DNS and certificate setup, the authentication provider, which
 * UIs and optional capabilities to create, and how artifacts are resolved.
 */
export interface MailboxProps {
  /**
   * The Route53 hosted zone that serves your domain. The Mailbox takes the domain name from the
   * zone's `zoneName`, creates DNS records for its endpoints in it, and creates the ACM
   * certificates they need.
   *
   * Pass the `hostedZone` of a `HostedZoneLookup` so the zone is looked up once for your whole app.
   * The Mailbox itself makes no lookup, so a zone whose `zoneName` is only known at deploy time
   * works as well as one with a fixed name.
   *
   * When omitted, no DNS records or certificates are created: supply your own through
   * `overrides.certificates` and point DNS at the endpoints yourself.
   */
  readonly hostedZone?: route53.IHostedZone;

  /**
   * Configuration for at-rest KMS encryption of the Mailbox's core resources. See
   * {@link MailboxKmsConfig} for the available modes.
   */
  readonly kms?: MailboxKmsConfig;

  /**
   * The construct that supplies authentication: the identity issuer and its token and
   * authorization endpoints, the auth policies, the OAuth client settings and, optionally,
   * Admin API and JMAP API addons. Required.
   *
   * Pass the provider your users sign in with: its issuer is what the Mailbox is configured to
   * trust.
   */
  readonly authProvider: IMailboxAuthProvider;

  /**
   * Extra origins allowed by CORS on the Admin API, the JMAP API and the CDN, as full origins
   * including the scheme, for example `http://localhost:5173` during local development. Each entry
   * must be an absolute `https://` origin, or `http://localhost` or `http://127.0.0.1` with an
   * optional port, with no path, query or trailing slash (or a CloudFormation token); any other
   * entry makes synthesis fail, naming the entry. The origins of the Admin and Webmail UIs are
   * added automatically.
   *
   * @default - only the UI origins are allowed
   */
  readonly extraAllowedOrigins?: string[];

  /**
   * Providers that add capabilities to the Admin API, such as `StackUpdateAddonProvider` or
   * `SupportAddonProvider`. Nothing beyond the addons your `authProvider` contributes is enabled
   * unless a provider is listed here.
   *
   * @default - no additional providers
   */
  readonly adminApiAddonProviders?: IAdminApiAddonProvider[];

  /**
   * Namespace for all endpoints. When set, every endpoint is placed under
   * `{namespace}.{domainName}` — e.g. namespace "mailbox" on "example.com" yields
   * `admin.mailbox.example.com`, `webmail.mailbox.example.com`, etc.
   *
   * Must be a single DNS label (no dots). An empty string means no namespace, so a
   * CloudFormation parameter can switch the namespace on and off at deploy time.
   *
   * @default - no namespace
   */
  readonly subdomainNamespace?: string;
  /**
   * Whether to create the Admin UI: the CloudFront distribution, its token-exchange API and its
   * OAuth client. When false, there is no Admin UI OAuth client and no Admin UI origin in the CORS
   * allow-lists.
   *
   * @default true
   */
  readonly enableAdminUi?: boolean;

  /**
   * Whether to create the Webmail UI: the CloudFront distribution, its token-exchange API and its
   * OAuth client. When false, there is no Webmail UI OAuth client and no Webmail UI origin in
   * the CORS allow-lists. The JMAP API does not depend on the Webmail UI and is created either way.
   *
   * @default true
   */
  readonly enableWebmailUi?: boolean;

  /**
   * Whether to activate the MCP (Model Context Protocol) API at mcp.<domain>. Requires an Advanced
   * license tier. The MCP endpoint uses the regional certificate the Mailbox creates, so it also
   * requires `hostedZone`, and `overrides.certificates` must not supply both `api` and `jmap`,
   * or no regional certificate is created.
   *
   * @default false
   */
  readonly enableMcp?: boolean;

  /**
   * The mode (`'off'`, `'on'` or `'forced'`) the Bootstrap Lambda uses when it activates the SES
   * receipt rule set by calling SetActiveReceiptRuleSet. Only one rule set can be active per
   * account per region, so activating this one replaces whichever is active: choose it
   * deliberately.
   *
   * @default - the Bootstrap Lambda's default receiving behavior
   */
  readonly enableReceiving?: SesReceivingMode;

  /**
   * Certificate and subdomain overrides.
   *
   * @default - generated certificates and default subdomain labels
   */
  readonly overrides?: MailboxOverrides;

  /**
   * The resolver that locates the Lambda code and UI bundle artifacts the Mailbox deploys. When
   * omitted, a pinned resolver built from the artifact versions shipped with the package is used,
   * so a deploy ships exactly those versions. Inject an `AutoUpdater` to additionally keep the
   * deployed artifacts up to date with newer releases.
   *
   * @default - a pinned resolver
   */
  readonly artifactResolver?: IArtifactResolver;

  /**
   * Consent for the stack-failure detector, which watches this stack's terminal status events.
   * `SendStackFailuresMode.DISABLED` provisions no detector infrastructure at all (no Lambda,
   * rule or role).
   *
   * @default SendStackFailuresMode.ENABLED
   */
  readonly sendStackFailures?: SendStackFailuresMode;
}
