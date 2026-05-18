import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { MailboxAuthProviderBase } from '../auth/types';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export type JmapOAuthHandlerConfig = {
  issuer: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  clientId: string;
  scopeMap: MailboxAuthProviderBase['scopeMap'];
};

export interface ApiHandlerLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  emailBucket: any;
  emailSubmissionQueue: any;
  auditEventsQueue: any;
  cdnHost: string;
  apiBaseUrl: string;
  sesConfigSetName: string;
  artifactResolver: IArtifactResolver;
  userProvisionionFunction: IFunction;
  /** Strongly-typed payload consumed by the Go handler via env.MustGet("OAUTH_HANDLER_CONFIG"). */
  oauthHandlerConfig: JmapOAuthHandlerConfig;
  blobHmacKey: string;
}

export class ApiHandlerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: ApiHandlerLambdaProps) {
    super(scope, id, {
      lambdaId: 'jmap-api',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CDN_HOST: props.cdnHost,
        API_BASE_URL: props.apiBaseUrl,
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
        USER_PROVISIONER_FUNCTION_NAME: props.userProvisionionFunction.functionName,
        OAUTH_HANDLER_CONFIG: JSON.stringify({
          issuer: props.oauthHandlerConfig.issuer,
          tokenEndpoint: props.oauthHandlerConfig.tokenEndpoint,
          authorizationEndpoint: props.oauthHandlerConfig.authorizationEndpoint,
          clientId: props.oauthHandlerConfig.clientId,
          // Go expects map[string][]string; Permission[] is string[] at runtime.
          scopeMap: props.oauthHandlerConfig.scopeMap,
        }),
        BLOB_HMAC_KEY: props.blobHmacKey,
      },
    });

    // Grant the Lambda function read permissions to the config table
    props.configTable.grantReadData(this);

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    // Grant S3 write permissions for blob uploads
    props.emailBucket.grantReadWrite(this);

    // Grant SQS permissions to send email submission messages
    props.emailSubmissionQueue.grantSendMessages(this);

    // Grant SQS permissions to send audit events
    props.auditEventsQueue.grantSendMessages(this);

    // Grant the User provisioning function to be invoked
    props.userProvisionionFunction.grantInvoke(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*'],
    }));
  }
}
