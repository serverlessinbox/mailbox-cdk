import { setStackNameBase }                                                                                    from '@serverlessinbox/mailbox-cdk-shared';
import { addServerlessInboxResourceGroup, StackHelpers }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import * as cdk                                                                                                from 'aws-cdk-lib';
import { Construct }                                                                                           from 'constructs';

import { ApisSection }                                                                                         from './core/apis/apis-section';
import { AuthSection }                                                                                         from './core/auth/auth-section';
import { DataSection }                                                                                         from './core/data/data-section';
import { MailboxAddressing }                                                                                   from './core/domains/mailbox-addressing';
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

    // Resolved once here, as the composition root, and threaded down as props.
    const context                                        = MailboxContext.resolve(this, props);
    const { artifactResolver, deployerType, vendorLink } = context;
    const queueProps                                     = context.encryptionPlan.queues;
    const enabledUis                                     = { adminUi: props.enableAdminUi ?? true, webmailUi: props.enableWebmailUi ?? true };

    const data = new DataSection(this, 'data', {
      artifactResolver,
      deployerType,
      stackHelpers: StackHelpers.getOrCreate(this, artifactResolver),
      hostedZoneId: props.hostedZoneId,
      queueProps,
    });
    setStackNameBase(this, data.mainStackNameBase);

    const addressing = MailboxAddressing.resolve(this, props, data.derivedDomainName, enabledUis);

    const email = new EmailSection(this, 'email', { artifactResolver, data, queueProps });

    const auth = new AuthSection(this, 'auth', {
      artifactResolver,
      authProvider: props.authProvider,
      data,
      email,
      vendorLink,
      adminUiUrl: addressing.urls.adminUi,
    });

    const edge = new EdgeSection(this, 'edge', {
      artifactResolver,
      deployerType,
      productVersion: context.stackVersion,
      data,
      auth,
      addressing,
      hostedZoneId:         props.hostedZoneId,
      certificateOverrides: props.overrides?.certificates,
    });

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

    const blobCdn = edge.addBlobCdn({ ui, extraAllowedOrigins: props.extraAllowedOrigins });

    const endpoints = apis.addEndpoints({
      cdnHost:        blobCdn.host,
      mailboxDomains: addressing.domains,
      edge,
      ui,
      extraAllowedOrigins: props.extraAllowedOrigins,
      enableMcp:           props.enableMcp,
    });

    email.enableWebSocketPublishing(endpoints.broadcaster);

    edge.addDns({ ui, blobCdn, apis: endpoints });

    auth.addBootstrap({ email, ui, edge, sesReceivingMode: props.enableReceiving });

    new SearchSection(this, 'search', { artifactResolver, data, queueProps });

    new OpsSection(this, 'ops', { artifactResolver, vendorAccountIds: vendorLink.vendorAccountIds, sendStackFailures: props.sendStackFailures, data, edge });

    this.urls         = addressing.urls;
    this.certificates = { edge: edge.edgeCertificate, regional: edge.regionalCertificate };
    this.oauthClients = ui.oauthClients;

    // Adds Name tags and native descriptions to every L1 resource under this construct.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(id));

    // Per-region AWS Resource Group collecting all resources tagged with this deployment's
    // root-stack (this is the main stack, so root-stack = AWS::StackName).
    addServerlessInboxResourceGroup(this, 'resource-group');
  }
}
