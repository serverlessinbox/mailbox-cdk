import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { IMailboxAuthProviderBase } from '../auth/types';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export type JmapOAuthHandlerConfig = {
  issuer: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  clientId: string;
  scopeMap: IMailboxAuthProviderBase['scopeMap'];
};

export interface ApiHandlerLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  authKeyStoreTable: ITable;
  blobStore: any;
  emailSubmissionQueue: any;
  auditEventsQueue: any;
  cdnHost: string;
  apiBaseUrl: string;
  sesConfigSetName: string;
  artifactResolver: ICdkArtifactResolver;
  userProvisionionFunction: IFunction;
  /** Strongly-typed payload consumed by the Go handler via env.MustGet("OAUTH_HANDLER_CONFIG"). */
  oauthHandlerConfig: JmapOAuthHandlerConfig;
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
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        CDN_HOST: props.cdnHost,
        API_BASE_URL: props.apiBaseUrl,
        BLOB_STORE_NAME: props.blobStore.bucketName,
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
      },
    });

    // Grant the Lambda function read permissions to the config table
    props.configTable.grantReadData(this);
    props.authKeyStoreTable.grantReadData(this);

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    // Grant S3 write permissions for blob uploads
    props.blobStore.grantReadWrite(this);

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
