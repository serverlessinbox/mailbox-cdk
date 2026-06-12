import * as fs from 'fs';
import * as path from 'path';
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
import { CertWaiterLambda } from './lambdas';
import { AuditWriting } from './features/audit-writing';
import { createArtifactResolverFromContext } from './artifacts/artifact-context';
import { ArtifactResolver } from './artifacts/artifact-resolver';
import type { IArtifactResolver } from './artifacts/artifact-resolver';
import { Bootstrap } from './features/bootstrap';
import { CertificateWaiter } from './features/certificate-waiter';
import { LicenseRefresh } from './features/license-refresh';
import { MailboxDns, MailboxDomains } from './domains';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { MailboxEdgeDeployer } from './edge';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
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

export interface MailboxOverrides {
  /**
   * Externally-managed MailboxDataStack reference.
   * When omitted, a MailboxDataDeployer custom resource is used.
   */
  readonly dataStack?: MailboxDataStackRef;

  /**
   * ACM certificate overrides. When omitted, certificates are auto-created
   * (requires hostedZone). Supply individual fields to bypass auto-creation
   * for specific endpoints (e.g., manual DNS or cross-account certificate).
   */
  readonly certificates?: {
    /**
     * us-east-1 ACM certificate for CloudFront alternate domain name (cdn.<domain>).
     * Only needed when hostedZone is not provided (manual DNS setup).
     */
    readonly cloudFront?: acm.ICertificate;
    /**
     * us-east-1 ACM certificate for admin.<domain> CloudFront alternate domain name.
     */
    readonly adminUi?: acm.ICertificate;
    /**
     * us-east-1 ACM certificate for webmail.<domain> CloudFront alternate domain name.
     */
    readonly webmailUi?: acm.ICertificate;
    /**
     * Regional ACM certificate for api.<domain> (Admin API custom domain).
     */
    readonly api?: acm.ICertificate;
    /**
     * Regional ACM certificate for jmap.<domain> (JMAP API custom domain).
     */
    readonly jmap?: acm.ICertificate;
    /**
     * Regional ACM certificate for ws.<domain> (WebSocket push custom domain).
     */
    readonly ws?: acm.ICertificate;
  };

  /**
   * Override the subdomain label for any endpoint.
   * Default labels match the property names (e.g. admin → "admin").
   * All labels must be valid single DNS labels (no dots).
   */
  readonly subdomains?: {
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
  };
}

export interface MailboxProps {
  readonly hostedZone?: IHostedZone;
  readonly domainName: string;

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
  readonly enableReceiving?: boolean;

  /**
   * Certificate and data stack overrides.
   */
  readonly overrides?: MailboxOverrides;
}

export interface MailboxOAuthClients {
  readonly adminUi?: AuthClientConfig;
  readonly jmapUi?: AuthClientConfig;
}

function resolveArtifactResolver(scope: Construct): ArtifactResolver {
  const contextValue = scope.node.tryGetContext('artifacts');
  if (contextValue) {
    return createArtifactResolverFromContext(scope);
  }

  const pkgRoot = path.join(__dirname, '..');
  const versionsPath = path.join(pkgRoot, 'artifact-versions.json');
  const pkgJsonPath = path.join(pkgRoot, 'package.json');

  let bakedVersions: Record<string, string>;
  try {
    bakedVersions = JSON.parse(fs.readFileSync(versionsPath, 'utf8')) as Record<string, string>;
  } catch {
    throw new Error(
      `@serverlessinbox/mailbox: artifact-versions.json not found at ${versionsPath}. ` +
      'This file is normally included in the npm package. If you are running from source, ' +
      'set the "artifacts" CDK context key instead.',
    );
  }

  const { version: cdkVersion } = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version: string };

  return new ArtifactResolver(scope, {
    packages: {
      'mailbox-cdk':        { kind: 'release', version: cdkVersion },
      'mailbox-go':         { kind: 'release', version: bakedVersions['mailbox-go'] ?? '0.0.0' },
      'mailbox-admin-ui':   { kind: 'release', version: bakedVersions['mailbox-admin-ui'] ?? '0.0.0' },
      'mailbox-webmail-ui': { kind: 'release', version: bakedVersions['mailbox-webmail-ui'] ?? '0.0.0' },
    },
  });
}

/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  private readonly _blobStore: IBucket;
  private readonly _emailProcessorLambda: EmailProcessorLambda;
  private readonly _configTable: ITable;
  private readonly artifactResolver: IArtifactResolver;
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

  public readonly urls: {
    readonly adminUi: string;
    readonly webmail: string;
    readonly jmapApi: string;
    readonly adminApi: string;
  };

  public readonly data: {
    readonly blobStore: IBucket;
    readonly configTable: ITable;
    readonly itemTable: ITable;
    readonly changelogTable: ITable;
    readonly auditLogTable: ITable;
    readonly mailFeedbackTable: ITable;
  };

  public readonly certificates: {
    readonly edge?: acm.ICertificate;
    readonly regional?: acm.ICertificate;
  };

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
    const artifactResolverForTags = resolveArtifactResolver(this);
    const mailboxCdkTarget = artifactResolverForTags.packages?.['mailbox-cdk'];
    const stackVersion = mailboxCdkTarget
      ? (mailboxCdkTarget.kind === 'release' ? mailboxCdkTarget.version : mailboxCdkTarget.kind === 'channel' ? `channel:${mailboxCdkTarget.channel}` : `track:${mailboxCdkTarget.track}`)
      : 'unknown';

    applyServerlessInboxBaseTags(this, {
      deployment: Aws.STACK_NAME,
      version: stackVersion,
      deployer,
      product: 'mailbox',
    });

    const enableAdminUi = props.enableAdminUi ?? true;
    const enableWebmailUi = props.enableWebmailUi ?? true;

    const mailboxDomains = new MailboxDomains({ domainName: props.domainName, prefix: props.subdomainNamespace, subdomainOverrides: props.overrides?.subdomains });

    this.urls = {
      adminUi:  `https://${mailboxDomains.admin}`,
      webmail:  `https://${mailboxDomains.webmail}`,
      jmapApi:  `https://${mailboxDomains.jmap}`,
      adminApi: `https://${mailboxDomains.api}`,
    };

    this.artifactResolver = artifactResolverForTags;
    const artifactResolver = this.artifactResolver;

    // Configuration constants

    const encryptionPlan = resolveMailboxEncryptionPlan(this, props.kms);
    this.emailQueueProps = encryptionPlan.queues;

    // Resolve retained data resources (from auto-deployed data stack or externally-managed ref)
    const dataRef = props.overrides?.dataStack ?? new MailboxDataDeployer(this, 'data-deployer', { artifactResolver });

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

    const auditWriting = new AuditWriting(this, 'audit-writing', {
      auditLogTable: dataRef.auditLogTable,
      artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    applyServerlessInboxComponentTag(auditWriting, 'api');

    // Auth key store - writes to DynamoDB for Lambda@Edge
    const authKeyStore = new AuthKeyStore(this, 'auth-key-store', {
      issuers: [authProvider.issuer],
      artifactResolver,
    });
    applyServerlessInboxComponentTag(authKeyStore, 'auth');

    const edgeStack = new MailboxEdgeDeployer(this, 'stack-deployer', {
      domainName: props.domainName,
      artifactResolver: artifactResolver,
      prefix: mailboxDomains.prefix,
      hostedZoneId: props.hostedZone?.hostedZoneId,
      hostedZoneName: props.hostedZone?.zoneName,
      itemTableArn: dataRef.itemTable.tableArn,
      configTableArn: dataRef.configTable.tableArn,
      authKeyStoreTableArn: authKeyStore.table.tableArn,
      productVersion: stackVersion,
      deployer,
    });
    applyServerlessInboxComponentTag(edgeStack, 'edge');

    const edgeCertificate = edgeStack.edgeCertificate;

    const hasHostedZone = Boolean(props.hostedZone?.hostedZoneId && props.hostedZone?.zoneName);
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
    if (hasHostedZone && (!providedApiCertificate || !providedJmapCertificate)) {
      const cfnCert = new acm.CfnCertificate(this, 'regional-api-certificate', {
        domainName: mailboxDomains.api,
        subjectAlternativeNames: [mailboxDomains.jmap, mailboxDomains.ws, `mcp.${props.domainName}`],
        validationMethod: 'DNS',
        domainValidationOptions: [
          { domainName: mailboxDomains.api, hostedZoneId: props.hostedZone!.hostedZoneId },
          { domainName: mailboxDomains.jmap, hostedZoneId: props.hostedZone!.hostedZoneId },
          { domainName: mailboxDomains.ws, hostedZoneId: props.hostedZone!.hostedZoneId },
          { domainName: `mcp.${props.domainName}`, hostedZoneId: props.hostedZone!.hostedZoneId },
        ],
      });
      regionalSanCertificate = acm.Certificate.fromCertificateArn(this, 'regional-api-certificate-ref', cfnCert.ref);
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

      const adminUi = new AdminUi(this, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.overrides?.certificates?.adminUi ?? defaultUiCertificate,
        configTable: this._configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        uiConfig: Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined,
      });
      applyServerlessInboxComponentTag(adminUi, 'ui');

      this.adminUiBucket = adminUi.bucket;
      this.adminUiDistribution = adminUi.distribution;

      (this.oauthClients as { adminUi?: AuthClientConfig }).adminUi = adminUi.oauthClient;
      adminUiRedirectUri = adminUi.oauthRedirectUri;

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;
    }

    if (enableWebmailUi) {
      const webmailUi = new WebmailUi(this, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.overrides?.certificates?.webmailUi ?? defaultUiCertificate,
        configTable: this._configTable,
        auditEventsQueue: auditWriting.auditEventsQueue,
        authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
        uiBundle: { packageName: 'mailbox-webmail-ui', objectPath: 'webmail-ui.zip' },
      });
      applyServerlessInboxComponentTag(webmailUi, 'ui');

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

    new LicenseRefresh(this, 'license-refresh', {
      configTable: dataRef.configTable,
      artifactResolver,
    });

    // Lambda function to process incoming emails
    this._emailProcessorLambda = new EmailProcessorLambda(this, 'email-processor-lambda', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      blobStore: this._blobStore,
      artifactResolver,
    });
    applyServerlessInboxComponentTag(this._emailProcessorLambda, 'email');

    const sesRules = new SesRules(this, 'ses-rules', {
      delivery: {
        blobStore: this._blobStore,
        emailProcessor: this._emailProcessorLambda,
        bucketPrefix: 'incoming-emails/',
        artifactResolver,
        queueProps: this.emailQueueProps,
      },
    });
    applyServerlessInboxComponentTag(sesRules, 'email');

    const bootstrap = new Bootstrap(this, 'bootstrap', {
      domain: props.domainName,
      oidcIssuer: authProvider.issuer,
      configTable: dataRef.configTable,
      jwkCacheTable: authKeyStore.table,
      authKeyStoreTable: authKeyStore.table,
      artifactResolver,
      sesRuleSetName: props.enableReceiving ? sesRules.ruleSetName : undefined,

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
              redirectUri: adminUiRedirectUri ?? '/dashboard',
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
    applyServerlessInboxComponentTag(bootstrap, 'auth');

    // If a regional SAN cert was auto-created, insert a waiter custom resource.
    // On deletion, the waiter polls ACM DescribeCertificate until InUseBy is empty,
    // preventing the "Certificate is in use" CloudFormation error.
    let certWaiter: CertificateWaiter | undefined;
    if (regionalSanCertificate) {
      const certWaiterLambda = new CertWaiterLambda(this, 'cert-waiter-lambda', {
        artifactResolver,
      });
      certWaiter = new CertificateWaiter(this, 'regional-cert-waiter', {
        certificate: regionalSanCertificate,
        certWaiterLambda,
      });
    }

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(this, 'blob-cdn', {
      blobStore: this._blobStore,
      configTable: dataRef.configTable,
      authKeyStoreTable: authKeyStore.table,
      userPoolIssuer: authProvider.issuer,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      blobAuthorizerVersion: edgeStack.blobAuthorizerVersion,
      domainName: useCustomCdnDomain ? mailboxDomains.cdn : undefined,
      certificate: hasHostedZone ? edgeCertificate : props.overrides?.certificates?.cloudFront,
    });
    applyServerlessInboxComponentTag(cdnConstruct, 'edge');

    // DNS is created later, once all endpoint targets are known.

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    const tantivySearch = new TantivySearch(this, 'tantivy-search', {
      indexBucket: this._blobStore,
      itemTable: dataRef.itemTable,
      configTable: dataRef.configTable,
      changelogTable: dataRef.changelogTable,
      artifactResolver: artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    applyServerlessInboxComponentTag(tantivySearch, 'search');

    // SES event processing infrastructure (SNS, SQS, Lambda)
    const sesEventProcessing = new SESEventProcessing(this, 'ses-event-processing', {
      itemTable: dataRef.itemTable,
      mailFeedbackTable: dataRef.mailFeedbackTable,
      changelogTable: dataRef.changelogTable,
      configTable: dataRef.configTable,
      blobStore: this._blobStore,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      queueProps: encryptionPlan.queues,
    });
    applyServerlessInboxComponentTag(sesEventProcessing, 'email');


    // Email sending infrastructure (SQS, Lambda) - must be before API
    const emailSending = new EmailSending(this, 'email-sending', {
      configTable: dataRef.configTable,
      itemTable: dataRef.itemTable,
      changelogTable: dataRef.changelogTable,
      blobStore: this._blobStore,
      artifactResolver: artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
      queueProps: encryptionPlan.queues,
    });
    applyServerlessInboxComponentTag(emailSending, 'email');

    // JMAP must always advertise the JMAP_UI OAuth client in its session response.
    // That client is provisioned when the Webmail UI is enabled.
    const jmapOAuthClientId = this.oauthClients.jmapUi?.clientId;
    if (!jmapOAuthClientId) {
      throw new Error(
        'JMAP API requires the JMAP_UI OAuth client (for session OAuth2 metadata). ' +
        'Enable the Webmail UI, or adjust the auth provider to provision JMAP_UI independently.',
      );
    }

    this._jmapApi = new JMapApi(this, 'jmap-api', {
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

      oauthClientId: jmapOAuthClientId,

      domainName: jmapCertificate ? mailboxDomains.jmap : undefined,
      certificate: jmapCertificate,

      // WebSocket URL will be passed via environment variable, not here
    });
    const jmapApi = this._jmapApi;
    applyServerlessInboxComponentTag(jmapApi, 'api');

    // WebSocket Push infrastructure - must be after API to reuse authorizer
    const webSocketPush = new WebSocketPush(this, 'websocket-push', {
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
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');

    const adminApiAddons: IAdminApiAddon[] = (() => {
      if (typeof authProvider.createAdminApiAddons !== 'function') return [];

      const ctx: AdminApiAddonContext = {
        artifactResolver,
        auditEventsQueue: auditWriting.auditEventsQueue,
      };

      return authProvider.createAdminApiAddons(this, ctx);
    })();

    const adminApi = new AdminApi(this, 'admin-api', {
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

      addons: adminApiAddons,

      domainName: apiCertificate ? mailboxDomains.api : undefined,
      certificate: apiCertificate,
    });
    applyServerlessInboxComponentTag(adminApi, 'api');

    const mcpApi = props.enableMcp ? new McpApi(this, 'mcp-api', {
      configTable: this._configTable,
      jmapApiGateway: this._jmapApi.httpApi,
      authorizerLambda: this._jmapApi.authorizerLambda,
      certificate: this.certificates.regional!,
      domainName: props.domainName,
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

    if (hasHostedZone) {
      new MailboxDns(this, 'dns', {
        names: mailboxDomains,
        hostedZone: props.hostedZone,
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
      applyServerlessInboxComponentTag(this.node.findChild('dns'), 'edge');
    }

  }
}
