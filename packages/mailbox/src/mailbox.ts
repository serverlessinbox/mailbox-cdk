import type { IArtifactResolver }                                                                              from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag, setStackNameBase }                                                  from '@serverlessinbox/mailbox-cdk-shared';
import { addServerlessInboxResourceGroup, StackHelpers }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                                                                                     from 'aws-cdk-lib/aws-iam';
import { IBucket }                                                                                             from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                                               from 'aws-cdk-lib';
import { Construct, DependencyGroup }                                                                          from 'constructs';

import { ApisSection }                                                                                        from './core/apis/apis-section';
import type { IMailboxAuthProvider }                                                                           from './core/auth/types';
import { MailboxAddressing }                                                                                   from './core/domains/mailbox-addressing';
import type { IDataBlobStore }                                                                                 from './resources/buckets/data-blob-store';
import type { IDataTable }                                                                                     from './resources/tables/data-tables';
import { DataSection }                                                                                         from './core/data/data-section';
import { EmailSection }                                                                                        from './core/email/email-section';
import { SearchSection }                                                                                       from './core/search/search-section';
import { EdgeSection }                                                                                         from './core/edge/edge-section';
import { AuthKeyStore }                                                                                        from './core/auth/auth-key-store';
import { Bootstrap }                                                                                           from './core/auth/bootstrap';
import type { CdnCustomDomain }                                                                                from './core/ui/cdn-construct';
import { OpsSection }                                                                                          from './platform/ops/ops-section';
import { IdentityProvisionerLambda }                                                                           from './resources/lambdas/identity-provisioner-lambda';
import { MailboxContext }                                                                                      from './mailbox-context';
import type { MailboxUrls, MailboxCertificates, MailboxOAuthClients }                                          from './mailbox-outputs';
import type { MailboxProps }                                                                                   from './mailbox-props';
import { AdminUi }                                                                                             from './core/ui/admin-ui';
import type { MailboxUi }                                                                                      from './core/ui/mailbox-ui';
import { WebmailUi }                                                                                           from './core/ui/webmail-ui';
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
  private readonly configTable: IDataTable;

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

    const groups = {
      auth:   new Construct(this, 'auth'),
      ui:     new Construct(this, 'ui'),
    };

    new SearchSection(this, 'search', {
      artifactResolver,
      configTable,
      itemTable,
      changelogTable,
      blobStore: data.blobStore,
      queueProps: encryptionPlan.queues,
    });

    // Component tags on each group — CDK propagates to the whole subtree.
    applyServerlessInboxComponentTag(groups.auth,   'auth');
    applyServerlessInboxComponentTag(groups.ui,     'ui');

    setStackNameBase(this, data.mainStackNameBase);

    const domainName: string = data.derivedDomainName;

    const enableAdminUi   = props.enableAdminUi ?? true;
    const enableWebmailUi = props.enableWebmailUi ?? true;

    const addressing                                                = MailboxAddressing.resolve(this, props, domainName, { adminUi: enableAdminUi, webmailUi: enableWebmailUi });
    const { zone: hostedZone, domains: mailboxDomains, edgePrefix } = addressing;
    this.urls                                                       = addressing.urls;

    this.blobStoreBucket = data.blobStoreBucket;
    this.blobStoreHandle = data.blobStore;
    this.configTable     = configTable;

    const authKeyStore = new AuthKeyStore(groups.auth, 'auth-key-store', {
      issuers: [authProvider.issuer],
      artifactResolver,
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
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
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

    const adminUiOrigins: string[]   = [];
    const webmailUiOrigins: string[] = [];

    let adminUi: AdminUi | undefined;
    let webmailUi: WebmailUi | undefined;

    let adminUiCnameTarget: string | undefined;
    let webmailUiCnameTarget: string | undefined;

    // The webmail token exchange waits on this group; the bootstrap resource joins it once built.
    const oauthClientsProvisioned = new DependencyGroup();

    const identityProvisioner = new IdentityProvisionerLambda(groups.auth, 'identity-provisioner', {
      configTable,
      itemTable,
      changelogTable,
      auditEventsQueue: data.auditEventsQueue,
      artifactResolver,
      adminUIURL: this.urls.adminUi,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: email.submissionQueue,
      sesConfigSetName: email.sesConfigSetName,
      systemSenderAddress: `noreply@${domainName}`,
      vendorAccountIds,
    });

    const apis = new ApisSection(this, 'apis', {
      artifactResolver,
      authProvider,
      adminApiAddonProviders: props.adminApiAddonProviders,
      configTable,
      itemTable,
      changelogTable,
      auditLogTable,
      mailFeedbackTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: email.submissionQueue,
      auditEventsQueue: data.auditEventsQueue,
      identityProvisioner,
      vendorAccountIds,
      stackIdentityTagKey,
      sesRuleSetName: email.sesRuleSetName,
      sesConfigSetName: email.sesConfigSetName,
      domainName,
      jmapApiBaseUrl: this.urls.jmapApi,
    });

    if (enableAdminUi) {
      const providerAuthz = authProvider.authorizationConfig?.();

      // Build admin UI config eagerly by merging authz and all addon configs.
      const mergedAdminUiConfig: Record<string, unknown> = {
        ...(providerAuthz
          ? {
            authorization: {
              roles: {
                adminGroups: providerAuthz.adminGroups,
                userGroups: providerAuthz.userGroups,
              },
            },
          }
          : {}),
      };

      for (const addon of apis.adminApiAddons) {
        if (addon.uiConfig) {
          Object.assign(mergedAdminUiConfig, addon.uiConfig);
        }
      }

      adminUi = new AdminUi(groups.ui, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: data.auditEventsQueue,
        authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        webmailUrl: enableWebmailUi && (props.overrides?.certificates?.webmailUi ?? defaultUiCertificate)
          ? `https://${mailboxDomains.webmail}`
          : undefined,
        uiConfig: Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined,
        artifactResolver,
      });

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(adminUi, artifactResolver);
    }

    if (enableWebmailUi) {
      webmailUi = new WebmailUi(groups.ui, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: data.auditEventsQueue,
        authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
        uiBundle: { packageName: 'mailbox-webmail-ui', objectPath: 'webmail-ui.zip' },
        artifactResolver,
        dependsOn: [oauthClientsProvisioned],
      });

      webmailUiOrigins.push(`https://${webmailUi.distributionDomainName}`);
      webmailUiCnameTarget = webmailUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(webmailUi, artifactResolver);
    }

    this.oauthClients = {
      ...(adminUi ? { adminUi: adminUi.oauthClient } : {}),
      ...(webmailUi ? { webmailUi: webmailUi.oauthClient } : {}),
    };

    const extraOrigins              = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi  = [...webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn      = [...adminUiOrigins, ...webmailUiOrigins, ...extraOrigins];

    const adminRequiredGroups = authProvider.policies.adminApi.requireAnyOfGroups
      ?? this.oauthClients.adminUi?.groups
      ?? undefined;

    new OpsSection(this, 'ops', {
      artifactResolver,
      configTable,
      domainName,
      vendorAccountIds,
      sendStackFailures: props.sendStackFailures,
      jmapBlobDownloadVersionArn: edge.jmapBlobDownloadVersionArn,
      regionalCertificate: regionalSanCertificate,
    });

    const bootstrap = new Bootstrap(groups.auth, 'bootstrap', {
      domain: domainName,
      oidcIssuer: authProvider.issuer,
      configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      artifactResolver,
      sesRuleSet: email.sesRuleSet,
      sesReceivingMode: props.enableReceiving,
      sesSendEnabled: true,
      hostedZone: hasHostedZone ? hostedZone : undefined,
      vendorAccountIds,
      stackIdentityTagKey,

      oidcProvider: {
        tokenEndpoint: authProvider.tokenEndpoint,
        authorizationEndpoint: authProvider.authorizationEndpoint,
        authMethod: authProvider.authMethod,
        usePkce: authProvider.usePkce,
      },
      authPolicies: {
        adminApi: {
          audiences: authProvider.policies.adminApi.audiences,
          requireAnyOfGroups: adminRequiredGroups,
          requireAllScopes: authProvider.policies.adminApi.requireAllScopes,
        },
        jmapApi: {
          audiences: authProvider.policies.jmapApi.audiences,
          requireAllScopes: authProvider.policies.jmapApi.requireAllScopes,
        },
      },
      oauthClients: (adminUi || webmailUi)
        ? {
          adminUi: adminUi
            ? {
              flow: 'authorization_code',
              clientId: adminUi.oauthClient.clientId,
              clientSecret: adminUi.oauthClient.clientSecret,
              scopes: ['openid', 'email', 'profile', ...adminUi.oauthClient.requestScopeList],
              redirectUri: adminUi.oauthRedirectUri,
            }
            : undefined,
          webmailUi: webmailUi
            ? {
              flow: 'authorization_code',
              clientId: webmailUi.oauthClient.clientId,
              clientSecret: webmailUi.oauthClient.clientSecret,
              scopes: ['openid', 'email', 'profile', ...webmailUi.oauthClient.requestScopeList],
              redirectUri: webmailUi.oauthRedirectUri,
            }
            : undefined,
        }
        : undefined,
    });
    oauthClientsProvisioned.add(bootstrap.oauthClientsProvisioned);

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
        admin: adminUiCnameTarget,
        webmail: webmailUiCnameTarget,
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

/**
 * Grants `resolver` write access to `ui`'s own content bucket, when `resolver` is capable of
 * being granted at all. `resolver` is typed `IArtifactResolver`, which carries no IAM principal,
 * so grantability is a runtime capability: a resolver without a principal needs no grant and is
 * skipped rather than erroring.
 */
function grantUiContentDeployIfGrantable(ui: MailboxUi, resolver: IArtifactResolver): void {
  if (isGrantable(resolver)) {
    ui.grantContentDeploy(resolver);
  }
}

function isGrantable(resolver: IArtifactResolver): resolver is IArtifactResolver & IGrantable {
  return 'grantPrincipal' in resolver;
}
