import { Construct } from 'constructs';
import { EmailBucket } from './constructs/email-bucket';
import { ConfigTable } from './constructs/config-table';
import { ItemTable } from './constructs/item-table';
import { ChangelogTable } from './constructs/changelog-table';
import { JwkDynamoCache } from './modules/jwk-dynamo-cache';
import { Cdn } from './modules/cdn-construct';
import { TantivySearch } from './modules/tantivy-search';
import { EmailSending } from './modules/email-sending';
import { SESEventProcessing } from './modules/ses-event-processing';
import { JMapApi } from './modules/jmap-api';
import { WebSocketPush } from './modules/websocket';
import { EmailDelivery } from './email-processing/ses-rule';
import { AdminApi } from './modules/admin-api';
import { IAuthConfig } from './auth/IAuthConfig';
import { EmailProcessorLambda } from './lambdas/email-processor';
import { AuditLogTable } from './constructs/auditlog-table';
import { MailFeedbackTable } from './constructs/mailfeedback-table';
import { AuditWriting } from './modules/audit-writing';
import { createArtifactResolverFromContext } from './utils/artifact-context';
import { BootstrapTenant } from './modules/bootstrap-tenant';
import { IAuthClientConfig } from './auth/IAuthConfig';
import { MailboxDomains } from './domains';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { MailboxEdgeDeployer } from './edge';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';

export interface MailboxProps {
  hostedZone?: IHostedZone;
  domainName: string;
  authConfig: IAuthConfig;
  allowedOrigins: string[];

  /** Optional us-east-1 ACM certificate for CloudFront alternate domain names (e.g., cdn.<domain>). */
  cloudFrontCertificate?: acm.ICertificate;

  /**
   * OAuth client config for the Admin UI token exchange flow.
   * Required: token-exchange reads OAUTH_CLIENT#ADMIN_UI from the config table.
   */
  adminUiOAuthClient: IAuthClientConfig;

  /**
   * Optional token exchange audience parameter (provider-specific).
   */
  tokenExchangeAudience?: string;
}

/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  public readonly emailBucket: EmailBucket;
  public readonly emailProcessorLambda: EmailProcessorLambda;
  public readonly configTable: ConfigTable;
  public readonly cdn: Cdn;

  public readonly edgeCertificate?: acm.ICertificate;

  emailDelivery(): EmailDelivery {
    return {
      emailBucket: this.emailBucket,
      emailProcessor: this.emailProcessorLambda,
      bucketPrefix: 'incoming-emails/',
    }
  }

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const mailboxDomains = new MailboxDomains({ domainName: props.domainName });

    const artifactResolver = createArtifactResolverFromContext(this);

    // Configuration constants

    // S3 bucket for storing incoming emails (also used for Tantivy indexes)
    this.emailBucket = new EmailBucket(this);

    const configTable = new ConfigTable(this);
    this.configTable = configTable;
    const itemTable = new ItemTable(this);
    const changelogTable = new ChangelogTable(this);
    const auditLogTable = new AuditLogTable(this);
    const mailFeedbackTable = new MailFeedbackTable(this);

    // JWK cache updater - writes to DynamoDB for Lambda@Edge
    const jwkCache = new JwkDynamoCache(this, 'jwk-cache', {
      issuers: [props.authConfig.issuer],
      artifactResolver,
    });

    const edgeStack = new MailboxEdgeDeployer(this, 'edge-deployer', {
      domainName: props.domainName,
      artifactResolver: artifactResolver,
      prefix: mailboxDomains.prefix,
      hostedZoneId: props.hostedZone?.hostedZoneId,
      hostedZoneName: props.hostedZone?.zoneName,
      itemTableArn: itemTable.tableArn,
      configTableArn: configTable.tableArn,
      jwkCacheTableArn: jwkCache.table.tableArn,
    });

    this.edgeCertificate = edgeStack.edgeCertificate;

    const hasHostedZone = Boolean(props.hostedZone?.hostedZoneId && props.hostedZone?.zoneName);
    const useCustomCdnDomain = Boolean(props.cloudFrontCertificate || hasHostedZone);

    new BootstrapTenant(this, 'bootstrap-tenant', {
      domain: props.domainName,
      oidcIssuer: props.authConfig.issuer,
      configTable: configTable,
      artifactResolver,

      oidcProvider: {
        tokenEndpoint: props.authConfig.tokenEndpoint,
        authorizationEndpoint: props.authConfig.authorizationEndpoint,
        authMethod: props.authConfig.authMethod,
        usePkce: props.authConfig.usePkce,
      },
      authPolicies: {
        adminApi: {
          audiences: props.authConfig.clientIds,
          requiredGroup: 'admin',
        },
        jmapApi: {
          audiences: props.authConfig.clientIds,
        },
      },
      oauthClients: {
        adminUi: {
          requestedAudience: props.tokenExchangeAudience,
          clientId: props.adminUiOAuthClient.clientId,
          clientSecret: props.adminUiOAuthClient.clientSecret,
          scopes: ['openid', 'email', 'profile', ...props.adminUiOAuthClient.requestScopeList],
          redirectUri: '/dashboard',
        },
      },
    });

    const auditWriting = new AuditWriting(this, 'audit-writing', {
      auditLogTable,
      artifactResolver,
    });

    // Lambda function to process incoming emails
    this.emailProcessorLambda = new EmailProcessorLambda(this, 'email-processor-lambda', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: this.emailBucket,
      artifactResolver,
    });

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(this, 'blob-cdn', {
      emailBucket: this.emailBucket,
      itemTable,
      configTable,
      jwkCacheTable: jwkCache.table,
      userPoolIssuer: props.authConfig.issuer,
      allowedOrigins: props.allowedOrigins,
      blobAuthorizerVersion: edgeStack.blobAuthorizerVersion,
      domainName: useCustomCdnDomain ? mailboxDomains.cdn : undefined,
      certificate: hasHostedZone ? edgeStack.edgeCertificate : props.cloudFrontCertificate,
    });

    this.cdn = cdnConstruct;

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    new TantivySearch(this, 'tantivy-search', {
      indexBucket: this.emailBucket,
      itemTable: itemTable,
      configTable: configTable,
      changelogTable: changelogTable,
      artifactResolver: artifactResolver,
    });

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


    // Email sending infrastructure (SQS, Lambda) - must be before API
    const emailSending = new EmailSending(this, 'email-sending', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: this.emailBucket,
      artifactResolver: artifactResolver,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,
    });

    const jmapApi = new JMapApi(this, 'jmap-api', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      jwkCacheTable: jwkCache.table,
      cdnHost: cdnConstruct.host,
      allowedOrigins: props.allowedOrigins,
      emailBucket: this.emailBucket,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      artifactResolver: artifactResolver,
      authConfig: props.authConfig,
      sesConfigSetName: sesEventProcessing.sesConfigSetName,

      // WebSocket URL will be passed via environment variable, not here
    });

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

    new AdminApi(this, 'admin-api', {
      configTable: configTable,
      itemTable: itemTable,
      auditLogTable: auditLogTable,
      changelogTable: changelogTable,
      mailFeedbackTable: mailFeedbackTable,
      emailBucket: this.emailBucket,
      emailSubmissionQueue: emailSending.submissionQueue,
      auditEventsQueue: auditWriting.auditEventsQueue,
      allowedOrigins: props.allowedOrigins,
      artifactResolver: artifactResolver,
      authConfig: props.authConfig,
    });

    // Add WebSocket URL to API handler environment
    jmapApi.apiHandlerLambda.addEnvironment('WEBSOCKET_URL', webSocketPush.webSocketUrl);

  }
}
