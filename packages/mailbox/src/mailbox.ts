import { Construct } from 'constructs';
import {
  AuditLogTable,
  ChangelogTable,
  ConfigTable,
  EmailBucket,
  ItemTable,
  MailFeedbackTable,
} from './resources';
import { JwkDynamoCache } from './features/jwk-dynamo-cache';
import { Cdn } from './features/cdn-construct';
import { TantivySearch } from './search';
import { EmailSending, SESEventProcessing } from './email';
import { AdminApi, JMapApi, WebSocketPush } from './api';
import type { AdminApiAddon, AdminApiAddonContext } from './api';
import type { EmailDelivery } from './email/receiving/ses-rules';
import {
  AuthClientConfig,
  AuthConfig,
  OAUTH_CLIENT_ADMIN_HEADLESS,
  OAUTH_CLIENT_JMAP_HEADLESS,
} from './auth/types';
import type { MailboxAuthProvider } from './auth/types';
import { Permission } from './auth/jmap-scopes';
import { EmailProcessorLambda } from './lambdas/email-processor';
import { AuditWriting } from './features/audit-writing';
import { createArtifactResolverFromContext } from './artifacts/artifact-context';
import { BootstrapTenant } from './features/bootstrap-tenant';
import { MailboxDns, MailboxDomains } from './domains';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { MailboxEdgeDeployer } from './edge';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { AdminUi } from './ui/admin-ui';
import { WebmailUi } from './ui/webmail-ui';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import { Aws } from 'aws-cdk-lib';
import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  type ServerlessInboxDeployer,
} from './utils/serverless-inbox-tags';

export interface MailboxProps {
  hostedZone?: IHostedZone;
  domainName: string;

  /** Preferred: provider-owned construct implementing mailbox auth configuration (+ optional admin addons). */
  authProvider?: MailboxAuthProvider;

  /** Legacy: raw auth config object (no addons). Prefer `authProvider`. */
  authConfig?: AuthConfig;

  /** Optional deployer label used for tagging (default: 'cfn'). */
  deployer?: ServerlessInboxDeployer;

  /** Optional extra tags applied to all taggable resources in this construct. */
  extraTags?: Record<string, string>;

  /** Extra origins to allow for CORS (e.g., local dev). UI origins are derived automatically. */
  extraAllowedOrigins?: string[];

  /** Optional us-east-1 ACM certificate for CloudFront alternate domain names (e.g., cdn.<domain>). */
  cloudFrontCertificate?: acm.ICertificate;

  /**
   * Whether to create the Admin UI (CloudFront + token-exchange API + OAuth client bootstrap).
   * Defaults to true.
   */
  createAdminUi?: boolean;

  /**
   * Whether to create the Webmail UI (CloudFront + token-exchange API + OAuth client bootstrap).
   * Defaults to true.
   */
  createWebmailUi?: boolean;

  /**
   * Whether to create headless (client_credentials) OAuth clients for machine-to-machine usage.
   * Defaults to false.
   */
  createHeadlessClients?: boolean;

  /** Optional us-east-1 ACM certificate for admin.<domain> CloudFront alternate domain name. */
  adminUiCertificate?: acm.ICertificate;

  /** Optional us-east-1 ACM certificate for webmail.<domain> CloudFront alternate domain name. */
  webmailUiCertificate?: acm.ICertificate;

  /** Optional regional ACM certificate for api.<domain> (Admin API custom domain). */
  apiCertificate?: acm.ICertificate;

  /** Optional regional ACM certificate for jmap.<domain> (JMAP API custom domain). */
  jmapCertificate?: acm.ICertificate;
}

/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  public readonly emailBucket: EmailBucket;
  public readonly emailProcessorLambda: EmailProcessorLambda;
  public readonly configTable: ConfigTable;
  public readonly cdn: Cdn;

  /** Admin UI resources (when `createAdminUi !== false`). */
  public readonly adminUiBucket?: IBucket;
  public readonly adminUiDistribution?: IDistribution;

  /** Webmail UI resources (when `createWebmailUi !== false`). */
  public readonly webmailUiBucket?: IBucket;
  public readonly webmailUiDistribution?: IDistribution;

  public readonly edgeCertificate?: acm.ICertificate;

  /** OAuth clients created by this construct (only when enabled). */
  public readonly oauthClients: {
    adminUi?: AuthClientConfig;
    jmapUi?: AuthClientConfig;
    adminHeadless?: AuthClientConfig;
    jmapHeadless?: AuthClientConfig;
  } = {};

  emailDelivery(): EmailDelivery {
    return {
      emailBucket: this.emailBucket,
      emailProcessor: this.emailProcessorLambda,
      bucketPrefix: 'incoming-emails/',
    }
  }

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const authProvider: MailboxAuthProvider = (props.authProvider ?? props.authConfig) as MailboxAuthProvider;

    if (!authProvider) {
      throw new Error('Mailbox: either authProvider or authConfig must be provided');
    }

    const deployer = props.deployer ?? 'cfn';

    // Tag everything under this construct so customers can easily slice cost/usage.
    // Use AWS::StackName so this also works when deployed via pure CloudFormation.
    const artifactResolverForTags = createArtifactResolverFromContext(this);
    const mailboxCdkTarget = artifactResolverForTags.packages?.['mailbox-cdk'];
    const stackVersion = mailboxCdkTarget
      ? (mailboxCdkTarget.kind === 'release' ? mailboxCdkTarget.version : `channel:${mailboxCdkTarget.channel}`)
      : 'unknown';

    applyServerlessInboxBaseTags(this, {
      deployment: Aws.STACK_NAME,
      version: stackVersion,
      deployer,
      extraTags: props.extraTags,
      product: 'mailbox',
    });

    const createAdminUi = props.createAdminUi ?? true;
    const createWebmailUi = props.createWebmailUi ?? true;
    const createHeadlessClients = props.createHeadlessClients ?? false;

    const mailboxDomains = new MailboxDomains({ domainName: props.domainName });

    const artifactResolver = artifactResolverForTags;

    // Configuration constants

    // S3 bucket for storing incoming emails (also used for Tantivy indexes)
    this.emailBucket = new EmailBucket(this);
    applyServerlessInboxComponentTag(this.emailBucket, 'email');

    const configTable = new ConfigTable(this);
    this.configTable = configTable;
    applyServerlessInboxComponentTag(configTable, 'storage');
    const itemTable = new ItemTable(this);
    applyServerlessInboxComponentTag(itemTable, 'storage');
    const changelogTable = new ChangelogTable(this);
    applyServerlessInboxComponentTag(changelogTable, 'storage');
    const auditLogTable = new AuditLogTable(this);
    applyServerlessInboxComponentTag(auditLogTable, 'storage');
    const mailFeedbackTable = new MailFeedbackTable(this);
    applyServerlessInboxComponentTag(mailFeedbackTable, 'storage');

    // JWK cache updater - writes to DynamoDB for Lambda@Edge
    const jwkCache = new JwkDynamoCache(this, 'jwk-cache', {
      issuers: [authProvider.issuer],
      artifactResolver,
    });
    applyServerlessInboxComponentTag(jwkCache, 'auth');

    const edgeStack = new MailboxEdgeDeployer(this, 'edge-deployer', {
      domainName: props.domainName,
      artifactResolver: artifactResolver,
      prefix: mailboxDomains.prefix,
      hostedZoneId: props.hostedZone?.hostedZoneId,
      hostedZoneName: props.hostedZone?.zoneName,
      itemTableArn: itemTable.tableArn,
      configTableArn: configTable.tableArn,
      jwkCacheTableArn: jwkCache.table.tableArn,
      productVersion: stackVersion,
      deployer,
    });
    applyServerlessInboxComponentTag(edgeStack, 'edge');

    this.edgeCertificate = edgeStack.edgeCertificate;

    const hasHostedZone = Boolean(props.hostedZone?.hostedZoneId && props.hostedZone?.zoneName);
    const useCustomCdnDomain = Boolean(props.cloudFrontCertificate || hasHostedZone);

    const defaultUiCertificate = hasHostedZone ? edgeStack.edgeCertificate : undefined;
    if (hasHostedZone && !defaultUiCertificate) {
      throw new Error('hostedZone was provided but edge certificate was not created');
    }

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    // Prefer a single SAN certificate for both api.<domain> and jmap.<domain> when *neither* is provided.
    // If only one is provided, we still auto-create a certificate for the missing hostname so the API works.
    const providedApiCertificate = props.apiCertificate;
    const providedJmapCertificate = props.jmapCertificate;

    // If either API certificate is missing and we have Route53, create a single SAN cert
    // that covers both names and use it to fill the gaps.
    const regionalSanCertificate = (hasHostedZone && (!providedApiCertificate || !providedJmapCertificate))
      ? new acm.Certificate(this, 'regional-api-certificate', {
        domainName: mailboxDomains.api,
        subjectAlternativeNames: [mailboxDomains.jmap],
        validation: acm.CertificateValidation.fromDns(props.hostedZone!),
      })
      : undefined;

    const apiCertificate = providedApiCertificate
      ?? regionalSanCertificate;

    const jmapCertificate = providedJmapCertificate
      ?? regionalSanCertificate;

    const allPermissions = Object.values(Permission);

    if (createHeadlessClients) {
      this.oauthClients.adminHeadless = authProvider.generateClient({
        flow: 'client_credentials',
        name: OAUTH_CLIENT_ADMIN_HEADLESS,
        permissions: [],
      });

      this.oauthClients.jmapHeadless = authProvider.generateClient({
        flow: 'client_credentials',
        name: OAUTH_CLIENT_JMAP_HEADLESS,
        permissions: allPermissions,
      });
    }

    const adminUiOrigins: string[] = [];
    const webmailUiOrigins: string[] = [];

    let adminUiRedirectUri: string | undefined;
    let webmailUiRedirectUri: string | undefined;

    let adminUiCnameTarget: string | undefined;
    let webmailUiCnameTarget: string | undefined;

    if (createAdminUi) {
      const providerAdminUiConfig = authProvider.getAdminUiConfig?.();

      const adminUi = new AdminUi(this, 'admin-ui', {
        domainName: mailboxDomains.admin,
        certificate: props.adminUiCertificate ?? defaultUiCertificate,
        configTable: this.configTable,
        authConfig: authProvider,
        apiUrl: apiCertificate ? `https://${mailboxDomains.api}` : undefined,
        uiConfig: providerAdminUiConfig,
      });
      applyServerlessInboxComponentTag(adminUi, 'ui');

      this.adminUiBucket = adminUi.bucket;
      this.adminUiDistribution = adminUi.distribution;

      this.oauthClients.adminUi = adminUi.oauthClient;
      adminUiRedirectUri = adminUi.oauthRedirectUri;

      adminUiOrigins.push(`https://${adminUi.distributionDomainName}`);
      adminUiCnameTarget = adminUi.distribution.distributionDomainName;
    }

    if (createWebmailUi) {
      const webmailUi = new WebmailUi(this, 'webmail-ui', {
        domainName: mailboxDomains.webmail,
        certificate: props.webmailUiCertificate ?? defaultUiCertificate,
        configTable: this.configTable,
        authConfig: authProvider,
        apiUrl: jmapCertificate ? `https://${mailboxDomains.jmap}` : undefined,
      });
      applyServerlessInboxComponentTag(webmailUi, 'ui');

      this.webmailUiBucket = webmailUi.bucket;
      this.webmailUiDistribution = webmailUi.distribution;

      this.oauthClients.jmapUi = webmailUi.oauthClient;
      webmailUiRedirectUri = webmailUi.oauthRedirectUri;

      webmailUiOrigins.push(`https://${webmailUi.distributionDomainName}`);
      webmailUiCnameTarget = webmailUi.distribution.distributionDomainName;
    }

    const extraOrigins = props.extraAllowedOrigins ?? [];
    const allowedOriginsForAdminApi = [...adminUiOrigins, ...extraOrigins];
    const allowedOriginsForJmapApi = [...webmailUiOrigins, ...extraOrigins];
    const allowedOriginsForCdn = [...adminUiOrigins, ...webmailUiOrigins, ...extraOrigins];

    const adminRequiredGroup = this.oauthClients.adminUi?.groups?.[0]
      ?? this.oauthClients.adminHeadless?.groups?.[0];

    new BootstrapTenant(this, 'bootstrap-tenant', {
      domain: props.domainName,
      oidcIssuer: authProvider.issuer,
      configTable: configTable,
      artifactResolver,

      oidcProvider: {
        tokenEndpoint: authProvider.tokenEndpoint,
        authorizationEndpoint: authProvider.authorizationEndpoint,
        authMethod: authProvider.authMethod,
        usePkce: authProvider.usePkce,
      },
      authPolicies: {
        adminApi: {
          audiences: authProvider.clientIds,
          requiredGroup: adminRequiredGroup,
        },
        jmapApi: {
          audiences: authProvider.clientIds,
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
    applyServerlessInboxComponentTag(this.node.findChild('bootstrap-tenant'), 'auth');

    const auditWriting = new AuditWriting(this, 'audit-writing', {
      auditLogTable,
      artifactResolver,
    });
    applyServerlessInboxComponentTag(auditWriting, 'api');

    // Lambda function to process incoming emails
    this.emailProcessorLambda = new EmailProcessorLambda(this, 'email-processor-lambda', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: this.emailBucket,
      artifactResolver,
    });
    applyServerlessInboxComponentTag(this.emailProcessorLambda, 'email');

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(this, 'blob-cdn', {
      emailBucket: this.emailBucket,
      itemTable,
      configTable,
      jwkCacheTable: jwkCache.table,
      userPoolIssuer: authProvider.issuer,
      allowedOrigins: allowedOriginsForCdn.length > 0 ? allowedOriginsForCdn : undefined,
      blobAuthorizerVersion: edgeStack.blobAuthorizerVersion,
      domainName: useCustomCdnDomain ? mailboxDomains.cdn : undefined,
      certificate: hasHostedZone ? edgeStack.edgeCertificate : props.cloudFrontCertificate,
    });
    applyServerlessInboxComponentTag(cdnConstruct, 'edge');

    this.cdn = cdnConstruct;

    // DNS is created later, once all endpoint targets are known.

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    new TantivySearch(this, 'tantivy-search', {
      indexBucket: this.emailBucket,
      itemTable: itemTable,
      configTable: configTable,
      changelogTable: changelogTable,
      artifactResolver: artifactResolver,
    });
    applyServerlessInboxComponentTag(this.node.findChild('tantivy-search'), 'search');

    // SES event processing infrastructure (SNS, SQS, Lambda)
    const sesEventProcessing = new SESEventProcessing(this, 'ses-event-processing', {
      itemTable: itemTable,
      mailFeedbackTable: mailFeedbackTable,
      changelogTable: changelogTable,
      configTable: configTable,
      emailBucket: this.emailBucket,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
    });
    applyServerlessInboxComponentTag(sesEventProcessing, 'email');


    // Email sending infrastructure (SQS, Lambda) - must be before API
    const emailSending = new EmailSending(this, 'email-sending', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: this.emailBucket,
      artifactResolver: artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
    });
    applyServerlessInboxComponentTag(emailSending, 'email');

    const jmapApi = new JMapApi(this, 'jmap-api', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      jwkCacheTable: jwkCache.table,
      cdnHost: cdnConstruct.host,
      allowedOrigins: allowedOriginsForJmapApi.length > 0 ? allowedOriginsForJmapApi : undefined,
      emailBucket: this.emailBucket,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      authConfig: authProvider,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,

      domainName: jmapCertificate ? mailboxDomains.jmap : undefined,
      certificate: jmapCertificate,

      // WebSocket URL will be passed via environment variable, not here
    });
    applyServerlessInboxComponentTag(jmapApi, 'api');

    // WebSocket Push infrastructure - must be after API to reuse authorizer
    const webSocketPush = new WebSocketPush(this, 'websocket-push', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      jwkCacheTable: jwkCache.table,
      authorizerLambda: jmapApi.authorizerLambda, // Reuse HTTP API authorizer
      artifactResolver: artifactResolver,
      maxSubscriptions: 10,
      maxPingInterval: 300,
      minPingInterval: 30,
    });
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');

    const adminApiAddons: AdminApiAddon[] = (() => {
      if (typeof authProvider.createAdminApiAddons !== 'function') return [];

      const ctx: AdminApiAddonContext = {
        artifactResolver,
        auditEventsQueue: auditWriting.auditEventsQueue,
      };

      return authProvider.createAdminApiAddons(this, ctx);
    })();

    const adminApi = new AdminApi(this, 'admin-api', {
      configTable: configTable,
      itemTable: itemTable,
      auditLogTable: auditLogTable,
      changelogTable: changelogTable,
      mailFeedbackTable: mailFeedbackTable,
      jwkCacheTable: jwkCache.table,
      emailBucket: this.emailBucket,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      allowedOrigins: allowedOriginsForAdminApi.length > 0 ? allowedOriginsForAdminApi : undefined,
      artifactResolver: artifactResolver,
      authConfig: authProvider,

      addons: adminApiAddons,

      domainName: apiCertificate ? mailboxDomains.api : undefined,
      certificate: apiCertificate,
    });
    applyServerlessInboxComponentTag(adminApi, 'api');

    // Add WebSocket URL to API handler environment
    jmapApi.apiHandlerLambda.addEnvironment('WEBSOCKET_URL', webSocketPush.webSocketUrl);

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
        },
      });
      applyServerlessInboxComponentTag(this.node.findChild('dns'), 'edge');
    }

  }
}
