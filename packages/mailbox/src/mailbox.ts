import { Construct } from 'constructs';
import { AuthKeyStore } from './features/auth-key-store';
import { Cdn } from './features/cdn-construct';
import { TantivySearch } from './search';
import { EmailSending, SESEventProcessing } from './email';
import { AdminApi } from './api/admin-api';
import { JMapApi } from './api/jmap-api';
import { WebSocketPush } from './api/websocket';
import { McpApi } from './api/mcp-api';
import type { IAdminApiAddon, AdminApiAddonContext } from './api';
import { SesRules } from './email/receiving/ses-rules';
import {
  AuthClientConfig,
} from './auth/types';
import type { IMailboxAuthProvider } from './auth/types';
import { EmailProcessorLambda } from './lambdas/email-processor';
import { CertWaiterLambda, SesReceivingMode, UserProvisionerLambda } from './lambdas';
import { AuditWriting } from './features/audit-writing';
import { createArtifactResolverFromContext } from './artifacts/artifact-context';
import { Bootstrap } from './features/bootstrap';
import { CertificateWaiter } from './features/certificate-waiter';
import { LicenseRefresh } from './features/license-refresh';
import { MailboxDns, MailboxDomains } from './domains';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { MailboxEdgeDeployer } from './edge';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { AdminUi } from './ui/admin-ui';
import { WebmailUi } from './ui/webmail-ui';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import { Aws } from 'aws-cdk-lib';
import { MailboxDataDeployer } from './data';
import { MailboxDataStackRef } from './data';
import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  type ServerlessInboxDeployer,
} from './utils/serverless-inbox-tags';
import type { MailboxKmsConfig } from './utils/kms';
import { resolveMailboxEncryptionPlan } from './utils/mailbox-encryption';
import { StackHelpers } from './utils/stack-helpers';
import { MailboxResourceDescriptions } from './utils/resource-descriptions';
import { addServerlessInboxResourceGroup } from './utils/resource-group';

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

export interface MailboxDataRefs {
  /** S3 bucket: raw email MIME files, blob uploads, Tantivy search index objects. */
  readonly blobStore: IBucket;
  /** DynamoDB table: account/domain configuration, SES config, auth routing. */
  readonly configTable: ITable;
  /** DynamoDB table: all JMAP mailbox items (emails, mailboxes, threads, contacts). */
  readonly itemTable: ITable;
  /** DynamoDB table: JMAP state changelog for client sync. */
  readonly changelogTable: ITable;
  /** DynamoDB table: audit log entries. */
  readonly auditLogTable: ITable;
  /** DynamoDB table: SES bounce and complaint feedback records. */
  readonly mailFeedbackTable: ITable;
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
   * Externally-managed MailboxDataStack reference.
   * When omitted, a MailboxDataDeployer custom resource is used.
   */
  readonly dataStack?: MailboxDataStackRef;

  /**
   * Custom data stack name. When omitted, defaults to "${AWS::StackName}-data".
   */
  readonly dataStackName?: string;

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
}

export interface MailboxOAuthClients {
  readonly adminUi?: AuthClientConfig;
  readonly jmapUi?: AuthClientConfig;
}


/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  private readonly _blobStore: IBucket;
  private readonly _emailProcessorLambda: EmailProcessorLambda;
  private readonly _configTable: ITable;
  private readonly emailQueueProps: ReturnType<typeof resolveMailboxEncryptionPlan>['queues'];

  /** Admin UI resources (when `enableAdminUi !== false`). */
  public readonly adminUiBucket?: IBucket;
  public readonly adminUiDistribution?: IDistribution;

  /** Webmail UI resources (when `enableWebmailUi !== false`). */
  public readonly webmailUiBucket?: IBucket;
  public readonly webmailUiDistribution?: IDistribution;

  private readonly _jmapApi: JMapApi;

  /** OAuth clients created by this construct (only when enabled). */
  public readonly oauthClients: MailboxOAuthClients = {};

  public readonly urls: MailboxUrls;

  public readonly data: MailboxDataRefs;

  public readonly certificates: MailboxCertificates;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const authProvider: IMailboxAuthProvider = props.authProvider;

    const deployer: ServerlessInboxDeployer = (() => {
      const v = this.node.tryGetContext('deployer');
      if (v === 'cdk' || v === 'cfn' || v === 'marketplace') return v;
      if (v !== undefined && v !== null) {
        throw new Error(
          `@serverlessinbox/mailbox: invalid CDK context value for "deployer": "${v}". ` +
          'Must be one of: cdk, cfn, marketplace.',
        );
      }
      return 'cfn';
    })();

    // Tag everything under this construct so customers can easily slice cost/usage.
    // Use AWS::StackName so this also works when deployed via pure CloudFormation.
    const artifactResolver = createArtifactResolverFromContext(this);
    const stackVersion = artifactResolver.getVersion('mailbox-cdk');

    applyServerlessInboxBaseTags(this, {
      // This is the main stack, so it is its own root-stack (base helper also tags `stack`).
      rootStack: Aws.STACK_NAME,
      version: stackVersion,
      deployer,
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
    const effectiveDataStackName = props.overrides?.dataStackName ?? cdk.Fn.join('', [cdk.Aws.STACK_NAME, '-data']);

    const stackHelpers = new StackHelpers(groups.ops, 'stack-helpers', {
      artifactResolver,
      hostedZoneId: props.hostedZoneId ?? '',
      dataStackName: effectiveDataStackName,
    });

    const domainName: string = stackHelpers.derivedDomainName;
    const s3NameBase: string = stackHelpers.derivedS3SafeDataStackName;

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

    // Resolve retained data resources (from auto-deployed data stack or externally-managed ref)
    const dataRef = props.overrides?.dataStack ?? new MailboxDataDeployer(groups.data, 'data-deployer', {
      artifactResolver,
      dataStackName: props.overrides?.dataStackName,
      s3NameBase,
    });

    this._blobStore   = dataRef.blobStore;
    this._configTable = dataRef.configTable;

    this.data = {
      blobStore:         dataRef.blobStore,
      configTable:       dataRef.configTable,
      itemTable:         dataRef.itemTable,
      changelogTable:    dataRef.changelogTable,
      auditLogTable:     dataRef.auditLogTable,
      mailFeedbackTable: dataRef.mailFeedbackTable,
    };

    const auditWriting = new AuditWriting(groups.ops, 'audit-writing', {
      auditLogTable: dataRef.auditLogTable,
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
      artifactResolver: artifactResolver,
      prefix: edgePrefix,
      hostedZoneId: props.hostedZoneId,
      hostedZoneName: domainName,
      itemTableArn: dataRef.itemTable.tableArn,
      configTableArn: dataRef.configTable.tableArn,
      authKeyStoreTableArn: authKeyStore.table.tableArn,
      productVersion: stackVersion,
      deployer,
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

    if (enableAdminUi) {
      const providerAdminUiConfig = authProvider.adminUiConfig?.();
      const providerAuthz = authProvider.authorizationConfig?.();

      const mergedAdminUiConfig = {
        ...(providerAdminUiConfig ?? {}),
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

      const adminUi = new AdminUi(groups.ui, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
        configTable: this._configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        webmailUrl: enableWebmailUi && (props.overrides?.certificates?.webmailUi ?? defaultUiCertificate)
          ? `https://${mailboxDomains.webmail}`
          : undefined,
        uiConfig: Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined,
      });

      this.adminUiBucket = adminUi.bucket;
      this.adminUiDistribution = adminUi.distribution;

      (this.oauthClients as { adminUi?: AuthClientConfig }).adminUi = adminUi.oauthClient;
      adminUiRedirectUri = adminUi.oauthRedirectUri;

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;
    }

    if (enableWebmailUi) {
      const webmailUi = new WebmailUi(groups.ui, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
        configTable: this._configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
        uiBundle: { packageName: 'mailbox-webmail-ui', objectPath: 'webmail-ui.zip' },
      });

      this.webmailUiBucket = webmailUi.bucket;
      this.webmailUiDistribution = webmailUi.distribution;

      (this.oauthClients as { jmapUi?: AuthClientConfig }).jmapUi = webmailUi.oauthClient;
      webmailUiRedirectUri = webmailUi.oauthRedirectUri;

      webmailUiOrigins.push(`https://${webmailUi.distributionDomainName}`);
      webmailUiCnameTarget = webmailUi.distribution.distributionDomainName;
    }

    const extraOrigins = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi = [...webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn = [...adminUiOrigins, ...webmailUiOrigins, ...extraOrigins];

    const adminRequiredGroups = authProvider.policies.adminApi.requireAnyOfGroups
      ?? this.oauthClients.adminUi?.groups
      ?? undefined;

    new LicenseRefresh(groups.ops, 'license-refresh', {
      configTable: dataRef.configTable,
      artifactResolver,
    });

    // Lambda function to process incoming emails
    this._emailProcessorLambda = new EmailProcessorLambda(groups.email, 'email-processor-lambda', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      blobStore: this._blobStore,
      artifactResolver,
    });

    const sesRules = new SesRules(groups.email, 'ses-rules', {
      delivery: {
        blobStore: this._blobStore,
        emailProcessor: this._emailProcessorLambda,
        bucketPrefix: 'incoming-emails/',
        artifactResolver,
        queueProps: this.emailQueueProps,
      },
    });

    const bootstrap = new Bootstrap(groups.auth, 'bootstrap', {
      domain: domainName,
      oidcIssuer: authProvider.issuer,
      configTable: dataRef.configTable,
      jwkCacheTable: authKeyStore.table,
      authKeyStoreTable: authKeyStore.table,
      artifactResolver,
      sesReceiving: props.enableReceiving
        ? { ruleSet: sesRules.ruleSet, mode: props.enableReceiving }
        : undefined,
      sesSendEnabled: true,
      hostedZone: hasHostedZone ? hostedZone : undefined,

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

    // If a regional SAN cert was auto-created, insert a waiter custom resource.
    // On deletion, the waiter polls ACM DescribeCertificate until InUseBy is empty,
    // preventing the "Certificate is in use" CloudFormation error.
    let certWaiter: CertificateWaiter | undefined;
    if (regionalSanCertificate) {
      const certWaiterLambda = new CertWaiterLambda(groups.edge, 'cert-waiter-lambda', {
        artifactResolver,
      });
      certWaiter = new CertificateWaiter(groups.edge, 'regional-cert-waiter', {
        certificate: regionalSanCertificate,
        certWaiterLambda,
      });
    }

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(groups.edge, 'blob-cdn', {
      blobStore: this._blobStore,
      configTable: dataRef.configTable,
      authKeyStoreTable: authKeyStore.table,
      userPoolIssuer: authProvider.issuer,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      blobAuthorizerVersion: edgeStack.blobAuthorizerVersion,
      domainName: useCustomCdnDomain ? mailboxDomains.cdn : undefined,
      certificate: hasHostedZone ? edgeCertificate : props.overrides?.certificates?.cloudFront,
    });

    // DNS is created later, once all endpoint targets are known.

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    const tantivySearch = new TantivySearch(groups.search, 'tantivy-search', {
      indexBucket: this._blobStore,
      itemTable: dataRef.itemTable,
      configTable: dataRef.configTable,
      changelogTable: dataRef.changelogTable,
      artifactResolver: artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    // tantivySearch is used for side-effects only at this level.
    void tantivySearch;

    // SES event processing infrastructure (SNS, SQS, Lambda)
    const sesEventProcessing = new SESEventProcessing(groups.email, 'ses-event-processing', {
      itemTable: dataRef.itemTable,
      mailFeedbackTable: dataRef.mailFeedbackTable,
      changelogTable: dataRef.changelogTable,
      configTable: dataRef.configTable,
      blobStore: this._blobStore,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      queueProps: encryptionPlan.queues,
    });


    // Email sending infrastructure (SQS, Lambda) - must be before API
    const emailSending = new EmailSending(groups.email, 'email-sending', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      blobStore: this._blobStore,
      artifactResolver: artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      queueProps: encryptionPlan.queues,
    });

    // JMAP must always advertise the JMAP_UI OAuth client in its session response.
    // That client is provisioned when the Webmail UI is enabled.
    const jmapOAuthClientId = this.oauthClients.jmapUi?.clientId;
    if (!jmapOAuthClientId) {
      throw new Error(
        'JMAP API requires the JMAP_UI OAuth client (for session OAuth2 metadata). ' +
        'Enable the Webmail UI, or adjust the auth provider to provision JMAP_UI independently.',
      );
    }

    const userProvisioner = new UserProvisionerLambda(groups.ops, 'user-provisioner', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      adminUIURL: this.urls.adminUi,
      blobStore: this._blobStore,
      emailSubmissionQueue: emailSending.submissionQueue,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
    });
    userProvisioner.addEnvironment('SYSTEM_SENDER_ADDRESS', `noreply@${domainName}`);

    this._jmapApi = new JMapApi(groups.apis, 'jmap-api', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      authKeyStoreTable: authKeyStore.table,
      cdnHost: cdnConstruct.host,
      allowedOrigins: allowedOriginsForJmapApi.length > 0 ? allowedOriginsForJmapApi : undefined,
      blobStore: this._blobStore,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      authProvider,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      userProvisionerFunction: userProvisioner,

      oauthClientId: jmapOAuthClientId,

      domainName: jmapCertificate ? mailboxDomains.jmap : undefined,
      certificate: jmapCertificate,

      // WebSocket URL will be passed via environment variable, not here
    });
    const jmapApi = this._jmapApi;

    // WebSocket Push infrastructure - must be after API to reuse authorizer
    const webSocketPush = new WebSocketPush(groups.apis, 'websocket-push', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      authKeyStoreTable: authKeyStore.table,
      authorizerLambda: jmapApi.authorizerLambda, // Reuse HTTP API authorizer
      artifactResolver: artifactResolver,
      maxSubscriptions: 10,

      domainName: (hasHostedZone && wsCertificate) ? mailboxDomains.ws : undefined,
      certificate: hasHostedZone ? wsCertificate : undefined,
    });
    // Keep a deeper messaging override — websocket-push overrides the apis group tag.
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');

    const adminApiAddons: IAdminApiAddon[] = (() => {
      if (typeof authProvider.createAdminApiAddons !== 'function') return [];

      const ctx: AdminApiAddonContext = {
        auditEventsQueue: auditWriting.auditEventsQueue,
      };

      return authProvider.createAdminApiAddons(this, ctx);
    })();

    const adminApi = new AdminApi(groups.apis, 'admin-api', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      auditLogTable: dataRef.auditLogTable,
      changelogTable: dataRef.changelogTable,
      mailFeedbackTable: dataRef.mailFeedbackTable,
      authKeyStoreTable: authKeyStore.table,
      blobStore: this._blobStore,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      allowedOrigins: allowedOriginsForAdminApi.length > 0 ? allowedOriginsForAdminApi : undefined,
      artifactResolver: artifactResolver,
      authProvider,
      userProvisionerFunction: userProvisioner,

      addons: adminApiAddons,

      domainName: apiCertificate ? mailboxDomains.api : undefined,
      certificate: apiCertificate,

      sesRuleSetName: sesRules.ruleSetName,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
    });
    adminApi.apiHandlerLambda.addEnvironment('SYSTEM_SENDER_ADDRESS', `noreply@${domainName}`);

    const mcpApi = props.enableMcp ? new McpApi(groups.apis, 'mcp-api', {
      configTable: this._configTable,
      jmapApiGateway: this._jmapApi.httpApi,
      authorizerLambda: this._jmapApi.authorizerLambda,
      certificate: this.certificates.regional!,
      domainName: domainName,
      scopeMap: props.authProvider.scopeMap as Record<string, string[]>,
    }) : undefined;

    if (certWaiter) {
      jmapApi.node.addDependency(certWaiter);
      webSocketPush.node.addDependency(certWaiter);
      adminApi.node.addDependency(certWaiter);
    }

    jmapApi.enableWebSocketPublishing(webSocketPush.webSocketUrl, webSocketPush.broadcaster);
    adminApi.enableWebSocketPublishing(webSocketPush.broadcaster);

    // Enable WebSocket push emission from the ChangeTracker.
    // This must be wired into every Lambda that records changelog state.
    this._emailProcessorLambda.enableWebSocketPublishing(webSocketPush.broadcaster);
    emailSending.enableWebSocketPublishing(webSocketPush.broadcaster);
    sesEventProcessing.enableWebSocketPublishing(webSocketPush.broadcaster);

    // --- Pin 5 logical IDs to survive reparenting ---
    // admin-api custom domain
    adminApi.domainCfnResource?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    // jmap-api custom domain
    jmapApi.domainCfnResource?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
    // websocket-push custom domain
    webSocketPush.domainCfnResource?.overrideLogicalId('MailboxwebsocketpushdomainCACDAF3B');
    // auth-key-store DynamoDB table
    (authKeyStore.table.node.defaultChild as cdk.CfnResource).overrideLogicalId('Mailboxauthkeystore8FA0AB27');
    // websocket-push connections DynamoDB table
    (webSocketPush.connectionsTable.node.defaultChild as cdk.CfnResource).overrideLogicalId('Mailboxwebsocketpushwebsocket85CC01CF');

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
