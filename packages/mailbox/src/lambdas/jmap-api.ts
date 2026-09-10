import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { IMailboxAuthProviderBase } from '../auth/types';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl } from '../api/websocket';
import { resolveVendorAccountIds } from '../addons/support-roles-infra';

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
  artifactResolver: ICdkArtifactEngine;
  identityProvisionerFunction: IFunction;
  /** Strongly-typed payload consumed by the Go handler via env.MustGet("OAUTH_HANDLER_CONFIG"). */
  oauthHandlerConfig: JmapOAuthHandlerConfig;
  /** Optional: fully-resolved RFC 9728 protected-resource document URL (e.g. https://jmap.example.com/.well-known/oauth-protected-resource).
   *  The Go handler advertises this URL via 401 WWW-Authenticate: Bearer resource_metadata="...". */
  readonly oauthProtectedResourceUrl?: string;
}

export class ApiHandlerLambda extends GoLambda implements IWebSocketPushTargetWithUrl {
  constructor(scope: Construct, id: string, props: ApiHandlerLambdaProps) {
    super(scope, id, {
      lambdaId: 'jmap-api',
      pipeline: 'jmap',
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
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisionerFunction.functionName,
        OAUTH_HANDLER_CONFIG: JSON.stringify({
          issuer: props.oauthHandlerConfig.issuer,
          tokenEndpoint: props.oauthHandlerConfig.tokenEndpoint,
          authorizationEndpoint: props.oauthHandlerConfig.authorizationEndpoint,
          clientId: props.oauthHandlerConfig.clientId,
          // Go expects map[string][]string; Permission[] is string[] at runtime.
          scopeMap: props.oauthHandlerConfig.scopeMap,
        }),
        OAUTH_PROTECTED_RESOURCE_URL: props.oauthProtectedResourceUrl ?? '',
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
    props.identityProvisionerFunction.grantInvoke(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: resolveVendorAccountIds().flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }

  public enableWebSocketPush(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_URL', webSocketUrl);
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
