import { Construct } from 'constructs';
import { ILambdaCodeProvider } from './utils/lambda-code-provider';
import { EmailProcessorLambda } from './lambdas/email-processor';
import { EmailBucket } from './constructs/email-bucket';
import { ConfigTable } from './constructs/config-table';
import { ItemTable } from './constructs/item-table';
import { ChangelogTable } from './constructs/changelog-table';
import { JwkDynamoCache } from './modules/jwk-dynamo-cache';
import { Cdn } from './modules/cdn-construct';
import { TantivySearch } from './modules/tantivy-search';
import { PrecompiledS3LambdaCodeProvider } from './utils/precompiled-s3-code-provider';
import { EmailSending } from './modules/email-sending';
import { IOAuthHandler, JMapApi } from './modules/api';
import { WebSocketPush } from './modules/websocket';

const precompiledS3Bucket = 'my-precompiled-lambda-bucket';
const precompiledS3KeyPrefix = 'lambdas/v1.0.0/';

export interface MailboxProps {
  codeProvider?: ILambdaCodeProvider;
  oauthHandler: IOAuthHandler;
}

/**
 * Main Mailbox construct
 */
export class Mailbox extends Construct {
  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);

    const oauthConfig = props.oauthHandler.getOAuthConfig();
    const codeProvider = props.codeProvider ?? new PrecompiledS3LambdaCodeProvider({
      s3Bucket: precompiledS3Bucket,
      s3KeyPrefix: precompiledS3KeyPrefix,
    });

    // Configuration constants
    const DEFAULT_DOMAIN = 'dev.jvdwaal.nl';
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:4321'];
    const WEBSOCKET_CAPABILITY_DOMAIN = this.node.tryGetContext('websocketCapabilityDomain') || 'https://jmap.jvdwaal.nl/api/ext/websocket-push';

    // S3 bucket for storing incoming emails (also used for Tantivy indexes)
    const emailBucket = new EmailBucket(this);

    const configTable = new ConfigTable(this);
    const itemTable = new ItemTable(this);
    const changelogTable = new ChangelogTable(this);

    // Lambda function to process incoming emails
    const emailProcessorLambda = new EmailProcessorLambda(this, 'email-processor-lambda', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: emailBucket,
      codeProvider: codeProvider,
    });

    // new SesRules(this, 'email-rules', {
    //   emailBucket,
    //   emailProcessor: emailProcessorLambda
    // })

    // JWK cache updater - writes to DynamoDB for Lambda@Edge
    const jwkCache = new JwkDynamoCache(this, 'jwk-cache', {
      issuers: [oauthConfig.issuer],
      codeProvider: props.codeProvider!,
    });

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(this, 'blob-cdn', {
      emailBucket,
      itemTable,
      configTable,
      jwkCacheTable: jwkCache.table,
      userPoolIssuer: oauthConfig.issuer,
      allowedOrigins: ALLOWED_ORIGINS,
    });

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    const _tantivySearch = new TantivySearch(this, 'tantivy-search', {
      indexBucket: emailBucket,
      itemTable: itemTable,
      configTable: configTable,
      changelogTable: changelogTable,
      codeProvider: codeProvider,
    });

    // Email sending infrastructure (SQS, SNS, Lambda) - must be before API
    const emailSending = new EmailSending(this, 'email-sending', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      emailBucket: emailBucket,
      codeProvider: codeProvider,
    });

    const api = new JMapApi(this, 'admin-api', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      defaultDomain: DEFAULT_DOMAIN,
      oauthHandler: props.oauthHandler,
      jwkCacheTable: jwkCache.table,
      cdnHost: cdnConstruct.host,
      allowedOrigins: ALLOWED_ORIGINS,
      emailBucket: emailBucket,
      emailSubmissionQueue: emailSending.submissionQueue,
      codeProvider: codeProvider,
      // WebSocket URL will be passed via environment variable, not here
    });

    // WebSocket Push infrastructure - must be after API to reuse authorizer
    const webSocketPush = new WebSocketPush(this, 'websocket-push', {
      configTable: configTable,
      itemTable: itemTable,
      changelogTable: changelogTable,
      userPoolIssuer: oauthConfig.issuer,
      jwkCacheTable: jwkCache.table,
      capabilityDomain: WEBSOCKET_CAPABILITY_DOMAIN,
      authorizerLambda: api.authorizerLambda, // Reuse HTTP API authorizer
      codeProvider: codeProvider,
      maxSubscriptions: 10,
      maxPingInterval: 300,
      minPingInterval: 30,
    });

    // Add WebSocket URL to API handler environment
    api.apiHandlerLambda.addEnvironment('WEBSOCKET_URL', webSocketPush.webSocketUrl);
    api.apiHandlerLambda.addEnvironment('WEBSOCKET_CAPABILITY_DOMAIN', WEBSOCKET_CAPABILITY_DOMAIN);

  }
}
