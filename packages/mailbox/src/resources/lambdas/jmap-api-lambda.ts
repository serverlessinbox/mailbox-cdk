import type { IArtifactResolver }                                         from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                                from 'aws-cdk-lib/aws-iam';
import { Duration }                                                       from 'aws-cdk-lib';
import { Construct }                                                      from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl } from '../../api/websocket/websocket';
import type { IMailboxAuthProviderBase }                                  from '../../auth/types';
import type { IDataBlobStore }                                            from '../../data/data-blob-store';
import type { IDataTable }                                                from '../tables/data-tables';
import type { IEmailSendingQueue }                                        from '../../email/sending/email-sending-queue';
import type { IAuditEventsQueue }                                         from '../../features/audit-writing/audit-events-queue';
import type { IAuthKeyStoreTable }                                        from '../tables/auth-key-store-table';

import type { IIdentityProvisioner }                                      from './identity-provisioner-lambda';

export type JmapOAuthHandlerConfig = {
  scopeMap: IMailboxAuthProviderBase['scopeMap'];
};

export interface ApiHandlerLambdaProps {
  configTable: IDataTable;
  itemTable: IDataTable;
  changelogTable: IDataTable;
  authKeyStoreTable: IAuthKeyStoreTable;
  blobStore: IDataBlobStore;
  emailSubmissionQueue: IEmailSendingQueue;
  auditEventsQueue: IAuditEventsQueue;
  cdnHost: string;
  apiBaseUrl: string;
  artifactResolver: IArtifactResolver;
  identityProvisioner: IIdentityProvisioner;
  /** Strongly-typed payload consumed by the Go handler via env.MustGet("OAUTH_HANDLER_CONFIG"). */
  oauthHandlerConfig: JmapOAuthHandlerConfig;
  /** Optional: fully-resolved RFC 9728 protected-resource document URL (e.g. https://jmap.example.com/.well-known/oauth-protected-resource).
   *  The Go handler advertises this URL via 401 WWW-Authenticate: Bearer resource_metadata="...". */
  readonly oauthProtectedResourceUrl?: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
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
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
        OAUTH_HANDLER_CONFIG: JSON.stringify({
          // Go expects map[string][]string; Permission[] is string[] at runtime.
          scopeMap: props.oauthHandlerConfig.scopeMap,
        }),
        OAUTH_PROTECTED_RESOURCE_URL: props.oauthProtectedResourceUrl ?? '',
      },
    });

    // Grant the Lambda function read permissions to the config table
    props.configTable.grantRead(this);
    props.authKeyStoreTable.grantRead(this);

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);
    // JMAP API reads/writes/deletes email, upload, contact, and principal blobs, and reads the
    // built search index to serve query results.
    props.blobStore.grantEmailBlobReadWriteDelete(this);
    props.blobStore.grantUploadBlobReadWriteDelete(this);
    props.blobStore.grantContactBlobReadWriteDelete(this);
    props.blobStore.grantPrincipalBlobReadWriteDelete(this);
    props.blobStore.grantSearchIndexRead(this);

    // Grant SQS permissions to send email submission messages
    props.emailSubmissionQueue.grantSend(this);

    // Grant SQS permissions to send audit events
    props.auditEventsQueue.grantSend(this);

    // Grant the User provisioning function to be invoked
    props.identityProvisioner.grantInvoke(this);

    this.grantLicenseApiAccess(props.vendorAccountIds);
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]) {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
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
