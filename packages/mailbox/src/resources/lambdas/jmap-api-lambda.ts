import type { IArtifactResolver }                                              from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                                            from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                                     from 'aws-cdk-lib/aws-iam';
import { Aws, Duration }                                                       from 'aws-cdk-lib';
import { Construct }                                                           from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTargetWithUrl }      from '../../contracts/websocket-push';
import type { ScopeMap }                                                       from '../../core/auth/jmap-scopes';
import type { IDataBlobStore }                                                 from '../buckets/data-blob-store';
import type { IAuditEventsQueue }                                              from '../queues/audit-events-queue';
import type { IEmailSendingQueue }                                             from '../queues/email-sending-queue';
import type { IAuthKeyStoreTable }                                             from '../tables/auth-key-store-table';
import type { IDataTable }                                                     from '../tables/data-tables';

import type { IIdentityProvisioner }                                           from './identity-provisioner-lambda';

/**
 * The tables, blob store, queues and identity provisioner the JMAP API reads and writes, plus its CDN
 * host, API base URL and OAuth scope map. The caller creates every resource here.
 */
export interface JmapApiLambdaProps {
  readonly configTable:          IDataTable;
  readonly itemTable:            IDataTable;
  readonly changelogTable:       IDataTable;
  readonly authKeyStoreTable:    IAuthKeyStoreTable;
  readonly blobStore:            IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue:     IAuditEventsQueue;
  readonly cdnHost:              string;
  readonly apiBaseUrl:           string;
  readonly artifactResolver:     IArtifactResolver;
  readonly identityProvisioner:  IIdentityProvisioner;
  /** The OAuth scope map; delivered to the Go handler in the OAUTH_HANDLER_CONFIG variable. */
  readonly scopeMap:             ScopeMap;
  /** Optional: fully-resolved RFC 9728 protected-resource document URL (e.g. https://jmap.example.com/.well-known/oauth-protected-resource).
   *  The Go handler advertises this URL via 401 WWW-Authenticate: Bearer resource_metadata="...". */
  readonly oauthProtectedResourceUrl?: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/**
 * The Go Lambda that serves the JMAP API. It does not own the tables, blobs or queues it is given;
 * websocket push is wired through {@link JmapApiLambda.enableWebSocketPush}.
 */
export class JmapApiLambda extends GoLambda implements IWebSocketPushTargetWithUrl {
  constructor(scope: Construct, id: string, props: JmapApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'jmap-api',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      memorySize:       640,
      timeout:          Duration.seconds(30),
      environment:      {
        CONFIG_TABLE_NAME:                  props.configTable.tableName,
        ITEM_TABLE_NAME:                    props.itemTable.tableName,
        CHANGELOG_TABLE_NAME:               props.changelogTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME:          props.authKeyStoreTable.tableName,
        CDN_HOST:                           props.cdnHost,
        API_BASE_URL:                       props.apiBaseUrl,
        BLOB_STORE_NAME:                    props.blobStore.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL:         props.emailSubmissionQueue.queueUrl,
        AUDIT_EVENTS_QUEUE_URL:             props.auditEventsQueue.queueUrl,
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
        OAUTH_HANDLER_CONFIG:               JSON.stringify({
          // Go expects map[string][]string; Permission[] is string[] at runtime.
          scopeMap: props.scopeMap,
        }),
        ...(props.oauthProtectedResourceUrl ? { OAUTH_PROTECTED_RESOURCE_URL: props.oauthProtectedResourceUrl } : {}),
      },
    });

    props.configTable.grantRead(this);
    props.authKeyStoreTable.grantRead(this);

    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);
    // JMAP API reads/writes/deletes email, upload, contact, and principal blobs, and reads the
    // built search index to serve query results.
    props.blobStore.grantEmailBlobReadWriteDelete(this);
    props.blobStore.grantUploadBlobReadWriteDelete(this);
    props.blobStore.grantContactBlobReadWriteDelete(this);
    props.blobStore.grantPrincipalBlobReadWriteDelete(this);
    props.blobStore.grantSearchIndexRead(this);

    props.emailSubmissionQueue.grantSend(this);

    props.auditEventsQueue.grantSend(this);

    props.identityProvisioner.grantInvoke(this);

    this.grantLicenseApiAccess(props.vendorAccountIds);
  }

  public enableWebSocketPush(webSocketUrl: string, broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_URL', webSocketUrl);
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]) {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }
}
