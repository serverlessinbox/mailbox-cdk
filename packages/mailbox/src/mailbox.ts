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
import { MailboxArtifactResolverFactory, PipelineLogGroup, applyServerlessInboxBaseTags, applyServerlessInboxComponentTag, ServerlessInboxTagKeys, resolveVendorAccountIds, resolveDeployerType, setStackNameBase } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
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
import { loadMailboxRegistryRecord } from './mailbox-registry-record';
import { loadMailboxArtifactVersions } from './mailbox-artifact-versions';

// SesReceivingMode is the type of MailboxProps.enableReceiving and is exported from the package through this module.
export {
  SesReceivingMode
} from './lambdas';

/**
 * Your own ACM certificates for the endpoints a Mailbox serves, for when you manage DNS and
 * certificates yourself. Every field left out falls back to the certificate the Mailbox creates
 * itself, which requires `MailboxProps.hostedZoneId`.
 */
export interface MailboxCertificateOverrides {
  /**
   * Certificate attached to the CDN's alternate domain name (cdn.<domain>). It must be issued in
   * us-east-1, because CloudFront only accepts certificates from there.
   *
   * Used only when `MailboxProps.hostedZoneId` is not set; with a hosted zone the Mailbox's own
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
   * Used only when `MailboxProps.hostedZoneId` is set: it then takes precedence over the regional
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
}

/**
 * The public HTTPS URLs of the endpoints a Mailbox serves. The domain is derived at deploy time,
 * so each value is an unresolved token at synth time: build on it by concatenation and do not
 * parse it. With `MailboxProps.subdomainNamespace`, each host sits under the namespace
 * (admin.<namespace>.<domain>).
 */
export interface MailboxUrls {
  /** URL of the Admin UI: `https://admin.<domainName>`. */
  readonly adminUi: string;
  /** URL of the Webmail UI: `https://webmail.<domainName>`. */
  readonly webmail: string;
  /** URL of the JMAP API: `https://jmap.<domainName>`. */
  readonly jmapApi: string;
  /** URL of the Admin API: `https://api.<domainName>`. */
  readonly adminApi: string;
}

/**
 * The ACM certificates a Mailbox created for itself. A field is undefined when the Mailbox did
 * not create that certificate.
 */
export interface MailboxCertificates {
  /**
   * The us-east-1 ACM certificate for the CloudFront (edge) alternate domain names. Present only
   * when `MailboxProps.hostedZoneId` is set.
   */
  readonly edge?: acm.ICertificate;
  /**
   * The regional ACM SAN certificate covering the api, jmap, ws and mcp subdomains. Present only
   * when `MailboxProps.hostedZoneId` is set and at least one of `overrides.certificates.api` and
   * `overrides.certificates.jmap` is not supplied.
   */
  readonly regional?: acm.ICertificate;
}

/**
 * Replacements for the certificates and subdomain labels a Mailbox would otherwise generate.
 */
export interface MailboxOverrides {
  /**
   * Your own ACM certificates per endpoint. When omitted, the Mailbox creates the certificates it
   * needs, which requires `MailboxProps.hostedZoneId`. Supply individual fields to bypass that
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
   * The Route53 hosted zone that serves your domain. The Mailbox derives the domain name from the
   * zone at deploy time, creates DNS records for its endpoints in it, and creates the ACM
   * certificates they need.
   *
   * When omitted, no DNS records or certificates are created: supply your own through
   * `overrides.certificates` and point DNS at the endpoints yourself.
   */
  readonly hostedZoneId?: string;

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
   * including the scheme, for example `http://localhost:5173` during local development. The
   * origins of the Admin and Webmail UIs are added automatically.
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
   * OAuth client. Disabling it makes synthesis fail, because the JMAP API requires the JMAP UI
   * OAuth client that the Webmail UI provisions.
   *
   * @default true
   */
  readonly enableWebmailUi?: boolean;

  /**
   * Whether to activate the MCP (Model Context Protocol) API at mcp.<domain>. Requires an Advanced
   * license tier. The MCP endpoint uses the regional certificate the Mailbox creates, so it also
   * requires `hostedZoneId`, and `overrides.certificates` must not supply both `api` and `jmap`,
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

/**
 * The OAuth clients a Mailbox created for its UIs. A field is present only when the
 * corresponding UI is enabled.
 */
export interface MailboxOAuthClients {
  /** The Admin UI's OAuth client; present only when `MailboxProps.enableAdminUi` is not false. */
  readonly adminUi?: AuthClientConfig;
  /** The Webmail UI's OAuth client, used by the JMAP API's session metadata. */
  readonly jmapUi?: AuthClientConfig;
}

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
  private readonly emailProcessorLambda: EmailProcessorLambda;
  private readonly configTable: IDataTable;
  private readonly emailQueueProps: ReturnType<typeof resolveMailboxEncryptionPlan>['queues'];

  private readonly jmapApi: JMapApi;

  /**
   * The OAuth clients this Mailbox created for its UIs. A client is present only when its UI is
   * enabled.
   */
  public readonly oauthClients: MailboxOAuthClients = {};

  /** The public URLs of the endpoints this Mailbox serves. */
  public readonly urls: MailboxUrls;

  /** The ACM certificates this Mailbox created for itself. */
  public readonly certificates: MailboxCertificates;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const authProvider: IMailboxAuthProvider = props.authProvider;

    const deployerType = resolveDeployerType(this);

    // Resolved once here, as the composition root, and threaded down as a prop.
    const vendorAccountIds = resolveVendorAccountIds(this);
    const stackIdentityTagKey = ServerlessInboxTagKeys.rootStack;

    // One resolver, threaded to every sub-construct. Default is pinned from the package's baked
    // versions, overridden by CDK context.
    const artifactResolver: IArtifactResolver = props.artifactResolver
      ?? MailboxArtifactResolverFactory.fromContext(this, loadMailboxRegistryRecord(), loadMailboxArtifactVersions());
    const stackVersion = artifactResolver.getVersion('mailbox-cdk');

    // Tags everything under this construct so cost and usage can be sliced per deployment.
    // Uses AWS::StackName so this also works when deployed via pure CloudFormation.
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

    const stackHelpers = StackHelpers.getOrCreate(this, artifactResolver);
    const { derivedDomainName, derivedS3SafeDataStackName } = stackHelpers.resolveMailboxData(
      groups.ops, 'stack-helpers', { hostedZoneId: props.hostedZoneId ?? '', dataStackName: effectiveDataStackName },
    );

    // Derive S3-safe main stack name (no domain lookup needed, so hostedZoneId is empty)
    const { derivedS3SafeDataStackName: mainStackNameBase } = stackHelpers.resolveMailboxData(
      groups.ops, 'stack-helpers-main-stack', { hostedZoneId: '', dataStackName: Aws.STACK_NAME },
    );

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

    const encryptionPlan = resolveMailboxEncryptionPlan(this, props.kms);
    this.emailQueueProps = encryptionPlan.queues;

    // Retained data resources come from the auto-deployed data stack. Every field on `dataRef` is
    // an `IDataTable` grant interface; no raw `ITable` reaches this scope.
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

    const authKeyStore = new AuthKeyStore(groups.auth, 'auth-key-store', {
      issuers: [authProvider.issuer],
      artifactResolver,
    });

    // Translate bare subdomainNamespace to dot-wrapped format for edge stack.
    // Edge stack expects: "." for no namespace, or ".{label}." for a namespace.
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
    const providedApiCertificate = props.overrides?.certificates?.api;
    const providedJmapCertificate = props.overrides?.certificates?.jmap;
    const providedWsCertificate = props.overrides?.certificates?.ws;

    // If either API certificate is missing and there is a hosted zone, one SAN certificate covers
    // the api, jmap, ws and mcp names and fills the gaps.
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

    // WebSocket push uses the explicit override or else the regional SAN cert; it never creates its own.
    const wsCertificate = providedWsCertificate
      ?? regionalSanCertificate;

    const adminUiOrigins: string[] = [];
    const webmailUiOrigins: string[] = [];

    let adminUiRedirectUri: string | undefined;
    let webmailUiRedirectUri: string | undefined;

    let adminUiCnameTarget: string | undefined;
    let webmailUiCnameTarget: string | undefined;

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
        artifactResolver,
      };

      addons.push(...authProvider.createAdminApiAddons(groups.apis, ctx));

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

      grantUiContentDeployIfGrantable(adminUi, artifactResolver);
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

      grantUiContentDeployIfGrantable(webmailUi, artifactResolver);
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
    // concludes, so the detector has no ordering requirement relative to its ops-group siblings.
    // Consent defaults to ENABLED; `disabled` synthesizes zero detector resources (see
    // StackFailureDetection for the CfnCondition gating). Built before SweeperInfra: its retained
    // rule/function/role are registered below as one removal, and the sweeper's worker IAM policy
    // is assembled from the registered removals.
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
    // Imported by ARN: the blob authorizer lives in the separate edge sub-stack, so there is no
    // construct reference to it.
    const edgeFunction = awslambda.Function.fromFunctionArn(groups.ops, 'edge-fn-removal-target', edgeFunctionArn);

    // Each retained resource is registered as its own removal.
    const removals: IResourceRemoval[] = [];
    if (regionalSanCertificate) {
      removals.push(new CertificateRemoval(groups.ops, 'cert-removal', { certificate: regionalSanCertificate }));
    }
    removals.push(new EdgeFunctionRemoval(groups.ops, 'edge-fn-removal', { function: edgeFunction }));
    if (stackFailureDetection.sweepTargets) {
      removals.push(new StackFailureDetectorRemoval(groups.ops, 'stack-failure-detector-removal', stackFailureDetection.sweepTargets));
    }

    // Resource sweeper (Step Functions + worker Lambda): asynchronous cleanup of the retained
    // resources after stack deletion.
    const sweeperInfra = new SweeperInfra(groups.ops, 'sweeper-infra', {
      artifactResolver,
      removals,
    });

    // Fires the sweeper's starter Lambda on stack Delete or Update. CloudFormation supplies
    // `OldResourceProperties` on Update, so the starter can sweep only what changed; on Delete it
    // sweeps everything present.
    new DeferredRemoval(groups.ops, 'deferred-removal', {
      sweeperStarter: sweeperInfra.starter,
      removals,
    });

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

    // Created after the JMAP API because it reuses that API's authorizer Lambda.
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

    // Enable WebSocket push emission from the ChangeTracker in each Lambda that records changelog state.
    this.emailProcessorLambda.enableWebSocketPublishing(webSocketPush.broadcaster);
    emailSending.enableWebSocketPublishing(webSocketPush.broadcaster);
    sesEventProcessing.enableWebSocketPublishing(webSocketPush.broadcaster);

    // --- Pin logical IDs to survive reparenting ---
    // API Gateway custom domain names are globally unique per account/region; a reparented
    // construct cannot create the replacement alongside the still-existing original, so
    // create-before-delete would fail on a name collision. Pinning the logical ID keeps
    // CloudFormation updating the same domain name in place instead of replacing it.
    adminApi.domainCfnResource?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    jmapApi.domainCfnResource?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
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
