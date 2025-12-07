import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SesRules } from './modules/ses-rule';
import { EmailBucket } from './constructs/email-bucket';
import { JMapApi } from './modules/api';
import { EmailSending } from './modules/email-sending';
import { TantivySearch } from './modules/tantivy-search';
import { ConfigTable } from './constructs/config-table';
import { ItemTable } from './constructs/item-table';
import { ChangelogTable } from './constructs/changelog-table';
import { UserPool } from './constructs/user-pool';
import { GoLambda } from './utils/go-lambda';
import { JwkDynamoCache } from './utils/jwk-dynamo-cache';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Cdn } from './cdn/cdn-construct';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { WebSocketPush } from './modules/websocket';
import { ILambdaCodeProvider } from './utils/lambda-code-provider';

export interface MailboxStackProps extends cdk.StackProps {
  codeProvider: ILambdaCodeProvider;
}

export class MailboxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MailboxStackProps) {
    super(scope, id, props);

    const { codeProvider } = props;

    // Configuration constants
    const DEFAULT_DOMAIN = 'dev.jvdwaal.nl';
    const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:4321'];
    const WEBSOCKET_CAPABILITY_DOMAIN = this.node.tryGetContext('websocketCapabilityDomain') || 'https://jmap.jvdwaal.nl/api/ext/websocket-push';

    // S3 bucket for storing incoming emails (also used for Tantivy indexes)
    const emailBucket = new EmailBucket(this);

    const configTable = new ConfigTable(this);
    const itemTable = new ItemTable(this);
    const changelogTable = new ChangelogTable(this);

    // NOTE: Cognito token customizer Lambda removed - users created via IDP claims on first login
    // Token customization no longer needed since we query database for user/account data
    // const tokenCustomizerLambda = GoLambda(this, 'TokenCustomizerLambda', {
    //   handlerName: 'cognito-token-customizer',
    //   timeout: cdk.Duration.seconds(10),
    //   memorySize: 256,
    //   environment: {
    //     CONFIG_TABLE_NAME: configTable.tableName,
    //     DEFAULT_EMAIL_DOMAIN: DEFAULT_DOMAIN,
    //   },
    // });
    // configTable.grantReadData(tokenCustomizerLambda);

    // Cognito User Pool for authentication
    const userPool = new UserPool(this, 'user-pool');

    // Lambda function to process incoming emails
    const emailProcessorLambda = new GoLambda(this, 'EmailProcessorLambda', {
      lambdaId: 'email-processor',
      codeProvider: codeProvider,
      timeout: cdk.Duration.minutes(1),
      memorySize: 1024, // Increased from 512MB for faster cold starts and processing
      environment: {
        EMAIL_BUCKET_NAME: emailBucket.bucketName,
        CONFIG_TABLE_NAME: configTable.tableName,
        ITEM_TABLE_NAME: itemTable.tableName,
        CHANGELOG_TABLE_NAME: changelogTable.tableName,
        DEFAULT_EMAIL_DOMAIN: DEFAULT_DOMAIN,
      },
    });

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    configTable.grantReadWriteData(emailProcessorLambda);
    itemTable.grantReadWriteData(emailProcessorLambda);
    changelogTable.grantReadWriteData(emailProcessorLambda);

    // Grant the Lambda function permissions to read from the S3 bucket
    emailBucket.grantReadWrite(emailProcessorLambda);

    new SesRules(this, 'email-rules', {
      emailBucket,
      emailProcessor: emailProcessorLambda
    })

    // JWK cache updater - writes to DynamoDB for Lambda@Edge
    const jwkCache = new JwkDynamoCache(this, 'jwk-cache', {
      issuers: [userPool.issuer],
      codeProvider: codeProvider,
    });

    // CloudFront CDN for blob downloads with Lambda@Edge
    const cdnConstruct = new Cdn(this, 'blob-cdn', {
      emailBucket,
      itemTable,
      configTable,
      jwkCacheTable: jwkCache.table,
      userPoolIssuer: userPool.issuer,
      allowedOrigins: ALLOWED_ORIGINS,
    });

    // Tantivy search infrastructure (Rust Lambdas + S3 indexes)
    const tantivySearch = new TantivySearch(this, 'tantivy-search', {
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
      userPool: userPool,
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
      userPoolIssuer: userPool.issuer,
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

    // Bootstrap Lambda - creates initial admin user in Cognito only
    // const bootstrapLambda = new GoLambda(this, 'BootstrapAdminLambda', {
    //   lambdaId: 'bootstrap-admin',
    //   codeProvider: codeProvider,
    //   timeout: cdk.Duration.seconds(30),
    //   memorySize: 256,
    //   environment: {
    //     USER_POOL_ID: userPool.userPool.userPoolId,
    //     DEFAULT_EMAIL_DOMAIN: DEFAULT_DOMAIN,
    //     ADMIN_USERNAME: this.node.tryGetContext('adminUsername') || 'admin',
    //     ADMIN_PASSWORD: this.node.tryGetContext('adminPassword') || 'Admin123!',
    //   },
    // });

    // Grant permissions (only Cognito admin access needed)
    // userPool.grantAdminAccess(bootstrapLambda);

    // new Trigger(this, 'BootstrapTrigger', {
    //   handler: bootstrapLambda as any,
    // });

    new cdk.CfnOutput(this, 'EmailBucketName', {
      value: emailBucket.bucketName,
      description: 'S3 Bucket for incoming emails',
    });

    new cdk.CfnOutput(this, 'ConfigTableName', {
      value: configTable.tableName,
      description: 'DynamoDB Config Table Name',
    });

    new cdk.CfnOutput(this, 'ItemTableName', {
      value: itemTable.tableName,
      description: 'DynamoDB Item Table Name',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'CdnHost', {
      value: cdnConstruct.host,
      description: 'CloudFront distribution host for blob downloads',
    });

    new cdk.CfnOutput(this, 'CdnDistributionId', {
      value: cdnConstruct.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url
    });

    new cdk.CfnOutput(this, 'EmailSubmissionQueueUrl', {
      value: emailSending.submissionQueue.queueUrl,
      description: 'SQS Queue URL for email submissions',
    });

    new cdk.CfnOutput(this, 'EmailSubmissionQueueArn', {
      value: emailSending.submissionQueue.queueArn,
      description: 'SQS Queue ARN for email submissions',
    });

    new cdk.CfnOutput(this, 'SESNotificationsTopicArn', {
      value: emailSending.sesNotificationsTopic.topicArn,
      description: 'SNS Topic ARN for SES notifications (configure in SES)',
    });

    new cdk.CfnOutput(this, 'SESNotificationsQueueUrl', {
      value: emailSending.sesNotificationsQueue.queueUrl,
      description: 'SQS Queue URL for SES notifications',
    });

    new cdk.CfnOutput(this, 'TantivyIndexerLambdaArn', {
      value: tantivySearch.indexerArn,
      description: 'Tantivy Indexer Lambda ARN (triggered by EventBridge every hour)',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: webSocketPush.webSocketUrl,
      description: 'WebSocket URL for JMAP Push State notifications',
    });

    new cdk.CfnOutput(this, 'WebSocketConnectionsTable', {
      value: webSocketPush.connectionsTable.tableName,
      description: 'DynamoDB table for WebSocket connections',
    });

    new cdk.CfnOutput(this, 'WebSocketCapabilityDomain', {
      value: WEBSOCKET_CAPABILITY_DOMAIN,
      description: 'WebSocket capability domain identifier',
    });
  }
}