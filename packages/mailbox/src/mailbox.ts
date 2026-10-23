import { ServerlessInboxResourceGroup, setStackNameBase, StackHelpers }                                        from '@serverlessinbox/mailbox-cdk-shared';
import * as cdk                                                                                                from 'aws-cdk-lib';
import { Construct }                                                                                           from 'constructs';

import { ApisSection }                                                                                         from './core/apis/apis-section';
import { AuthSection }                                                                                         from './core/auth/auth-section';
import { DataSection }                                                                                         from './core/data/data-section';
import { MailboxAddressing }                                                                                   from './core/domains/mailbox-addressing';
import type { MailboxEnabledUis }                                                                              from './core/domains/mailbox-addressing';
import { EdgeSection }                                                                                         from './core/edge/edge-section';
import { EmailSection }                                                                                        from './core/email/email-section';
import { SearchSection }                                                                                       from './core/search/search-section';
import { UiSection }                                                                                           from './core/ui/ui-section';
import { MailboxContext }                                                                                      from './mailbox-context';
import type { MailboxUrls, MailboxCertificates, MailboxOAuthClients }                                          from './mailbox-outputs';
import type { MailboxProps }                                                                                   from './mailbox-props';
import { OpsSection }                                                                                          from './platform/ops/ops-section';
import { MailboxResourceDescriptions }                                                                         from './utils/resource-descriptions';

/**
 * The complete Serverless Inbox mail server as one construct: data stack, email receiving and
 * sending, the Admin and JMAP APIs, WebSocket push, the Admin and Webmail UIs, the CDN and edge
 * stack, DNS, and the operational pieces around them (audit, license refresh, cleanup).
 *
 * Add it to your own stack and pass an `authProvider`. Optional capabilities are not built in:
 * you opt in through the props, for example `adminApiAddonProviders` and `artifactResolver`.
 *
 * The construct is a composition of sections, each a construct that owns its resources and takes
 * the sections built before it as inputs. They live in two zones:
 *
 * - `core/` is the mail server: data, email, auth, edge, APIs, UIs and search.
 * - `platform/` is what keeps the server running: updates, support and operations. Updates and
 *   support reach the server as admin API addons that the consumer opts into; operations is built here.
 *
 * Construction order follows what each section needs. A section that needs a value which only
 * exists later (the CDN after the UIs, the DNS records after the API endpoints) exposes an `add*`
 * method that the constructor calls once that value exists.
 */
export class Mailbox extends Construct {
  /**
   * The OAuth clients this Mailbox created for its UIs. A client is present only when its UI is
   * enabled.
   */
  public readonly oauthClients: MailboxOAuthClients;

  /** The public URLs of the endpoints this Mailbox serves. */
  public readonly urls: MailboxUrls;

  /** The ACM certificates this Mailbox created for itself. */
  public readonly certificates: MailboxCertificates;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const context                                                                                = MailboxContext.resolve(this, props);
    const { artifactResolver, deployerType, vendorLink, encryptionPlan: { queues: queueProps } } = context;
    const enabledUis                                                                             = { adminUi: props.enableAdminUi ?? true, webmailUi: props.enableWebmailUi ?? true };

    // Every other section reads the data tables, queues and blob store, so data comes first.
    const data = new DataSection(this, 'data', {
      artifactResolver,
      deployerType,
      stackHelpers: StackHelpers.getOrCreate(this, artifactResolver),
      queueProps,
    });
    setStackNameBase(this, data.mainStackNameBase);

    // Fixes the domain names and URLs up front, since the sections below embed them.
    const addressing = this.resolveAddressing(props, enabledUis);

    // Receives, sends and processes mail on top of the data stores; auth needs its queue and SES settings.
    const email = new EmailSection(this, 'email', { artifactResolver, data, queueProps });

    // Key store and identity provisioning, which need data and email. The bootstrap that registers
    // the OAuth clients waits for the UIs (`auth.addBootstrap` below).
    const auth = new AuthSection(this, 'auth', {
      artifactResolver,
      authProvider: props.authProvider,
      data,
      email,
      vendorLink,
      domainName: addressing.domains.domainName,
      adminUiUrl: addressing.urls.adminUi,
    });

    // Edge sub-stack and certificates, which need the auth key store and the addressing. The CDN and
    // DNS records need the UIs and APIs, so they are added later.
    const edge = new EdgeSection(this, 'edge', {
      artifactResolver,
      deployerType,
      productVersion: context.stackVersion,
      data,
      auth,
      addressing,
      hostedZone:           props.hostedZone,
      certificateOverrides: props.overrides?.certificates,
    });

    // The API addons are created before the UIs because the Admin UI reads their UI configuration.
    // The endpoints themselves come later.
    const apis = new ApisSection(this, 'apis', {
      artifactResolver,
      authProvider:           props.authProvider,
      adminApiAddonProviders: props.adminApiAddonProviders,
      data,
      auth,
      email,
      vendorLink,
      jmapApiBaseUrl: addressing.urls.jmapApi,
    });

    // Admin and Webmail UIs, each only when enabled; they need the edge certificates and the API addons.
    const ui = new UiSection(this, 'ui', {
      artifactResolver,
      authProvider:         props.authProvider,
      enableAdminUi:        enabledUis.adminUi,
      enableWebmailUi:      enabledUis.webmailUi,
      mailboxDomains:       addressing.domains,
      certificateOverrides: props.overrides?.certificates,
      data,
      auth,
      apis,
      edge,
    });

    // The CDN in front of the blob bucket allows the UIs' origins, so it can only be built after them.
    const blobCdn = edge.addBlobCdn({ ui, extraAllowedOrigins: props.extraAllowedOrigins });

    // The API endpoints need the CDN host and the UI origins, so they follow both.
    const endpoints = apis.addEndpoints({
      cdnHost:        blobCdn.host,
      mailboxDomains: addressing.domains,
      edge,
      ui,
      extraAllowedOrigins: props.extraAllowedOrigins,
      enableMcp:           props.enableMcp,
    });

    // The email Lambdas can push over the WebSocket only once the endpoints' broadcaster exists.
    email.enableWebSocketPublishing(endpoints.broadcaster);

    // DNS records point at the UIs, the CDN and the API endpoints, so they come after all three.
    edge.addDns({ ui, blobCdn, apis: endpoints });

    // The bootstrap registers the UIs' OAuth clients, so it needs the UIs and the edge.
    auth.addBootstrap({ email, ui, edge, sesReceivingMode: props.enableReceiving });

    // Full-text search needs only the data stores, so nothing else waits on it.
    new SearchSection(this, 'search', { artifactResolver, data, queueProps });

    // Platform zone: license refresh, stack-failure detection and cleanup of retained resources.
    // The cleanup targets edge resources, so it is built after the edge.
    new OpsSection(this, 'ops', {
      artifactResolver, data, edge,
      domainName:        addressing.domains.domainName,
      vendorAccountIds:  vendorLink.vendorAccountIds,
      sendStackFailures: props.sendStackFailures,
    });

    this.urls         = addressing.urls;
    this.certificates = { edge: edge.edgeCertificate, regional: edge.regionalCertificate };
    this.oauthClients = ui.oauthClients;

    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(id));

    // Per-region AWS Resource Group collecting all resources tagged with this deployment's
    // root-stack (this is the main stack, so root-stack = AWS::StackName).
    new ServerlessInboxResourceGroup(this, 'resource-group');
  }

  private resolveAddressing(props: MailboxProps, enabledUis: MailboxEnabledUis): MailboxAddressing {
    return MailboxAddressing.resolve(this, {
      domainName:         props.hostedZone?.zoneName,
      subdomainNamespace: props.subdomainNamespace,
      overrides:          props.overrides,
    }, enabledUis);
  }
}
