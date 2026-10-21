import { setStackNameBase }                                                                                    from '@serverlessinbox/mailbox-cdk-shared';
import { addServerlessInboxResourceGroup, StackHelpers }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import { IBucket }                                                                                             from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                                               from 'aws-cdk-lib';
import { Construct }                                                                                           from 'constructs';

import { ApisSection }                                                                                        from './core/apis/apis-section';
import type { IMailboxAuthProvider }                                                                           from './core/auth/types';
import { MailboxAddressing }                                                                                   from './core/domains/mailbox-addressing';
import type { IDataBlobStore }                                                                                 from './resources/buckets/data-blob-store';
import { DataSection }                                                                                         from './core/data/data-section';
import { EmailSection }                                                                                        from './core/email/email-section';
import { SearchSection }                                                                                       from './core/search/search-section';
import { EdgeSection }                                                                                         from './core/edge/edge-section';
import { AuthSection }                                                                                         from './core/auth/auth-section';
import type { CdnCustomDomain }                                                                                from './core/ui/cdn-construct';
import { OpsSection }                                                                                          from './platform/ops/ops-section';
import { MailboxContext }                                                                                      from './mailbox-context';
import type { MailboxUrls, MailboxCertificates, MailboxOAuthClients }                                          from './mailbox-outputs';
import type { MailboxProps }                                                                                   from './mailbox-props';
import { UiSection }                                                                                           from './core/ui/ui-section';
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
  /** Grant-scoped handle to `blobStoreBucket`, for every consumer that only needs least-privilege object actions. */
  private readonly blobStoreHandle: IDataBlobStore;
  /**
   * The raw blob-store bucket, for call sites that need an actual `IBucket` (the CDN's CloudFront
   * S3 origin and the SES receipt rule's S3 delivery action), which `IDataBlobStore`'s grant-only
   * surface cannot provide.
   */
  private readonly blobStoreBucket: IBucket;

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

    const authProvider: IMailboxAuthProvider = props.authProvider;

    // Resolved once here, as the composition root, and threaded down as props.
    const context                                                                                                 = MailboxContext.resolve(this, props);
    const { artifactResolver, stackVersion, deployerType, vendorAccountIds, stackIdentityTagKey, encryptionPlan } = context;

    // --- Sections (data, email) and group nodes (the other intermediate constructs) ---
    const data = new DataSection(this, 'data', {
      artifactResolver,
      deployerType,
      stackHelpers: StackHelpers.getOrCreate(this, artifactResolver),
      hostedZoneId: props.hostedZoneId,
      queueProps: encryptionPlan.queues,
    });

    const { configTable, itemTable, changelogTable, auditLogTable, mailFeedbackTable } = data;

    const email = new EmailSection(this, 'email', {
      artifactResolver,
      configTable,
      itemTable,
      changelogTable,
      mailFeedbackTable,
      blobStore: data.blobStore,
      blobStoreBucket: data.blobStoreBucket,
      auditEventsQueue: data.auditEventsQueue,
      queueProps: encryptionPlan.queues,
    });

    new SearchSection(this, 'search', {
      artifactResolver,
      configTable,
      itemTable,
      changelogTable,
      blobStore: data.blobStore,
      queueProps: encryptionPlan.queues,
    });

    setStackNameBase(this, data.mainStackNameBase);

    const domainName: string = data.derivedDomainName;

    const enableAdminUi   = props.enableAdminUi ?? true;
    const enableWebmailUi = props.enableWebmailUi ?? true;

    const addressing                                                = MailboxAddressing.resolve(this, props, domainName, { adminUi: enableAdminUi, webmailUi: enableWebmailUi });
    const { zone: hostedZone, domains: mailboxDomains, edgePrefix } = addressing;
    this.urls                                                       = addressing.urls;

    this.blobStoreBucket = data.blobStoreBucket;
    this.blobStoreHandle = data.blobStore;

    const auth = new AuthSection(this, 'auth', {
      artifactResolver,
      authProvider,
      configTable,
      itemTable,
      changelogTable,
      auditEventsQueue: data.auditEventsQueue,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: email.submissionQueue,
      sesConfigSetName: email.sesConfigSetName,
      domainName,
      vendorAccountIds,
      adminUiUrl: this.urls.adminUi,
    });

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    const providedApiCertificate  = props.overrides?.certificates?.api;
    const providedJmapCertificate = props.overrides?.certificates?.jmap;
    const providedWsCertificate   = props.overrides?.certificates?.ws;

    const edge = new EdgeSection(this, 'edge', {
      artifactResolver,
      deployerType,
      domainName,
      mailboxDomains,
      edgePrefix,
      hostedZone,
      hostedZoneId: props.hostedZoneId,
      providedApiCertificate,
      providedJmapCertificate,
      itemTable,
      configTable,
      authKeyStoreTable: auth.authKeyStoreTable,
      productVersion: stackVersion,
    });

    const edgeCertificate = edge.edgeCertificate;

    const hasHostedZone      = Boolean(props.hostedZoneId);
    const useCustomCdnDomain = Boolean(props.overrides?.certificates?.cloudFront || hasHostedZone);

    const defaultUiCertificate = hasHostedZone ? edgeCertificate : undefined;
    if (hasHostedZone && !defaultUiCertificate) {
      throw new Error('hostedZone was provided but edge certificate was not created');
    }

    const regionalSanCertificate = edge.regionalCertificate;
    const regionalCertificate    = regionalSanCertificate;

    this.certificates = {
      edge:     edgeCertificate,
      regional: regionalCertificate,
    };

    const apiCertificate = providedApiCertificate
      ?? regionalSanCertificate;

    const jmapCertificate = providedJmapCertificate
      ?? regionalSanCertificate;

    // WebSocket push uses the explicit override or else the regional SAN cert; it never creates its own.
    const wsCertificate = providedWsCertificate
      ?? regionalSanCertificate;

    const apis = new ApisSection(this, 'apis', {
      artifactResolver,
      authProvider,
      adminApiAddonProviders: props.adminApiAddonProviders,
      configTable,
      itemTable,
      changelogTable,
      auditLogTable,
      mailFeedbackTable,
      authKeyStoreTable: auth.authKeyStoreTable,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: email.submissionQueue,
      auditEventsQueue: data.auditEventsQueue,
      identityProvisioner: auth.identityProvisioner,
      vendorAccountIds,
      stackIdentityTagKey,
      sesRuleSetName: email.sesRuleSetName,
      sesConfigSetName: email.sesConfigSetName,
      domainName,
      jmapApiBaseUrl: this.urls.jmapApi,
    });

    const ui = new UiSection(this, 'ui', {
      artifactResolver,
      authProvider,
      configTable,
      auditEventsQueue: data.auditEventsQueue,
      enableAdminUi,
      enableWebmailUi,
      mailboxDomains,
      adminUiCertificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
      webmailUiCertificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
      apiCertificate,
      jmapCertificate,
      adminApiAddons: apis.adminApiAddons,
      oauthClientsProvisioned: auth.oauthClientsProvisioned,
    });

    this.oauthClients = ui.oauthClients;

    const extraOrigins              = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...ui.adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi  = [...ui.webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn      = [...ui.adminUiOrigins, ...ui.webmailUiOrigins, ...extraOrigins];

    new OpsSection(this, 'ops', {
      artifactResolver,
      configTable,
      domainName,
      vendorAccountIds,
      sendStackFailures: props.sendStackFailures,
      jmapBlobDownloadVersionArn: edge.jmapBlobDownloadVersionArn,
      regionalCertificate: regionalSanCertificate,
    });

    auth.addBootstrap({
      sesRuleSet: email.sesRuleSet,
      sesReceivingMode: props.enableReceiving,
      hostedZone: hasHostedZone ? hostedZone : undefined,
      stackIdentityTagKey,
      adminUi: ui.adminUi,
      webmailUi: ui.webmailUi,
    });

    const cdnCertificate                               = hasHostedZone ? edgeCertificate : props.overrides?.certificates?.cloudFront;
    const cdnCustomDomain: CdnCustomDomain | undefined =
      useCustomCdnDomain && cdnCertificate ? { name: mailboxDomains.cdn, certificate: cdnCertificate } : undefined;

    const cdnConstruct = edge.addBlobCdn({
      blobStore: this.blobStoreBucket,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      customDomain: cdnCustomDomain,
    });

    // DNS is created later, once all endpoint targets are known.

    const endpoints = apis.addEndpoints({
      cdnHost: cdnConstruct.host,
      mailboxDomains,
      hasHostedZone,
      adminApiAllowedOrigins: allowedOriginsForAdminApi,
      jmapApiAllowedOrigins: allowedOriginsForJmapApi,
      apiCertificate,
      jmapCertificate,
      wsCertificate,
      mcp: props.enableMcp ? { regionalCertificate: this.certificates.regional! } : undefined,
    });

    email.enableWebSocketPublishing(endpoints.broadcaster);

    if (hasHostedZone) {
      edge.addDns({
        admin: ui.adminUiCnameTarget,
        webmail: ui.webmailUiCnameTarget,
        cdn: cdnConstruct.distributionDomainName,
        api: endpoints.adminApiDomainTarget,
        jmap: endpoints.jmapApiDomainTarget,
        ws: endpoints.webSocketDomainTarget,
        mcp: endpoints.mcpApiDomainTarget,
      });
    }

    // Adds Name tags and native descriptions to every L1 resource under this construct.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(id));

    // Per-region AWS Resource Group collecting all resources tagged with this deployment's
    // root-stack (this is the main stack, so root-stack = AWS::StackName).
    addServerlessInboxResourceGroup(this, 'resource-group');

  }

}
