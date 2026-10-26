/// <reference types="jest" />

/**
 * JmapApiLambda: the environment it hands the Go handler (resource names, hosts, the OAuth scope
 * map and the optional protected-resource URL), the grants it requests for itself on its tables,
 * blob store, queues and identity provisioner, the license API invoke statement it adds itself, and
 * the websocket push wiring it takes through enableWebSocketPush. The statement each requested
 * grant renders is pinned by the resource that owns it.
 */

import { statementsForAction }                                                                                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { VENDOR_ACCOUNT_ID }                                                                                                from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                                                                         from 'aws-cdk-lib/assertions';

import type { IWebSocketBroadcastPublisher }                                                                                from '../../../contracts/websocket-push';
import { Permission }                                                                                                       from '../../../core/auth/jmap-scopes';
import { JmapApiLambda }                                                                                                    from '../jmap-api-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable, fakeDataBlobStore, fakeDataTable, fakeIdentityProvisioner, fakeQueue } from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                                                                from './lambda-wrapper-helpers';

function synthesize(oauthProtectedResourceUrl?: string) {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeDataTable('config-table');
  const itemTable                   = fakeDataTable('item-table');
  const changelogTable              = fakeDataTable('changelog-table');
  const authKeyStoreTable           = fakeAuthKeyStoreTable('auth-key-store');
  const blobStore                   = fakeDataBlobStore('blob-store');
  const emailSubmissionQueue        = fakeQueue('email-submission');
  const auditEventsQueue            = fakeQueue('audit-events');
  const identityProvisioner         = fakeIdentityProvisioner('identity-provisioner');
  const lambda                      = new JmapApiLambda(stack, 'jmap-api', {
    configTable,
    itemTable,
    changelogTable,
    authKeyStoreTable,
    blobStore,
    emailSubmissionQueue,
    auditEventsQueue,
    cdnHost:    'cdn.example.com',
    apiBaseUrl: 'https://jmap.example.com',
    artifactResolver,
    identityProvisioner,
    scopeMap:         { 'mail.read': [Permission.MAIL_READ] },
    vendorAccountIds: [VENDOR_ACCOUNT_ID],
    oauthProtectedResourceUrl,
  });

  return { lambda, stack, configTable, itemTable, changelogTable, authKeyStoreTable, blobStore, emailSubmissionQueue, auditEventsQueue, identityProvisioner };
}

function synthesizeTemplate(oauthProtectedResourceUrl?: string) {
  const arrangement = synthesize(oauthProtectedResourceUrl);
  const template    = Template.fromStack(arrangement.stack);

  return { template, ...onlyLambdaOf(template) };
}

describe('JmapApiLambda', () => {
  describe('environment', () => {
    it('passes the resource names, queue URLs, hosts and OAuth scope map to the handler', () => {
      expect(synthesizeTemplate().environment).toMatchObject({
        CONFIG_TABLE_NAME:                  'config-table',
        ITEM_TABLE_NAME:                    'item-table',
        CHANGELOG_TABLE_NAME:               'changelog-table',
        AUTH_KEY_STORE_TABLE_NAME:          'auth-key-store',
        BLOB_STORE_NAME:                    'blob-store',
        EMAIL_SUBMISSION_QUEUE_URL:         'https://sqs.fake/email-submission',
        AUDIT_EVENTS_QUEUE_URL:             'https://sqs.fake/audit-events',
        IDENTITY_PROVISIONER_FUNCTION_NAME: 'identity-provisioner',
        CDN_HOST:                           'cdn.example.com',
        API_BASE_URL:                       'https://jmap.example.com',
        OAUTH_HANDLER_CONFIG:               JSON.stringify({ scopeMap: { 'mail.read': [Permission.MAIL_READ] } }),
      });
    });

    it('omits OAUTH_PROTECTED_RESOURCE_URL when no URL is supplied', () => {
      expect(Object.keys(synthesizeTemplate().environment)).not.toContain('OAUTH_PROTECTED_RESOURCE_URL');
    });

    it('sets OAUTH_PROTECTED_RESOURCE_URL to the supplied URL', () => {
      const { environment } = synthesizeTemplate('https://jmap.example.com/.well-known/oauth-protected-resource');

      expect(environment).toMatchObject({ OAUTH_PROTECTED_RESOURCE_URL: 'https://jmap.example.com/.well-known/oauth-protected-resource' });
    });
  });

  describe('grants it requests for itself', () => {
    it('read on the config and auth key store tables', () => {
      const { lambda, configTable, authKeyStoreTable } = synthesize();

      expectGrantedOnceTo(configTable.grantRead, lambda);
      expectGrantedOnceTo(authKeyStoreTable.grantRead, lambda);
    });

    it('read-write on the item and changelog tables', () => {
      const { lambda, itemTable, changelogTable } = synthesize();

      expectGrantedOnceTo(itemTable.grantReadWrite, lambda);
      expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
    });

    it('read-write-delete on the email, upload, contact and principal blobs and read on the search index', () => {
      const { lambda, blobStore } = synthesize();

      expectGrantedOnceTo(blobStore.grantEmailBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantUploadBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantContactBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantPrincipalBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantSearchIndexRead, lambda);
    });

    it('send on the email-submission and audit-events queues and invoke on the identity provisioner', () => {
      const { lambda, emailSubmissionQueue, auditEventsQueue, identityProvisioner } = synthesize();

      expectGrantedOnceTo(emailSubmissionQueue.grantSend, lambda);
      expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
      expectGrantedOnceTo(identityProvisioner.grantInvoke, lambda);
    });
  });

  it('scopes execute-api:Invoke to the grant-resource and revoke-resource paths of the vendor account', () => {
    const executeApiArn = (path: string): unknown => ({
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:${path}`]],
    });

    expect(statementsForAction(synthesizeTemplate().template, 'execute-api:Invoke')).toEqual([
      {
        Action:   'execute-api:Invoke',
        Effect:   'Allow',
        Resource: [executeApiArn('*/*/POST/grant-resource'), executeApiArn('*/*/POST/revoke-resource')],
      },
    ]);
  });

  it('enableWebSocketPush sets the websocket URL and broadcaster name and lets the broadcaster grant itself invokable', () => {
    const { lambda, stack }                         = synthesize();
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush('wss://ws.example.com', broadcaster);

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({
      WEBSOCKET_URL:                     'wss://ws.example.com',
      WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn',
    });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
