import { Construct } from 'constructs';
import { AuthKeyStore } from './features/auth-key-store/auth-key-store';
import { Cdn } from './features/cdn/cdn-construct';
import { TantivySearch } from './search';
import { EmailSending, SESEventProcessing } from './email';
import { AdminApi } from './api/admin/admin-api';
import { JMapApi } from './api/jmap/jmap-api';
import { WebSocketPush } from './api/websocket/websocket';
import { McpApi } from './api/mcp/mcp-api';
import type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider, IJmapApiAddon, JmapApiAddonContext } from './api';
import { SesRules } from './email/receiving/ses-rules';
import {
  AuthClientConfig,
} from './auth/types';
import type { IMailboxAuthProvider } from './auth/types';
import { EmailProcessorLambda } from './lambdas/email-processor';
import { SesReceivingMode, IdentityProvisionerLambda } from './lambdas';
import { AuditWriting } from './features/audit-writing/audit-writing';
import { CdkArtifactEngine, PinnedResolver, PipelineLogGroup, applyServerlessInboxBaseTags, applyServerlessInboxComponentTag, ServerlessInboxTagKeys, resolveVendorAccountIds, resolveDeployerType, setStackNameBase } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from './artifacts/i-artifact-resolver';
import { Bootstrap } from './features/bootstrap/bootstrap';
import { DeferredRemoval, SweeperInfra, CertificateRemoval, EdgeFunctionRemoval, StackFailureDetectorRemoval } from './features/sweeper';
import type { IResourceRemoval } from './features/sweeper';
import { StackFailureDetection, SendStackFailuresMode } from './features/stack-failure-detection';
import { LicenseRefresh } from './features/license-refresh/license-refresh';
import { Fn } from 'aws-cdk-lib';
import { MailboxDns, MailboxDomains } from './domains';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as awslambda from 'aws-cdk-lib/aws-lambda';
import { MailboxEdgeDeployer } from './edge';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { AdminUi } from './ui/admin-ui';
import { WebmailUi } from './ui/webmail-ui';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import type { IDataTable } from './data/data-tables';
import type { IDataBlobStore } from './data/data-blob-store';
import { Aws } from 'aws-cdk-lib';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import type { MailboxUi } from './ui/mailbox-ui';
import { MailboxDataDeployer } from './data';
import type { MailboxKmsConfig } from './utils/kms';
import { resolveMailboxEncryptionPlan } from './utils/mailbox-encryption';
import { MailboxResourceDescriptions } from './utils/resource-descriptions';
import { addServerlessInboxResourceGroup, StackHelpers } from '@serverlessinbox/mailbox-cdk-shared';

/**
 * Re exports public API types and constructs for the mailbox package.
 */

export {
  SesReceivingMode
} from './lambdas';

export interface MailboxCertificateOverrides {
  /**
   * us-east-1 ACM certificate for CloudFront alternate domain name (cdn.<domain>).
   * Only needed when hostedZone is not provided (manual DNS setup).
   */
  readonly cloudFront?: acm.ICertificate;
  /**
   * us-east-1 ACM certificate for admin.<domain> CloudFront alternate domain name.
   * Overrides the shared edge certificate auto-created when hostedZone is provided.
   */
  readonly adminUi?: acm.ICertificate;
  /**
   * us-east-1 ACM certificate for webmail.<domain> CloudFront alternate domain name.
   * Overrides the shared edge certificate auto-created when hostedZone is provided.
   */
  readonly webmailUi?: acm.ICertificate;
  /**
   * Regional ACM certificate for api.<domain> (Admin API custom domain).
   * Overrides the shared regional SAN cert auto-created when hostedZone is provided.
   */
  readonly api?: acm.ICertificate;
  /**
   * Regional ACM certificate for jmap.<domain> (JMAP API custom domain).
   * Overrides the shared regional SAN cert auto-created when hostedZone is provided.
   */
  readonly jmap?: acm.ICertificate;
  /**
   * Regional ACM certificate for ws.<domain> (WebSocket push custom domain).
   * Overrides the shared regional SAN cert auto-created when hostedZone is provided.
   */
  readonly ws?: acm.ICertificate;
}

export interface MailboxSubdomainOverrides {
  /** @default "admin" */
  readonly admin?: string;
  /** @default "webmail" */
  readonly webmail?: string;
  /** @default "jmap" */
  readonly jmap?: string;
  /** @default "api" */
  readonly api?: string;
  /** @default "ws" */
  readonly ws?: string;
}

export interface MailboxUrls {
  /** https://admin.<domainName> */
  readonly adminUi: string;
  /** https://webmail.<domainName> */
  readonly webmail: string;
  /** https://jmap.<domainName> */
  readonly jmapApi: string;
  /** https://api.<domainName> */
  readonly adminApi: string;
}

export interface MailboxCertificates {
  /** Auto-created us-east-1 ACM certificate for CloudFront (edge) alternate domain names.
   *  Present only when hostedZone is provided and no overrides.certificates.cloudFront is set. */
  readonly edge?: acm.ICertificate;
  /** Auto-created regional ACM SAN certificate for api/jmap/ws subdomains.
   *  Present only when hostedZone is provided and no overrides.certificates.api/jmap/ws are set. */
  readonly regional?: acm.ICertificate;
}

export interface MailboxOverrides {
  /**
   * ACM certificate overrides. When omitted, certificates are auto-created
   * (requires hostedZone). Supply individual fields to bypass auto-creation
   * for specific endpoints (e.g., manual DNS or cross-account certificate).
   */
  readonly certificates?: MailboxCertificateOverrides;

  /**
   * Override the subdomain label for any endpoint.
   * Default labels match the property names (e.g. admin → "admin").
   * All labels must be valid single DNS labels (no dots).
   */
  readonly subdomains?: MailboxSubdomainOverrides;
}

export interface MailboxProps {
  /** Route53 hosted zone ID. The domain name is derived at deploy time via StackHelpers. */
  readonly hostedZoneId?: string;

  /** Optional KMS configuration for at-rest encryption of core resources. */
  readonly kms?: MailboxKmsConfig;

  /** Preferred: provider-owned construct implementing mailbox auth configuration (+ optional admin addons). */
  readonly authProvider: IMailboxAuthProvider;

  /** Extra origins to allow for CORS (e.g., local dev). UI origins are derived automatically. */
  readonly extraAllowedOrigins?: string[];

  /** Optional admin-api capability providers (e.g. the Update addon). The composing stack opts in by passing providers; the reusable construct does not bake them in. */
  readonly adminApiAddonProviders?: IAdminApiAddonProvider[];

  /**
   * Optional subdomain namespace. When set, all endpoints are placed under
   * `{prefix}.{domainName}` — e.g. prefix "mailbox" on "example.com" yields
   * `admin.mailbox.example.com`, `webmail.mailbox.example.com`, etc.
   * Must be a valid single DNS label (no dots).
   */
  readonly subdomainNamespace?: string;
  /**
   * Whether to create the Admin UI (CloudFront + token-exchange API + OAuth client bootstrap).
   * Defaults to true.
   */
  readonly enableAdminUi?: boolean;

  /**
   * Whether to create the Webmail UI (CloudFront + token-exchange API + OAuth client bootstrap).
   * Defaults to true.
   */
  readonly enableWebmailUi?: boolean;

  /**
   * Whether to activate the MCP (Model Context Protocol) API at mcp.<domain>.
   * Requires an Advanced license tier. Defaults to false.
   */
  readonly enableMcp?: boolean;

  /**
   * When true, the Bootstrap Lambda will call SetActiveReceiptRuleSet to activate the SES receipt
   * rule set. Only one rule set can be active per account per region — this is an explicit operator
   * decision.
   */
  readonly enableReceiving?: SesReceivingMode;

  /**
   * Certificate and data stack overrides.
   */
  readonly overrides?: MailboxOverrides;

  /**
   * Strategy for resolving Lambda code + UI bundle artifacts. Omit for pinned synth-time resolution
   * (`PinnedResolver`); inject an `AutoUpdater` to track a dist-tag at deploy.
   */
  readonly artifactResolver?: IArtifactResolver;

  /**
   * Consent for the stack-failure detector. `disabled` provisions no detector
   * infrastructure at all (no Lambda, rule, role, or self-clean chain). Defaults to `ENABLED`.
   */
  readonly sendStackFailures?: SendStackFailuresMode;
}

export interface MailboxOAuthClients {
  readonly adminUi?: AuthClientConfig;
  readonly jmapUi?: AuthClientConfig;
}

/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  /** Grant-scoped handle to `blobStoreBucket`, for every consumer that only needs least-privilege object actions. */
  private readonly blobStoreHandle: IDataBlobStore;
  /**
   * The raw blob-store bucket. Two consumers still need it directly — the CDN's CloudFront S3
   * origin and the SES receipt rule's S3 delivery action both require an actual `IBucket`, which
   * `IDataBlobStore`'s grant-only surface cannot provide.
   */
  private readonly blobStoreBucket: IBucket;
  private readonly emailProcessorLambda: EmailProcessorLambda;
  private readonly configTable: IDataTable;
  private readonly emailQueueProps: ReturnType<typeof resolveMailboxEncryptionPlan>['queues'];

  private readonly jmapApi: JMapApi;

  /** OAuth clients created by this construct (only when enabled). */
  public readonly oauthClients: MailboxOAuthClients = {};

  public readonly urls: MailboxUrls;

  public readonly certificates: MailboxCertificates;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const authProvider: IMailboxAuthProvider = props.authProvider;

    const deployerType = resolveDeployerType(this);

    // Vendor account IDs are resolved once here — Mailbox is the composition root for the
    // Lambda classes constructed directly under it (identity-provisioner, bootstrap, admin-api,
    // jmap-api, license-refresher) — and threaded down as an already-resolved prop. The support
    // addon (a separate composition root) resolves its own copy in its own top-level construct.
    const vendorAccountIds = resolveVendorAccountIds(this);
    const stackIdentityTagKey = ServerlessInboxTagKeys.rootStack;

    // Tag everything under this construct so customers can easily slice cost/usage.
    // Use AWS::StackName so this also works when deployed via pure CloudFormation.
    // Artifact resolution (stack-self-update subplan #3, Phase A):
    // One injected strategy → one engine, threaded to every sub-construct. Default is pinned
    // (byte-identical synth-time pinning); inject an AutoUpdater for track-based resolution.
    const resolver = props.artifactResolver ?? PinnedResolver.loadFromArtifactMetadata(this);

    // Register packages for artifact updates
    resolver.registerPackages([
      'mailbox-go', 'mailbox-cdk', 'mailbox-cdk-shared', 'mailbox-cdk-edge', 'mailbox-admin-ui', 'mailbox-webmail-ui',
    ]);

    const artifactResolver = new CdkArtifactEngine(this, resolver);
    const stackVersion = artifactResolver.getVersion('mailbox-cdk');

    applyServerlessInboxBaseTags(this, {
      // This is the main stack, so it is its own root-stack (base helper also tags `stack`).
      rootStack: Aws.STACK_NAME,
      version: stackVersion,
      product: 'mailbox',
    });

    // --- Group nodes (8 intermediate constructs for construct-tree grouping) ---
    const groups = {
      data:   new Construct(this, 'data'),
      auth:   new Construct(this, 'auth'),
      edge:   new Construct(this, 'edge'),
      ui:     new Construct(this, 'ui'),
      email:  new Construct(this, 'email'),
      apis:   new Construct(this, 'apis'),
      search: new Construct(this, 'search'),
      ops:    new Construct(this, 'ops'),
    };

    // Component tags on each group — CDK propagates to the whole subtree.
    applyServerlessInboxComponentTag(groups.data,   'data');
    applyServerlessInboxComponentTag(groups.auth,   'auth');
    applyServerlessInboxComponentTag(groups.edge,   'edge');
    applyServerlessInboxComponentTag(groups.ui,     'ui');
    applyServerlessInboxComponentTag(groups.email,  'email');
    applyServerlessInboxComponentTag(groups.apis,   'api');
    applyServerlessInboxComponentTag(groups.search, 'search');
    applyServerlessInboxComponentTag(groups.ops,    'ops');

    // Derive domain name and S3-safe stack name from hosted zone at deploy time.
    const effectiveDataStackName = cdk.Fn.join('', [cdk.Aws.STACK_NAME, '-data']);

    const stackHelpers = StackHelpers.getOrCreate(this, resolver);
    const { derivedDomainName, derivedS3SafeDataStackName } = stackHelpers.resolveMailboxData(
      groups.ops, 'stack-helpers', { hostedZoneId: props.hostedZoneId ?? '', dataStackName: effectiveDataStackName },
    );

    // Derive S3-safe main stack name (no domain lookup needed, so hostedZoneId is empty)
    const { derivedS3SafeDataStackName: mainStackNameBase } = stackHelpers.resolveMailboxData(
      groups.ops, 'stack-helpers-main-stack', { hostedZoneId: '', dataStackName: Aws.STACK_NAME },
    );

    // Register the main stack's S3-safe name for use by constructs that need deterministic bucket/table naming
    setStackNameBase(this, mainStackNameBase);

    const domainName: string = derivedDomainName;
    const nameBase: string = derivedS3SafeDataStackName;

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'zone', {
      hostedZoneId: props.hostedZoneId ?? '',
      zoneName: domainName,
    });

    const subdomainNamespaceCondition = props.subdomainNamespace !== undefined
      ? new cdk.CfnCondition(this, 'HasSubdomainNamespace', {
          expression: cdk.Fn.conditionNot(
            cdk.Fn.conditionEquals(props.subdomainNamespace, ''),
          ),
        })
      : undefined;
    const enableAdminUi = props.enableAdminUi ?? true;
    const enableWebmailUi = props.enableWebmailUi ?? true;

    const mailboxDomains = new MailboxDomains({ domainName, prefix: props.subdomainNamespace, subdomainOverrides: props.overrides?.subdomains, prefixConditionName: subdomainNamespaceCondition?.logicalId });

    this.urls = {
      adminUi:  `https://${mailboxDomains.admin}`,
      webmail:  `https://${mailboxDomains.webmail}`,
      jmapApi:  `https://${mailboxDomains.jmap}`,
      adminApi: `https://${mailboxDomains.api}`,
    };

    // Configuration constants

    const encryptionPlan = resolveMailboxEncryptionPlan(this, props.kms);
    this.emailQueueProps = encryptionPlan.queues;

    // Resolve retained data resources via the auto-deployed data stack. Every field on `dataRef` is
    // already a narrow `IDataTable` grant interface (see `MailboxDataDeployer`/`MailboxDataStackRef`)
    // — no raw `ITable` reaches this composition root, so every Lambda and feature construct below
    // takes `dataRef.*` directly and grants itself.
    const dataRef = new MailboxDataDeployer(groups.data, 'data-deployer', {
      artifactResolver,
      nameBase,
      deployerType,
    });

    this.blobStoreBucket = dataRef.blobStoreBucket;
    this.blobStoreHandle = dataRef.blobStore;

    const { configTable, itemTable, changelogTable, auditLogTable, mailFeedbackTable } = dataRef;
    this.configTable = configTable;

    const auditWriting = new AuditWriting(groups.ops, 'audit-writing', {
      auditLogTable,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });

    // Auth key store - writes to DynamoDB for Lambda@Edge
    const authKeyStore = new AuthKeyStore(groups.auth, 'auth-key-store', {
      issuers: [authProvider.issuer],
      artifactResolver,
    });

    // Translate bare subdomainNamespace to dot-wrapped format for edge stack.
    // Edge stack expects: "." for no namespace, or ".{label}." for a namespace.
    // Use Fn.conditionIf to generate the correct format based on whether namespace is present.
    const edgePrefix: string = subdomainNamespaceCondition
      ? (cdk.Fn.conditionIf(
          subdomainNamespaceCondition.logicalId,
          cdk.Fn.join('', ['.', props.subdomainNamespace ?? '', '.']),
          '.',
        ) as unknown as string)
      : mailboxDomains.prefix
        ? `.${mailboxDomains.prefix}.`
        : '.';

    const edgeStack = new MailboxEdgeDeployer(groups.edge, 'stack-deployer', {
      domainName,
      artifactResolver,
      prefix: edgePrefix,
      hostedZone: props.hostedZoneId ? hostedZone : undefined,
      itemTable: dataRef.itemTable,
      configTable: dataRef.configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      productVersion: stackVersion,
      deployerType,
      logGroupName: PipelineLogGroup.getOrCreate(groups.edge, 'jmap').logGroupName,
    });

    const edgeCertificate = edgeStack.edgeCertificate;

    const hasHostedZone = Boolean(props.hostedZoneId);
    const useCustomCdnDomain = Boolean(props.overrides?.certificates?.cloudFront || hasHostedZone);

    const defaultUiCertificate = hasHostedZone ? edgeCertificate : undefined;
    if (hasHostedZone && !defaultUiCertificate) {
      throw new Error('hostedZone was provided but edge certificate was not created');
    }

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    // Prefer a single SAN certificate for both api.<domain> and jmap.<domain> when *neither* is provided.
    // If only one is provided, we still auto-create a certificate for the missing hostname so the API works.
    const providedApiCertificate = props.overrides?.certificates?.api;
    const providedJmapCertificate = props.overrides?.certificates?.jmap;
    const providedWsCertificate = props.overrides?.certificates?.ws;

    // If either API certificate is missing and we have Route53, create a single SAN cert
    // that covers both names and use it to fill the gaps.
    let regionalSanCertificate: acm.ICertificate | undefined;
    let cfnCert: acm.CfnCertificate | undefined;
    if (hasHostedZone && (!providedApiCertificate || !providedJmapCertificate)) {
      cfnCert = new acm.CfnCertificate(groups.edge, 'regional-api-certificate', {
        domainName: mailboxDomains.api,
        subjectAlternativeNames: [mailboxDomains.jmap, mailboxDomains.ws, `mcp.${domainName}`],
        validationMethod: 'DNS',
        domainValidationOptions: [
          { domainName: mailboxDomains.api, hostedZoneId: props.hostedZoneId! },
          { domainName: mailboxDomains.jmap, hostedZoneId: props.hostedZoneId! },
          { domainName: mailboxDomains.ws, hostedZoneId: props.hostedZoneId! },
          { domainName: `mcp.${domainName}`, hostedZoneId: props.hostedZoneId! },
        ],
      });
      cfnCert.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
      regionalSanCertificate = acm.Certificate.fromCertificateArn(groups.edge, 'regional-api-certificate-ref', cfnCert.ref);
    }

    const regionalCertificate = regionalSanCertificate;

    this.certificates = {
      edge:     edgeCertificate,
      regional: regionalCertificate,
    };

    const apiCertificate = providedApiCertificate
      ?? regionalSanCertificate;

    const jmapCertificate = providedJmapCertificate
      ?? regionalSanCertificate;

    // WebSocket push should not create a third certificate.
    // Use an explicit override when provided; otherwise only reuse the auto-created regional SAN cert.
    const wsCertificate = providedWsCertificate
      ?? regionalSanCertificate;

    const adminUiOrigins: string[] = [];
    const webmailUiOrigins: string[] = [];

    let adminUiRedirectUri: string | undefined;
    let webmailUiRedirectUri: string | undefined;

    let adminUiCnameTarget: string | undefined;
    let webmailUiCnameTarget: string | undefined;

    // SES event processing infrastructure (SNS, SQS, Lambda)
    const sesEventProcessing = new SESEventProcessing(groups.email, 'ses-event-processing', {
      itemTable,
      mailFeedbackTable,
      changelogTable,
      configTable,
      blobStore: this.blobStoreHandle,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });

    // Email sending infrastructure (SQS, Lambda) - must be before API
    const emailSending = new EmailSending(groups.email, 'email-sending', {
      configTable,
      itemTable,
      changelogTable,
      blobStore: this.blobStoreHandle,
      artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      queueProps: encryptionPlan.queues,
    });

    const identityProvisioner = new IdentityProvisionerLambda(groups.ops, 'identity-provisioner', {
      configTable,
      itemTable,
      changelogTable,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      adminUIURL: this.urls.adminUi,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      systemSenderAddress: `noreply@${domainName}`,
      vendorAccountIds,
    });

    // Build admin API addons early from all providers (auth provider + optional additional providers).
    // All addons are known at construction time, so uiConfig merge is eager.
    const adminApiAddons: IAdminApiAddon[] = (() => {
      const addons: IAdminApiAddon[] = [];

      const ctx: AdminApiAddonContext = {
        auditEventsQueue: auditWriting.auditEventsQueue,
        configTable,
        auditLogTable,
        identityProvisioner,
      };

      // Collect addons from auth provider
      addons.push(...authProvider.createAdminApiAddons(groups.apis, ctx));

      // Collect addons from optional addon providers
      for (const provider of props.adminApiAddonProviders ?? []) {
        addons.push(...provider.createAdminApiAddons(groups.apis, ctx));
      }

      return addons;
    })();

    const jmapApiAddonContext: JmapApiAddonContext = {
      apiBaseUrl: this.urls.jmapApi,
      identityProvisioner,
    };

    const jmapApiAddons: IJmapApiAddon[] = (() => {
      if (typeof authProvider.createJmapApiAddons !== 'function') return [];
      return authProvider.createJmapApiAddons(groups.apis, jmapApiAddonContext);
    })();

    const jmapOAuthIssuerUrl = authProvider.jmapOAuthIssuerUrl?.();

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

      // Merge uiConfig from all addons
      for (const addon of adminApiAddons) {
        if (addon.uiConfig) {
          Object.assign(mergedAdminUiConfig, addon.uiConfig);
        }
      }

      const adminUi = new AdminUi(groups.ui, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        webmailUrl: enableWebmailUi && (props.overrides?.certificates?.webmailUi ?? defaultUiCertificate)
          ? `https://${mailboxDomains.webmail}`
          : undefined,
        uiConfig: Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined,
        artifactResolver,
      });

      (this.oauthClients as { adminUi?: AuthClientConfig }).adminUi = adminUi.oauthClient;
      adminUiRedirectUri = adminUi.oauthRedirectUri;

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(adminUi, resolver);
    }

    if (enableWebmailUi) {
      const webmailUi = new WebmailUi(groups.ui, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
        configTable: this.configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
        uiBundle: { packageName: 'mailbox-webmail-ui', objectPath: 'webmail-ui.zip' },
        artifactResolver,
      });

      (this.oauthClients as { jmapUi?: AuthClientConfig }).jmapUi = webmailUi.oauthClient;
      webmailUiRedirectUri = webmailUi.oauthRedirectUri;

      webmailUiOrigins.push(`https://${webmailUi.distributionDomainName}`);
      webmailUiCnameTarget = webmailUi.distribution.distributionDomainName;

      grantUiContentDeployIfGrantable(webmailUi, resolver);
    }

    const extraOrigins = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi = [...webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn = [...adminUiOrigins, ...webmailUiOrigins, ...extraOrigins];

    const adminRequiredGroups = authProvider.policies.adminApi.requireAnyOfGroups
      ?? this.oauthClients.adminUi?.groups
      ?? undefined;

    new LicenseRefresh(groups.ops, 'license-refresh', {
      configTable,
      artifactResolver,
      coreDomain: domainName,
      vendorAccountIds,
    });

    // SES receipt rules and the email-processing queue they feed. Built before the email-processor
    // Lambda so its own event source mapping can reference the queue at construction time.
    const sesRules = new SesRules(groups.email, 'ses-rules', {
      delivery: {
        blobStore: this.blobStoreBucket,
        bucketPrefix: 'incoming-emails/',
        artifactResolver,
        queueProps: this.emailQueueProps,
      },
    });

    // Lambda function to process incoming emails
    this.emailProcessorLambda = new EmailProcessorLambda(groups.email, 'email-processor-lambda', {
      configTable,
      itemTable,
      changelogTable,
      blobStore: this.blobStoreHandle,
      emailProcessingQueue: sesRules.emailProcessingQueue,
      artifactResolver,
    });

    const bootstrap = new Bootstrap(groups.auth, 'bootstrap', {
      domain: domainName,
      oidcIssuer: authProvider.issuer,
      configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      artifactResolver,
      sesRuleSet: sesRules.ruleSet,
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
      oauthClients: (this.oauthClients.adminUi || this.oauthClients.jmapUi)
        ? {
          adminUi: this.oauthClients.adminUi
            ? {
              flow: 'authorization_code',
              clientId: this.oauthClients.adminUi.clientId,
              clientSecret: this.oauthClients.adminUi.clientSecret,
              scopes: ['openid', 'email', 'profile', ...this.oauthClients.adminUi.requestScopeList],
              redirectUri: adminUiRedirectUri ?? '/',
            }
            : undefined,
          jmapUi: this.oauthClients.jmapUi
            ? {
              flow: 'authorization_code',
              clientId: this.oauthClients.jmapUi.clientId,
              clientSecret: this.oauthClients.jmapUi.clientSecret,
              scopes: ['openid', 'email', 'profile', ...this.oauthClients.jmapUi.requestScopeList],
              redirectUri: webmailUiRedirectUri ?? '/',
            }
            : undefined,
        }
        : undefined,
    });
    // bootstrap is declared but only used for its side-effects; suppress unused-locals check.
    void bootstrap;

    // Stack-failure detector: watches the root stack's own terminal `CloudFormation Stack
    // Status Change` events. A terminal stack status is emitted only after the whole operation
    // concludes, so — unlike a resource-level trigger — this doesn't race resource creation and has
    // no ordering requirement relative to its ops-group siblings. Consent defaults to ENABLED;
    // `disabled` synthesizes zero detector resources (see StackFailureDetection for the CfnCondition
    // gating). The detector has no knowledge of the sweeper; its retained rule/function/role are
    // read below and registered as one removal on the shared sweeper — the same mechanism the
    // cert/edge Lambda targets already use. Built BEFORE SweeperInfra so its real rule/function/role
    // interfaces exist by the time the sweeper's worker IAM policy is assembled from the removals.
    const stackFailureDetection = new StackFailureDetection(groups.ops, 'stack-failure-detection', {
      mode: props.sendStackFailures ?? SendStackFailuresMode.ENABLED,
      artifactResolver,
    });

    // Extract the edge blob-authorizer Lambda ARN (strip version qualifier).
    // Version ARN:  arn:aws:lambda:us-east-1:<acct>:function:<name>:<version>
    // Function ARN: arn:aws:lambda:us-east-1:<acct>:function:<name>
    const versionArn = edgeStack.getOutput('blobAuthorizerVersionArn');
    const fnArnParts = Fn.split(':', versionArn);
    const edgeFunctionArn = Fn.join(':', [
      Fn.select(0, fnArnParts), // arn
      Fn.select(1, fnArnParts), // aws
      Fn.select(2, fnArnParts), // lambda
      Fn.select(3, fnArnParts), // us-east-1
      Fn.select(4, fnArnParts), // account
      Fn.select(5, fnArnParts), // function
      Fn.select(6, fnArnParts), // <function-name>
      // Fn.select(7, ...) is the version number — intentionally dropped
    ]);
    // Imported by ARN, not a real cross-stack construct reference: the blob authorizer lives in the
    // separate edge sub-stack, so this is the standard CDK "import" pattern for handing the sweeper
    // a real IFunction instead of a loose ARN string.
    const edgeFunction = awslambda.Function.fromFunctionArn(groups.ops, 'edge-fn-removal-target', edgeFunctionArn);

    // Register every retained/orphan-prone resource as its own removal on the sweeper. Each
    // implementation owns its own target data, IAM grants and state-machine steps — see
    // `features/sweeper/*-removal.ts`.
    const removals: IResourceRemoval[] = [];
    if (regionalSanCertificate) {
      removals.push(new CertificateRemoval(groups.ops, 'cert-removal', { certificate: regionalSanCertificate }));
    }
    removals.push(new EdgeFunctionRemoval(groups.ops, 'edge-fn-removal', { function: edgeFunction }));
    if (stackFailureDetection.sweepTargets) {
      removals.push(new StackFailureDetectorRemoval(groups.ops, 'stack-failure-detector-removal', stackFailureDetection.sweepTargets));
    }

    // Resource sweeper infrastructure (SFN + worker Lambda). Handles async cleanup of retained
    // resources (ACM cert, edge Lambda, and — when enabled — the stack-failure detector's own
    // rule/function/role) after stack deletion. Each registered removal contributes its own IAM
    // grants and state-machine steps (including any waiting) — see `features/sweeper/removal.ts`.
    const sweeperInfra = new SweeperInfra(groups.ops, 'sweeper-infra', {
      artifactResolver,
      removals,
    });

    // Trigger + property carrier: fires the sweeper's starter Lambda on stack Delete or Update. Each
    // removal above contributes its own keyed entry to the custom resource's properties (see
    // `DeferredRemoval`), which the starter diffs against `OldResourceProperties` to sweep whatever
    // changed on Update, or everything present on Delete.
    new DeferredRemoval(groups.ops, 'deferred-removal', {
      sweeperStarter: sweeperInfra.starter,
      removals,
    });

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(groups.edge, 'blob-cdn', {
      blobStore: this.blobStoreBucket,
      configTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      userPoolIssuer: authProvider.issuer,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      blobAuthorizerVersion: edgeStack.blobAuthorizerVersion,
      domainName: useCustomCdnDomain ? mailboxDomains.cdn : undefined,
      certificate: hasHostedZone ? edgeCertificate : props.overrides?.certificates?.cloudFront,
    });

    // DNS is created later, once all endpoint targets are known.

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    const tantivySearch = new TantivySearch(groups.search, 'tantivy-search', {
      indexBucket: this.blobStoreHandle,
      itemTable,
      configTable,
      changelogTable,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    // tantivySearch is used for side-effects only at this level.
    void tantivySearch;

    // JMAP must always advertise the JMAP_UI OAuth client in its session response.
    // That client is provisioned when the Webmail UI is enabled.
    const jmapOAuthClientId = this.oauthClients.jmapUi?.clientId;
    if (!jmapOAuthClientId) {
      throw new Error(
        'JMAP API requires the JMAP_UI OAuth client (for session OAuth2 metadata). ' +
        'Enable the Webmail UI, or adjust the auth provider to provision JMAP_UI independently.',
      );
    }

    this.jmapApi = new JMapApi(groups.apis, 'jmap-api', {
      configTable,
      itemTable,
      changelogTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      cdnHost: cdnConstruct.host,
      allowedOrigins: allowedOriginsForJmapApi.length > 0 ? allowedOriginsForJmapApi : undefined,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver,
      authProvider,
      identityProvisioner,

      oauthClientId: jmapOAuthClientId,

      domainName: jmapCertificate ? mailboxDomains.jmap : undefined,
      certificate: jmapCertificate,

      jmapApiAddons,
      oauthIssuerUrl: jmapOAuthIssuerUrl,
      vendorAccountIds,

      // WebSocket URL will be passed via environment variable, not here
    });
    const jmapApi = this.jmapApi;

    // WebSocket Push infrastructure - must be after API to reuse authorizer
    const webSocketPush = new WebSocketPush(groups.apis, 'websocket-push', {
      configTable,
      itemTable,
      changelogTable,
      authorizerLambda: jmapApi.authorizerLambda, // Reuse HTTP API authorizer
      artifactResolver,
      maxSubscriptions: 10,

      domainName: (hasHostedZone && wsCertificate) ? mailboxDomains.ws : undefined,
      certificate: hasHostedZone ? wsCertificate : undefined,
    });
    // Keep a deeper messaging override — websocket-push overrides the apis group tag.
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');
    const adminApi = new AdminApi(groups.apis, 'admin-api', {
      configTable,
      itemTable,
      auditLogTable,
      changelogTable,
      mailFeedbackTable,
      authKeyStoreTable: authKeyStore.authKeyStoreTable,
      blobStore: this.blobStoreHandle,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      allowedOrigins: allowedOriginsForAdminApi.length > 0 ? allowedOriginsForAdminApi : undefined,
      artifactResolver,
      authProvider,
      identityProvisioner,
      vendorAccountIds,
      stackIdentityTagKey,

      addons: adminApiAddons,

      domainName: apiCertificate ? mailboxDomains.api : undefined,
      certificate: apiCertificate,

      sesRuleSetName: sesRules.ruleSetName,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      systemSenderAddress: `noreply@${domainName}`,
    });

    const mcpApi = props.enableMcp ? new McpApi(groups.apis, 'mcp-api', {
      jmapApiGateway: this.jmapApi.httpApi,
      authorizerLambda: this.jmapApi.authorizerLambda,
      certificate: this.certificates.regional!,
      domainName: domainName,
      scopeMap: props.authProvider.scopeMap as Record<string, string[]>,
      artifactResolver,
    }) : undefined;

    jmapApi.enableWebSocketPublishing(webSocketPush.webSocketUrl, webSocketPush.broadcaster);
    adminApi.enableWebSocketPublishing(webSocketPush.broadcaster);

    // Enable WebSocket push emission from the ChangeTracker.
    // This must be wired into every Lambda that records changelog state.
    this.emailProcessorLambda.enableWebSocketPublishing(webSocketPush.broadcaster);
    emailSending.enableWebSocketPublishing(webSocketPush.broadcaster);
    sesEventProcessing.enableWebSocketPublishing(webSocketPush.broadcaster);

    // --- Pin logical IDs to survive reparenting ---
    // API Gateway custom domain names are globally unique per account/region; a reparented
    // construct cannot create the replacement alongside the still-existing original, so
    // create-before-delete would fail on a name collision. Pinning the logical ID keeps
    // CloudFormation updating the same domain name in place instead of replacing it.
    // admin-api custom domain
    adminApi.domainCfnResource?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    // jmap-api custom domain
    jmapApi.domainCfnResource?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
    // websocket-push custom domain
    webSocketPush.domainCfnResource?.overrideLogicalId('MailboxwebsocketpushdomainCACDAF3B');

    if (hasHostedZone) {
      const dns = new MailboxDns(groups.edge, 'dns', {
        names: mailboxDomains,
        hostedZone: hostedZone,
        cnameTargets: {
          admin: adminUiCnameTarget,
          webmail: webmailUiCnameTarget,
          cdn: cdnConstruct.distribution.distributionDomainName,
          api: adminApi.domainTarget,
          jmap: jmapApi.domainTarget,
          ws: webSocketPush.domainTarget,
          mcp: mcpApi?.domainTarget,
        },
      });
      // dns is used for side-effects only at this level.
      void dns;
    }

    // Phase 3: add Name tags and native descriptions to every L1 resource under this construct.
    // The aspect writes Name tags directly to each resource's TagManager (no sub-aspect spawned),
    // so default aspect priority is fine.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(id));

    // Per-region AWS Resource Group collecting all resources tagged with this deployment's
    // root-stack (this is the main stack, so root-stack = AWS::StackName).
    addServerlessInboxResourceGroup(this, 'resource-group');

  }

}

/**
 * Grants `resolver` write access to `ui`'s own content bucket, when `resolver` is capable of
 * being granted at all. `resolver` is typed `IArtifactResolver`, which carries no IAM principal,
 * so grantability is a runtime capability some resolvers have (e.g. `AutoUpdater`, which drives
 * the scheduled UI content refresh) and others don't (`PinnedResolver` never touches a UI bucket
 * at runtime, so it needs no grant and must be skipped rather than erroring).
 */
function grantUiContentDeployIfGrantable(ui: MailboxUi, resolver: IArtifactResolver): void {
  if (isGrantable(resolver)) {
    ui.grantContentDeploy(resolver);
  }
}

function isGrantable(resolver: IArtifactResolver): resolver is IArtifactResolver & IGrantable {
  return 'grantPrincipal' in resolver;
}
